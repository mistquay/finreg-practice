"""Import normalized JSON and the published fenbi-crawler export format."""
from html.parser import HTMLParser
from pathlib import Path
import hashlib,json,re
from database import connect,store_paper,FIELDS
from taxonomy import classify
class PlainText(HTMLParser):
    def __init__(self): super().__init__(); self.parts=[]; self.images=[]; self.skip=0
    def handle_starttag(self,tag,attrs):
        if tag in ('script','style'): self.skip+=1
        if self.skip: return
        if tag in ('p','div','br','li','tr'): self.parts.append('\n')
        if tag=='img':
            src=dict(attrs).get('src',''); self.images.append(src)
            self.parts.append('[图片：请在来源页面核对]')
    def handle_endtag(self,tag):
        if tag in ('script','style') and self.skip: self.skip-=1
        elif tag in ('p','div','li','tr'): self.parts.append('\n')
    def handle_data(self,data):
        if not self.skip: self.parts.append(data)

def text(value):
    if isinstance(value,dict): value=value.get('content',value.get('text',''))
    p=PlainText(); p.feed(str(value or ''))
    return re.sub(r'\n{3,}','\n\n',''.join(p.parts)).strip(),p.images

def normalize(payload):
    if isinstance(payload,dict) and payload.get('version')==1 and isinstance(payload.get('papers'),list):
        papers=payload['papers']
    else:
        title=payload.get('title','导入题库') if isinstance(payload,dict) else '导入题库'
        rows=payload.get('items',payload.get('questions',[])) if isinstance(payload,dict) else payload
        if not isinstance(rows,list): raise ValueError('文件应包含 papers、items 或 questions 数组')
        pid='import-'+hashlib.sha256(str(title).encode()).hexdigest()[:16]
        flat=[]
        for row in rows:
            if not isinstance(row,dict): raise ValueError('题目条目必须是对象')
            if row.get('type')=='material' and isinstance(row.get('questions'),list):
                flat.extend(dict(q,material=row.get('material','')) for q in row['questions'])
            elif isinstance(row.get('question'),dict): flat.append(row['question'])
            else: flat.append(row)
        questions=[]
        for i,row in enumerate(flat,1):
            stem,images=text(row.get('stem',row.get('content','')))
            if not stem: raise ValueError(f'第{i}题没有题干；个人练习统计CSV不能充当题库')
            material,imgs=text(row.get('material','')); images+=imgs
            explanation,imgs=text(row.get('explanation',row.get('analysis',''))); images+=imgs
            opts=row.get('options',{})
            if isinstance(opts,list): opts={chr(65+i):v for i,v in enumerate(opts)}
            if not isinstance(opts,dict): raise ValueError(f'第{i}题选项格式错误')
            options={}
            for k,v in opts.items():
                val,imgs=text(v); images+=imgs
                options[str(k).upper()]=re.sub(r'^'+re.escape(str(k))+r'[.．、\s]+','',val)
            raw=row.get('answer',row.get('correct_answer',row.get('correctAnswer',[])))
            if isinstance(raw,str): answer=sorted(set(re.findall(r'[A-H]',raw)))
            elif isinstance(raw,list) and all(isinstance(v,str) and re.fullmatch('[A-H]',v) for v in raw): answer=sorted(set(raw))
            else: answer=[]
            flags=[]
            if not answer: flags.append('缺少明确的字母参考答案，需核验')
            if len(options)<2 or any(a not in options for a in answer): flags.append('选项或参考答案不完整')
            if images: flags.append('含图片，需到来源页面核验后补全')
            module,category,topic,tags=classify(stem)
            if row.get('module'): module=str(row['module'])
            elif any(s in str(title) for s in ('行测','公务员')): module='行测'; category='待分类'; topic='待分类'; tags=['待细分']
            identity=str(row.get('id') or hashlib.sha256((stem+json.dumps(options,ensure_ascii=False)).encode()).hexdigest()[:20])
            qid=pid+'-'+hashlib.sha256(identity.encode()).hexdigest()[:16]
            questions.append(dict(id=qid,paper_id=pid,number=i,year=row.get('year') or 0,stem=stem,options=options,answer=answer,
                explanation=explanation,material=material,type='multiple' if len(answer)>1 or row.get('type') in ('multiple','multi') else 'single',
                module=module,category=str(row.get('category',category)),topic=str(row.get('topic',topic)),tags=row.get('tags',tags),
                source=str(title),source_page=0,source_url=str(row.get('source_url',payload.get('url','') if isinstance(payload,dict) else '')),
                quality='review' if flags else 'ready',issues=flags,provider='import',external_id=str(row.get('id','')),difficulty=row.get('difficulty'),raw=row))
        papers=[dict(id=pid,title=title,year=0,source='',questions=questions)]
    if not papers or sum(len(p.get('questions',[])) for p in papers)==0: raise ValueError('文件中没有可导入的题目')
    if sum(len(p.get('questions',[])) for p in papers)>20000: raise ValueError('每次最多导入20000题')
    ids=set()
    for p in papers:
        if not isinstance(p.get('id'),str) or not isinstance(p.get('title'),str): raise ValueError('试卷缺少ID或标题')
        for q in p['questions']:
            if not isinstance(q.get('id'),str) or q['id'] in ids: raise ValueError('题目ID缺失或重复')
            ids.add(q['id']); q['paper_id']=p['id']
            validate_question(q)
    return papers

def validate_question(q):
    for key in ('stem','module','category','topic','type','quality'):
        if not isinstance(q.get(key),str) or not q[key].strip(): raise ValueError(f'题目字段 {key} 必须填写')
    if q['type'] not in ('single','multiple','essay') or q['quality'] not in ('ready','review'): raise ValueError('题型或核验状态无效')
    if not isinstance(q.get('options'),dict) or not all(re.fullmatch('[A-H]',k) and isinstance(v,str) for k,v in q['options'].items()): raise ValueError('选项必须是 A-H 为键的文本对象')
    if not isinstance(q.get('answer'),list) or any(a not in q['options'] for a in q['answer']): raise ValueError('参考答案不在选项内')
    if len(set(q['answer']))!=len(q['answer']): raise ValueError('答案包含重复选项')
    if q['type']=='essay' and (q['options'] or q['answer']): raise ValueError('申论题应使用文字参考解析，不能填写选项答案')
    if q['quality']=='ready' and q['type']!='essay':
        if len(q['options'])<2 or not q['answer'] or any(not v.strip() for v in q['options'].values()): raise ValueError('可练习题目必须具备完整选项和答案')
        if q['type']=='single' and len(q['answer'])!=1: raise ValueError('单选题必须只有一个参考答案')
    for key in ('tags','issues'):
        if not isinstance(q.get(key),list) or not all(isinstance(t,str) for t in q[key]): raise ValueError(f'{key} 必须是文本列表')
    for k in ('explanation','material','source','source_url'):
        if not isinstance(q.get(k,''),str): raise ValueError(f'{k} 必须是文本')
    for k in ('number','year','source_page'):
        if not isinstance(q.get(k,0),int): raise ValueError(f'{k} 必须是整数')
    return q

def import_data(payload,preview=False):
    papers=normalize(payload)
    total=sum(len(p['questions']) for p in papers)
    review=sum(q['quality']=='review' for p in papers for q in p['questions'])
    with connect() as c:
        existing={r[0] for r in c.execute('SELECT id FROM questions')}
        duplicates=sum(q['id'] in existing for p in papers for q in p['questions'])
        added=0 if preview else sum(store_paper(c,p) for p in papers)
        if not preview:
            from services import now
            original=json.dumps(payload,ensure_ascii=False,sort_keys=True)
            c.execute('INSERT OR IGNORE INTO imported_documents(sha256,created_at,payload) VALUES(?,?,?)',(hashlib.sha256(original.encode()).hexdigest(),now(),original))
    return {'total':total,'review':review,'duplicates':duplicates,'added':added,'papers':[p['title'] for p in papers]}

def edit_question(qid,data):
    from services import get_question
    q=get_question(qid,True)
    allowed=('stem','options','answer','explanation','material','type','module','category','topic','tags','quality','issues')
    for k in allowed:
        if k in data:q[k]=data[k]
    validate_question(q)
    with connect() as c:
        c.execute('UPDATE questions SET edited=1,'+','.join(k+'=?' for k in allowed)+' WHERE id=?',
            [json.dumps(q[k],ensure_ascii=False) if k in ('options','answer','tags','issues') else q[k] for k in allowed]+[qid])
    return {'saved':True}
