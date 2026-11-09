from __future__ import annotations
import json,uuid,random
from datetime import datetime,timedelta,timezone
from collections import defaultdict
from database import connect,decode
TZ=timezone(timedelta(hours=8))

def now(): return datetime.now(TZ).isoformat(timespec='seconds')
def where(filters,alias='q'):
    clauses=[]; values=[]
    for key in ('module','category','topic','paper_id','quality','type','year'):
        if filters.get(key): clauses.append(f'{alias}.{key}=?'); values.append(filters[key])
    if filters.get('tag'):
        clauses.append(f'EXISTS(SELECT 1 FROM json_each({alias}.tags) WHERE value=?)'); values.append(filters['tag'])
    if filters.get('search'):
        clauses.append(f'({alias}.stem LIKE ? OR {alias}.explanation LIKE ?)'); values.extend(['%'+filters['search']+'%']*2)
    if filters.get('favorite')=='1': clauses.append(f'EXISTS(SELECT 1 FROM marks m WHERE m.question_id={alias}.id AND m.favorite=1)')
    if filters.get('wrong')=='1': clauses.append(f'(SELECT correct FROM attempts a WHERE a.question_id={alias}.id ORDER BY id DESC LIMIT 1)=0')
    if filters.get('unseen')=='1': clauses.append(f'NOT EXISTS(SELECT 1 FROM attempts a WHERE a.question_id={alias}.id)')
    return (' AND '.join(clauses) or '1=1'),values

def list_questions(filters):
    clause,args=where(filters); page=max(1,int(filters.get('page',1))); limit=min(100,max(1,int(filters.get('limit',20))))
    with connect() as c:
        total=c.execute(f'SELECT count(*) FROM questions q WHERE {clause}',args).fetchone()[0]
        rows=c.execute(f'''SELECT q.*,coalesce(m.favorite,0) favorite,coalesce(m.note,'') note,
        (SELECT correct FROM attempts a WHERE a.question_id=q.id ORDER BY id DESC LIMIT 1) last_correct
        FROM questions q LEFT JOIN marks m ON m.question_id=q.id WHERE {clause} ORDER BY q.year DESC,q.paper_id,q.number LIMIT ? OFFSET ?''',args+[limit,(page-1)*limit]).fetchall()
    items=[decode(r) for r in rows]
    for q in items:
        for k in ('answer','explanation','raw'): q.pop(k,None)
    return {'items':items,'total':total,'page':page,'pages':(total+limit-1)//limit}

def metadata():
    with connect() as c:
        papers=[dict(r) for r in c.execute('SELECT p.*,count(q.id) total,sum(q.quality="ready") ready FROM papers p LEFT JOIN questions q ON q.paper_id=p.id GROUP BY p.id ORDER BY year DESC')]
        facets=[dict(r) for r in c.execute('SELECT module,category,topic,count(*) total,sum(quality="ready") ready FROM questions GROUP BY module,category,topic')]
        tags=[r[0] for r in c.execute('SELECT DISTINCT j.value FROM questions,json_each(questions.tags) j ORDER BY j.value')]
        counts=dict(c.execute('SELECT count(*) total,sum(quality="ready") ready,sum(quality="review") review FROM questions').fetchone())
        counts['favorites']=c.execute('SELECT count(*) FROM marks WHERE favorite=1').fetchone()[0]
        counts['wrong']=c.execute('SELECT count(*) FROM attempts a WHERE a.id=(SELECT max(id) FROM attempts WHERE question_id=a.question_id) AND correct=0').fetchone()[0]
        counts['seen']=c.execute('SELECT count(DISTINCT question_id) FROM attempts').fetchone()[0]
        sessions=[dict(r) for r in c.execute('SELECT id,title,mode,created_at,status,position,json_array_length(question_ids) total FROM sessions ORDER BY created_at DESC LIMIT 12')]
    return {'papers':papers,'facets':facets,'tags':tags,'counts':counts,'sessions':sessions}

def get_question(qid,with_answer=False):
    with connect() as c:
        r=c.execute('SELECT q.*,coalesce(m.favorite,0) favorite,coalesce(m.note,\'\') note FROM questions q LEFT JOIN marks m ON q.id=m.question_id WHERE q.id=?',(qid,)).fetchone()
    if not r: raise ValueError('题目不存在')
    q=decode(r)
    if not with_answer:
        q.pop('answer'); q.pop('explanation'); q.pop('raw',None)
    return q

def create_session(data):
    mode=data.get('mode','practice')
    if mode not in ('practice','review','exam'): raise ValueError('无效练习模式')
    filters=dict(data.get('filters') or {},quality='ready')
    if mode=='review': filters['wrong']='1'
    clause,args=where(filters)
    with connect() as c:
        rows=c.execute(f'SELECT id,material FROM questions q WHERE {clause} ORDER BY year DESC,paper_id,number',args).fetchall()
        ids=[r['id'] for r in rows]
        if mode!='exam' and data.get('shuffle',True): random.shuffle(ids)
        if mode!='exam': ids=ids[:min(200,max(1,int(data.get('count',20))))]
        if not ids: raise ValueError('当前条件下没有可练习题目；待核验题默认不参与组卷。')
        sid=uuid.uuid4().hex
        title=str(data.get('title') or {'practice':'模块练习','review':'错题复习','exam':'整卷练习'}[mode])[:120]
        c.execute('INSERT INTO sessions(id,created_at,mode,title,question_ids) VALUES(?,?,?,?,?)',(sid,now(),mode,title,json.dumps(ids)))
    return get_session(sid)

def get_session(sid):
    with connect() as c:
        r=c.execute('SELECT * FROM sessions WHERE id=?',(sid,)).fetchone()
        if not r: raise ValueError('练习不存在')
        data=dict(r); data['question_ids']=json.loads(data['question_ids']); data['drafts']=json.loads(data['drafts'])
        data['attempts']=[dict(r) for r in c.execute('SELECT * FROM attempts WHERE session_id=? ORDER BY id',(sid,))]
    for a in data['attempts']:
        a['selected']=json.loads(a['selected']); a['answer_snapshot']=json.loads(a['answer_snapshot'])
    return data

def update_session(sid,data):
    session=get_session(sid)
    position=max(0,min(len(session['question_ids'])-1,int(data.get('position',session['position']))))
    drafts=data.get('drafts',session['drafts'])
    if not isinstance(drafts,dict): raise ValueError('暂存数据格式错误')
    status=data.get('status',session['status'])
    if status not in ('active','completed'): raise ValueError('无效练习状态')
    with connect() as c: c.execute('UPDATE sessions SET position=?,drafts=?,status=? WHERE id=?',(position,json.dumps(drafts),status,sid))
    return get_session(sid)

def answer(sid,data):
    session=get_session(sid); qid=data.get('question_id')
    if qid not in session['question_ids']: raise ValueError('该题不在本次练习中')
    selected=data.get('selected')
    if not isinstance(selected,list) or not selected: raise ValueError('请先选择答案')
    q=get_question(qid,True)
    if any(not isinstance(x,str) or x not in q['options'] for x in selected): raise ValueError('选项无效')
    selected=sorted(set(selected))
    if q['type']=='single' and len(selected)!=1: raise ValueError('单选题只能选一个选项')
    elapsed=int(data.get('elapsed_ms',0))
    if not 0<=elapsed<=7200000: raise ValueError('用时超出有效范围')
    correct=int(selected==sorted(q['answer'])) if q['answer'] and q['quality']=='ready' else None
    with connect() as c:
        c.execute('BEGIN IMMEDIATE')
        exists=c.execute('SELECT * FROM attempts WHERE session_id=? AND question_id=?',(sid,qid)).fetchone()
        if exists:
            correct=exists['correct']; selected=json.loads(exists['selected'])
        else:
            if session['status']!='active': raise ValueError('练习已结束')
            first=not c.execute('SELECT 1 FROM attempts WHERE question_id=? LIMIT 1',(qid,)).fetchone()
            c.execute('INSERT INTO attempts(question_id,session_id,selected,correct,elapsed_ms,created_at,is_first,mode,answer_snapshot) VALUES(?,?,?,?,?,?,?,?,?)',
                (qid,sid,json.dumps(selected),correct,elapsed,now(),int(first),session['mode'],json.dumps(q['answer'])))
    return {'correct':correct,'selected':selected,'answer':q['answer'],'explanation':q['explanation'],'duplicate':bool(exists)}

def mark(qid,data):
    get_question(qid)
    with connect() as c:
        old=c.execute('SELECT * FROM marks WHERE question_id=?',(qid,)).fetchone()
        favorite=int(bool(data.get('favorite',old['favorite'] if old else False)))
        note=str(data.get('note',old['note'] if old else ''))[:20000]
        c.execute('INSERT INTO marks(question_id,favorite,note) VALUES(?,?,?) ON CONFLICT(question_id) DO UPDATE SET favorite=excluded.favorite,note=excluded.note',(qid,favorite,note))
    return {'favorite':favorite,'note':note}

def aggregate(rows):
    graded=[r for r in rows if r['correct'] is not None]; correct=sum(r['correct']==1 for r in graded)
    elapsed=sum(r['elapsed_ms'] for r in rows)
    return {'count':len(rows),'graded':len(graded),'correct':correct,'wrong':len(graded)-correct,
        'accuracy':round(correct/len(graded)*100,1) if graded else None,'elapsed_ms':elapsed,'avg_ms':round(elapsed/len(rows)) if rows else 0,
        'unique':len({r['question_id'] for r in rows})}

def statistics(filters):
    clause,args=where(filters); extra=[]
    today=datetime.now(TZ).date(); days=max(0,min(3650,int(filters.get('days',7))))
    if days: extra.append('substr(a.created_at,1,10)>=?'); args.append((today-timedelta(days=days-1)).isoformat())
    extra.append('substr(a.created_at,1,10)<=?'); args.append(today.isoformat())
    if filters.get('attempt')=='first': extra.append('a.is_first=1')
    if filters.get('mode'): extra.append('a.mode=?'); args.append(filters['mode'])
    with connect() as c:
        rows=[dict(r) for r in c.execute(f'SELECT a.*,q.module,q.category,q.topic,q.tags,q.paper_id FROM attempts a JOIN questions q ON q.id=a.question_id WHERE {clause} AND {" AND ".join(extra)}',args)]
    daily=defaultdict(list); groups=defaultdict(list)
    group=filters.get('group','module')
    if group not in ('module','category','topic','tag'): group='module'
    for r in rows:
        daily[r['created_at'][:10]].append(r)
        for k in json.loads(r['tags']) if group=='tag' else [r[group]]: groups[k].append(r)
    start=today-timedelta(days=days-1) if days else datetime.fromisoformat(min(daily) if daily else today.isoformat()).date()
    trend=[]; date=start
    while date<=today:
        key=date.isoformat(); trend.append(dict(date=key,**aggregate(daily[key]))); date+=timedelta(days=1)
    return {'summary':aggregate(rows),'today':aggregate(daily[today.isoformat()]),'trend':trend,
        'groups':[dict(name=k,last=max(x['created_at'] for x in v),**aggregate(v)) for k,v in groups.items()],
        'timezone':'Asia/Shanghai','group':group}
