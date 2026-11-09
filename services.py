from __future__ import annotations
import json,uuid,random
from datetime import datetime,timedelta,timezone
from collections import defaultdict
from database import connect,decode,FIELDS
TZ=timezone(timedelta(hours=8))

def now(): return datetime.now(TZ).isoformat(timespec='seconds')
def where(filters,alias='q'):
    clauses=[]; values=[]
    for key in ('module','category','topic','paper_id','quality','type','year'):
        if filters.get(key): clauses.append(f'{alias}.{key}=?'); values.append(filters[key])
    for key in ('kind','exam_level'):
        if filters.get(key):
            clauses.append(f'EXISTS(SELECT 1 FROM papers p WHERE p.id={alias}.paper_id AND p.{key}=?)')
            values.append(filters[key])
    if filters.get('tag'):
        clauses.append(f'EXISTS(SELECT 1 FROM json_each({alias}.tags) WHERE value=?)'); values.append(filters['tag'])
    if filters.get('search'):
        clauses.append(f'({alias}.stem LIKE ? OR {alias}.explanation LIKE ?)'); values.extend(['%'+filters['search']+'%']*2)
    if filters.get('favorite')=='1': clauses.append(f'EXISTS(SELECT 1 FROM marks m WHERE m.question_id={alias}.id AND m.favorite=1)')
    if filters.get('wrong')=='1': clauses.append(f"(SELECT a.correct FROM attempts a JOIN sessions s ON s.id=a.session_id WHERE a.question_id={alias}.id AND (s.mode!='exam' OR s.status='completed') ORDER BY a.id DESC LIMIT 1)=0")
    if filters.get('unseen')=='1': clauses.append(f"NOT EXISTS(SELECT 1 FROM attempts a JOIN sessions s ON s.id=a.session_id WHERE a.question_id={alias}.id AND (s.mode!='exam' OR s.status='completed'))")
    return (' AND '.join(clauses) or '1=1'),values

def list_questions(filters):
    clause,args=where(filters); page=max(1,int(filters.get('page',1))); limit=min(100,max(1,int(filters.get('limit',20))))
    with connect() as c:
        total=c.execute(f'SELECT count(*) FROM questions q WHERE {clause}',args).fetchone()[0]
        columns=','.join('q.'+k for k in FIELDS if k not in ('answer','explanation','raw'))
        rows=c.execute(f'''SELECT {columns},coalesce(m.favorite,0) favorite,coalesce(m.note,'') note,
        (SELECT a.correct FROM attempts a JOIN sessions s ON s.id=a.session_id WHERE a.question_id=q.id
            AND (s.mode!='exam' OR s.status='completed') ORDER BY a.id DESC LIMIT 1) last_correct
        FROM questions q LEFT JOIN marks m ON m.question_id=q.id WHERE {clause} ORDER BY q.year DESC,q.paper_id,q.number LIMIT ? OFFSET ?''',args+[limit,(page-1)*limit]).fetchall()
    items=[decode(r) for r in rows]
    for q in items:
        for k in ('answer','explanation','raw'): q.pop(k,None)
    return {'items':items,'total':total,'page':page,'pages':(total+limit-1)//limit}

def metadata():
    with connect() as c:
        papers=[dict(r) for r in c.execute('SELECT p.id,p.title,p.year,p.duration_minutes,p.subject,p.kind,p.exam_level,count(q.paper_id) total,coalesce(sum(q.quality="ready"),0) ready FROM papers p LEFT JOIN questions q ON q.paper_id=p.id GROUP BY p.id ORDER BY p.year DESC')]
        facets=[dict(r) for r in c.execute('SELECT module,category,topic,count(*) total,sum(quality="ready") ready,sum(quality="review") review FROM questions GROUP BY module,category,topic')]
        tags=[r[0] for r in c.execute('SELECT DISTINCT j.value FROM (SELECT DISTINCT tags FROM questions) t,json_each(t.tags) j ORDER BY j.value')]
        counts={k:sum(f[k] for f in facets) for k in ('total','ready','review')}
        for facet in facets: facet.pop('review')
        counts['favorites']=c.execute('SELECT count(*) FROM marks WHERE favorite=1').fetchone()[0]
        counts['wrong']=c.execute('''SELECT count(*) FROM attempts a JOIN sessions s ON s.id=a.session_id
            WHERE (s.mode!='exam' OR s.status='completed') AND a.correct=0 AND a.id=(
            SELECT max(b.id) FROM attempts b JOIN sessions t ON t.id=b.session_id
            WHERE b.question_id=a.question_id AND (t.mode!='exam' OR t.status='completed'))''').fetchone()[0]
        counts['seen']=c.execute("SELECT count(DISTINCT a.question_id) FROM attempts a JOIN sessions s ON s.id=a.session_id WHERE s.mode!='exam' OR s.status='completed'").fetchone()[0]
        sessions=[dict(r) for r in c.execute('SELECT id,title,mode,created_at,status,position,json_array_length(question_ids) total FROM sessions ORDER BY created_at DESC LIMIT 12')]
    return {'papers':papers,'facets':facets,'tags':tags,'counts':counts,'sessions':sessions}

def get_question(qid,with_answer=False,include_raw=True):
    with connect() as c:
        excluded=set() if with_answer else {'answer','explanation','raw'}
        if not include_raw: excluded.add('raw')
        columns=','.join('q.'+k for k in FIELDS if k not in excluded)
        r=c.execute(f'SELECT {columns},q.edited,coalesce(m.favorite,0) favorite,coalesce(m.note,\'\') note FROM questions q LEFT JOIN marks m ON q.id=m.question_id WHERE q.id=?',(qid,)).fetchone()
    if not r: raise ValueError('题目不存在')
    q=decode(r)
    return q

def create_session(data):
    mode=data.get('mode','practice')
    if mode not in ('practice','review','exam'): raise ValueError('无效练习模式')
    filters=dict(data.get('filters') or {},quality='ready')
    if mode=='review': filters['wrong']='1'
    clause,args=where(filters)
    with connect() as c:
        rows=c.execute(f'SELECT id FROM questions q WHERE {clause} ORDER BY year DESC,paper_id,number',args).fetchall()
        ids=[r['id'] for r in rows]
        if data.get('shuffle',mode!='exam' or not filters.get('paper_id')): random.shuffle(ids)
        if not data.get('full_paper') and (mode!='exam' or data.get('count') is not None):
            ids=ids[:min(200,max(1,int(data.get('count',20))))]
        if not ids: raise ValueError('当前条件下没有可练习题目；待核验题默认不参与组卷。')
        sid=uuid.uuid4().hex
        title=str(data.get('title') or {'practice':'模块练习','review':'错题复习','exam':'整卷练习'}[mode])[:120]
        c.execute('INSERT INTO sessions(id,created_at,mode,title,question_ids) VALUES(?,?,?,?,?)',(sid,now(),mode,title,json.dumps(ids)))
    return get_session(sid)

def _read_session(conn, sid):
    row = conn.execute('SELECT * FROM sessions WHERE id=?', (sid,)).fetchone()
    if not row:
        raise ValueError('练习不存在')
    session = dict(row)
    session['question_ids'] = json.loads(session['question_ids'])
    session['drafts'] = json.loads(session['drafts'])
    session['attempts'] = [dict(r) for r in conn.execute(
        'SELECT * FROM attempts WHERE session_id=? ORDER BY id', (sid,))]
    for attempt in session['attempts']:
        attempt['selected'] = json.loads(attempt['selected'])
        attempt['answer_snapshot'] = json.loads(attempt['answer_snapshot'])
    return session


def get_session(sid):
    with connect() as conn:
        session = _read_session(conn, sid)
    if session['mode'] == 'exam' and session['status'] == 'active':
        for attempt in session['attempts']:
            attempt.pop('correct', None)
            attempt.pop('answer_snapshot', None)
    return session


def _validate_answer(question, selected, elapsed):
    if question['type'] == 'essay':
        if (not isinstance(selected, list) or len(selected) != 1
                or not isinstance(selected[0], str) or not selected[0].strip()):
            raise ValueError('请先填写作答内容')
        if len(selected[0]) > 30000:
            raise ValueError('单题作答最多30000字')
    else:
        if not isinstance(selected, list) or not selected:
            raise ValueError('请先选择答案')
        if any(not isinstance(x, str) or x not in question['options'] for x in selected):
            raise ValueError('选项无效')
        selected = sorted(set(selected))
        if question['type'] == 'single' and len(selected) != 1:
            raise ValueError('单选题只能选一个选项')
    elapsed = int(elapsed)
    if not 0 <= elapsed <= 7200000:
        raise ValueError('用时超出有效范围')
    return selected, elapsed


def _record_answer(conn, session, question, selected, elapsed, replace=False):
    selected, elapsed = _validate_answer(question, selected, elapsed)
    correct = (int(selected == sorted(question['answer']))
               if question['type'] != 'essay' and question['answer'] and question['quality'] == 'ready'
               else None)
    snapshot = [question['explanation']] if question['type'] == 'essay' else question['answer']
    old = conn.execute('SELECT * FROM attempts WHERE session_id=? AND question_id=?',
                       (session['id'], question['id'])).fetchone()
    if old and not replace:
        correct, selected, elapsed = old['correct'], json.loads(old['selected']), old['elapsed_ms']
        snapshot = json.loads(old['answer_snapshot'])
    elif old:
        conn.execute('UPDATE attempts SET selected=?,correct=?,elapsed_ms=?,answer_snapshot=? WHERE id=?',
                     (json.dumps(selected), correct, elapsed, json.dumps(snapshot), old['id']))
    else:
        first = not conn.execute('SELECT 1 FROM attempts WHERE question_id=? LIMIT 1',
                                 (question['id'],)).fetchone()
        conn.execute('''INSERT INTO attempts(question_id,session_id,selected,correct,elapsed_ms,
            created_at,is_first,mode,answer_snapshot) VALUES(?,?,?,?,?,?,?,?,?)''',
            (question['id'], session['id'], json.dumps(selected), correct, elapsed, now(),
             int(first), session['mode'], json.dumps(snapshot)))
    return dict(question_id=question['id'], correct=correct, selected=selected,
                elapsed_ms=elapsed, answer=snapshot,
                explanation=snapshot[0] if question['type'] == 'essay' and snapshot else question['explanation'],
                duplicate=bool(old))


def update_session(sid, data):
    if data.get('status') == 'completed':
        return finish_session(sid, data)
    if data.get('status', 'active') != 'active':
        raise ValueError('无效练习状态')
    with connect() as conn:
        conn.execute('BEGIN IMMEDIATE')
        session = _read_session(conn, sid)
        # An in-flight autosave must never reopen or overwrite a submitted exam.
        if session['status'] == 'completed':
            return dict(saved=True, status='completed', position=session['position'])
        position = max(0, min(len(session['question_ids']) - 1, int(data.get('position', session['position']))))
        drafts = data.get('drafts', session['drafts'])
        if not isinstance(drafts, dict):
            raise ValueError('暂存数据格式错误')
        if drafts.get('__updated', 0) < session['drafts'].get('__updated', 0):
            return dict(saved=True, stale=True, status='active', position=session['position'])
        conn.execute('UPDATE sessions SET position=?,drafts=? WHERE id=?',
                     (position, json.dumps(drafts, ensure_ascii=False), sid))
    return dict(saved=True, status='active', position=position)


def answer(sid, data):
    with connect() as conn:
        conn.execute('BEGIN IMMEDIATE')
        session = _read_session(conn, sid)
        qid = data.get('question_id')
        if qid not in session['question_ids']:
            raise ValueError('该题不在本次练习中')
        if session['mode'] == 'exam' and session['status'] == 'active':
            raise ValueError('考试模式请完成整卷后交卷，不逐题判分')
        old = conn.execute('SELECT 1 FROM attempts WHERE session_id=? AND question_id=?', (sid, qid)).fetchone()
        if session['status'] != 'active' and not old:
            raise ValueError('练习已结束')
        question = decode(conn.execute('SELECT ' + ','.join(k for k in FIELDS if k != 'raw') +
                                      ' FROM questions WHERE id=?', (qid,)).fetchone())
        return _record_answer(conn, session, question, data.get('selected'), data.get('elapsed_ms', 0))


def finish_session(sid, data):
    with connect() as conn:
        conn.execute('BEGIN IMMEDIATE')
        session = _read_session(conn, sid)
        if session['status'] == 'active':
            drafts = data.get('drafts', session['drafts'])
            if not isinstance(drafts, dict):
                raise ValueError('暂存数据格式错误')
            position = max(0, min(len(session['question_ids']) - 1, int(data.get('position', session['position']))))
            if session['mode'] == 'exam':
                questions = {r['id']: decode(r) for r in conn.execute(
                    'SELECT ' + ','.join(k for k in FIELDS if k != 'raw') +
                    ' FROM questions WHERE id IN (SELECT value FROM json_each(?))',
                    (json.dumps(session['question_ids']),))}
                previous = {a['question_id']: a for a in session['attempts']}
                for qid in session['question_ids']:
                    draft = drafts.get(qid, previous.get(qid, {}))
                    if not isinstance(draft, dict):
                        raise ValueError('单题暂存数据格式错误')
                    selected = draft.get('selected', [])
                    blank_essay = (questions[qid]['type'] == 'essay' and isinstance(selected, list)
                                   and len(selected) == 1 and isinstance(selected[0], str) and not selected[0].strip())
                    if not selected or blank_essay:
                        # Removing a previously selected answer leaves it unscored.
                        conn.execute('DELETE FROM attempts WHERE session_id=? AND question_id=?', (sid, qid))
                        continue
                    _record_answer(conn, session, questions[qid], selected, draft.get('elapsed_ms', 0), replace=True)
            conn.execute("UPDATE sessions SET position=?,drafts=?,status='completed' WHERE id=?",
                         (position, json.dumps(drafts, ensure_ascii=False), sid))
    return get_session(sid)


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
    extra.append("EXISTS(SELECT 1 FROM sessions s WHERE s.id=a.session_id AND (s.mode!='exam' OR s.status='completed'))")
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
