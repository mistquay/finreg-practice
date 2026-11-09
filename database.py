from __future__ import annotations
import json,sqlite3,os
from pathlib import Path
ROOT=Path(__file__).resolve().parent
DB_PATH=Path(os.environ.get('FINREG_DB',ROOT/'data/practice.sqlite3'))
SCHEMA='''
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS papers(id TEXT PRIMARY KEY,title TEXT NOT NULL,year INTEGER,source TEXT,sha256 TEXT,duration_minutes INTEGER DEFAULT 120);
CREATE TABLE IF NOT EXISTS questions(id TEXT PRIMARY KEY,paper_id TEXT REFERENCES papers(id),number INTEGER,year INTEGER,stem TEXT NOT NULL,options TEXT NOT NULL,answer TEXT NOT NULL,explanation TEXT,material TEXT,type TEXT,module TEXT,category TEXT,topic TEXT,tags TEXT,source TEXT,source_page INTEGER,source_url TEXT,quality TEXT,issues TEXT,provider TEXT,external_id TEXT,difficulty REAL,raw TEXT,edited INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS questions_scope ON questions(module,category,paper_id);
CREATE INDEX IF NOT EXISTS questions_paper_quality ON questions(paper_id,quality);
CREATE INDEX IF NOT EXISTS questions_facets ON questions(module,category,topic,quality);
CREATE INDEX IF NOT EXISTS questions_tags ON questions(tags);
CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,created_at TEXT NOT NULL,mode TEXT NOT NULL,title TEXT,question_ids TEXT NOT NULL,status TEXT DEFAULT 'active',position INTEGER DEFAULT 0,drafts TEXT DEFAULT '{}');
CREATE TABLE IF NOT EXISTS attempts(id INTEGER PRIMARY KEY AUTOINCREMENT,question_id TEXT NOT NULL REFERENCES questions(id),session_id TEXT REFERENCES sessions(id),selected TEXT NOT NULL,correct INTEGER,elapsed_ms INTEGER NOT NULL,created_at TEXT NOT NULL,is_first INTEGER NOT NULL,mode TEXT NOT NULL,answer_snapshot TEXT NOT NULL,UNIQUE(session_id,question_id));
CREATE INDEX IF NOT EXISTS attempts_date ON attempts(created_at);
CREATE INDEX IF NOT EXISTS attempts_question ON attempts(question_id,id DESC);
CREATE TABLE IF NOT EXISTS imported_documents(sha256 TEXT PRIMARY KEY,created_at TEXT NOT NULL,payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS marks(question_id TEXT PRIMARY KEY REFERENCES questions(id),favorite INTEGER DEFAULT 0,note TEXT DEFAULT '');
'''
JSON_FIELDS=('options','answer','tags','issues','raw')
FIELDS=('id','paper_id','number','year','stem','options','answer','explanation','material','type','module','category','topic','tags','source','source_page','source_url','quality','issues','provider','external_id','difficulty','raw')

class Connection(sqlite3.Connection):
    def __exit__(self,*args):
        try: return super().__exit__(*args)
        finally: self.close()

def connect():
    conn=sqlite3.connect(DB_PATH,timeout=15,factory=Connection); conn.row_factory=sqlite3.Row
    conn.execute('PRAGMA foreign_keys=ON')
    return conn

def decode(row):
    d=dict(row)
    for key in JSON_FIELDS:
        if key in d: d[key]=json.loads(d[key] or ('{}' if key in ('options','raw') else '[]'))
    return d

def store_paper(conn,paper):
    conn.execute('''INSERT INTO papers(id,title,year,source,sha256,duration_minutes,subject,kind,exam_level)
        VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
        subject=CASE WHEN excluded.subject!='' THEN excluded.subject ELSE papers.subject END,
        kind=CASE WHEN excluded.kind!='' THEN excluded.kind ELSE papers.kind END,
        exam_level=CASE WHEN excluded.exam_level!='' THEN excluded.exam_level ELSE papers.exam_level END''',
        (paper['id'],paper['title'],paper.get('year'),paper.get('source',''),paper.get('sha256',''),paper.get('duration_minutes',120),paper.get('subject',''),paper.get('kind',''),paper.get('exam_level','')))
    added=0
    for q in paper['questions']:
        q=dict(q,paper_id=paper['id'])
        values=[json.dumps(q.get(k,{} if k in ('options','raw') else []),ensure_ascii=False) if k in JSON_FIELDS else q.get(k,None if k=='difficulty' else '') for k in FIELDS]
        cur=conn.execute(f'INSERT OR IGNORE INTO questions({",".join(FIELDS)}) VALUES({",".join("?" for _ in FIELDS)})',values)
        added+=cur.rowcount
        if not cur.rowcount and q.get('raw'):
            conn.execute('UPDATE questions SET raw=?,difficulty=? WHERE id=?',(json.dumps(q['raw'],ensure_ascii=False),q.get('difficulty'),q['id']))
            if q.get('provider')=='fenbi':
                # A complete API capture can fill old explanations, but never overwrite manual edits.
                if q['raw'].get('capture_format') == 'paper-solution-v1':
                    update_fields=[k for k in FIELDS if k not in ('id','paper_id','raw')]
                    update_values=[json.dumps(q.get(k,{} if k=='options' else []),ensure_ascii=False) if k in JSON_FIELDS else q.get(k,None if k=='difficulty' else '') for k in update_fields]
                    conn.execute('UPDATE questions SET '+','.join(k+'=?' for k in update_fields)+' WHERE id=? AND edited=0',update_values+[q['id']])
                else:
                    conn.execute('UPDATE questions SET topic=?,tags=? WHERE id=? AND edited=0',(q['topic'],json.dumps(q['tags'],ensure_ascii=False),q['id']))
    return added

def initialize():
    DB_PATH.parent.mkdir(parents=True,exist_ok=True)
    with connect() as conn:
        conn.executescript(SCHEMA)
        paper_columns={r[1] for r in conn.execute('PRAGMA table_info(papers)')}
        for name in ('subject','kind','exam_level'):
            if name not in paper_columns:
                conn.execute(f"ALTER TABLE papers ADD COLUMN {name} TEXT NOT NULL DEFAULT ''")
        if 'edited' not in {r[1] for r in conn.execute('PRAGMA table_info(questions)')}:
            conn.execute('ALTER TABLE questions ADD COLUMN edited INTEGER NOT NULL DEFAULT 0')
        for bank in (ROOT/'data/bank.json', ROOT/'data/fenbi-bank.json'):
            if bank.exists():
                for p in json.loads(bank.read_text(encoding='utf-8'))['papers']:
                    if not conn.execute('SELECT 1 FROM papers WHERE id=?',(p['id'],)).fetchone(): store_paper(conn,p)
