"""SQLite storage: schema, connections and paper/question persistence."""
from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get('FINREG_DB', ROOT / 'data/practice.sqlite3'))

SCHEMA = '''
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS papers(
    id TEXT PRIMARY KEY, title TEXT NOT NULL, year INTEGER, source TEXT, sha256 TEXT,
    duration_minutes INTEGER DEFAULT 120,
    subject TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT '', exam_level TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS questions(
    id TEXT PRIMARY KEY, paper_id TEXT REFERENCES papers(id), number INTEGER, year INTEGER,
    stem TEXT NOT NULL, options TEXT NOT NULL, answer TEXT NOT NULL, explanation TEXT, material TEXT,
    type TEXT, module TEXT, category TEXT, topic TEXT, tags TEXT, source TEXT, source_page INTEGER,
    source_url TEXT, quality TEXT, issues TEXT, provider TEXT, external_id TEXT, difficulty REAL, raw TEXT,
    edited INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS questions_scope ON questions(module, category, paper_id);
CREATE INDEX IF NOT EXISTS questions_paper_quality ON questions(paper_id, quality);
CREATE INDEX IF NOT EXISTS questions_facets ON questions(module, category, topic, quality);
CREATE INDEX IF NOT EXISTS questions_tags ON questions(tags);
CREATE TABLE IF NOT EXISTS users(
    id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', disabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, last_login TEXT);
CREATE TABLE IF NOT EXISTS auth_sessions(
    token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS invites(
    code TEXT PRIMARY KEY, created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL, used_by INTEGER REFERENCES users(id), used_at TEXT,
    revoked INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions(
    id TEXT PRIMARY KEY, created_at TEXT NOT NULL, mode TEXT NOT NULL, title TEXT,
    question_ids TEXT NOT NULL, status TEXT DEFAULT 'active', position INTEGER DEFAULT 0,
    drafts TEXT DEFAULT '{}', user_id INTEGER REFERENCES users(id), updated_at TEXT);
CREATE TABLE IF NOT EXISTS attempts(
    id INTEGER PRIMARY KEY AUTOINCREMENT, question_id TEXT NOT NULL REFERENCES questions(id),
    session_id TEXT REFERENCES sessions(id), selected TEXT NOT NULL, correct INTEGER,
    elapsed_ms INTEGER NOT NULL, created_at TEXT NOT NULL, is_first INTEGER NOT NULL, mode TEXT NOT NULL,
    answer_snapshot TEXT NOT NULL, user_id INTEGER REFERENCES users(id), UNIQUE(session_id, question_id));
CREATE INDEX IF NOT EXISTS attempts_date ON attempts(created_at);
CREATE INDEX IF NOT EXISTS attempts_question ON attempts(question_id, id DESC);
CREATE TABLE IF NOT EXISTS imported_documents(sha256 TEXT PRIMARY KEY, created_at TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS marks(
    user_id INTEGER REFERENCES users(id), question_id TEXT NOT NULL REFERENCES questions(id),
    favorite INTEGER DEFAULT 0, note TEXT DEFAULT '', PRIMARY KEY(user_id, question_id));
CREATE TABLE IF NOT EXISTS user_settings(
    user_id INTEGER PRIMARY KEY REFERENCES users(id), exam_name TEXT NOT NULL DEFAULT '',
    exam_date TEXT NOT NULL DEFAULT '', daily_goal INTEGER NOT NULL DEFAULT 50, focus TEXT NOT NULL DEFAULT '[]');
'''

# Study records belong to a user. Rows from before accounts existed keep user_id NULL until the
# first account is created, which then takes them over (see auth.create_user).
USER_INDEXES = '''
DROP INDEX IF EXISTS sessions_user;
CREATE INDEX IF NOT EXISTS sessions_user_activity ON sessions(user_id, updated_at);
CREATE INDEX IF NOT EXISTS attempts_user_question ON attempts(user_id, question_id, id);
CREATE INDEX IF NOT EXISTS auth_sessions_user ON auth_sessions(user_id);
'''

# Columns added after the first release; older databases are migrated in initialize().
MIGRATIONS = {
    'papers': {name: "TEXT NOT NULL DEFAULT ''" for name in ('subject', 'kind', 'exam_level')},
    'questions': {'edited': 'INTEGER NOT NULL DEFAULT 0'},
    'sessions': {'user_id': 'INTEGER REFERENCES users(id)', 'updated_at': 'TEXT'},
    'attempts': {'user_id': 'INTEGER REFERENCES users(id)'},
}

JSON_FIELDS = ('options', 'answer', 'tags', 'issues', 'raw')
FIELDS = ('id', 'paper_id', 'number', 'year', 'stem', 'options', 'answer', 'explanation', 'material',
          'type', 'module', 'category', 'topic', 'tags', 'source', 'source_page', 'source_url', 'quality',
          'issues', 'provider', 'external_id', 'difficulty', 'raw')
OBJECT_FIELDS = ('options', 'raw')


class Connection(sqlite3.Connection):
    """`with connect() as c:` commits or rolls back, then always closes."""

    def __exit__(self, *args):
        try:
            return super().__exit__(*args)
        finally:
            self.close()


def connect():
    conn = sqlite3.connect(DB_PATH, timeout=15, factory=Connection)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys=ON')
    return conn


def decode(row):
    d = dict(row)
    for key in JSON_FIELDS:
        if key in d:
            d[key] = json.loads(d[key] or ('{}' if key in OBJECT_FIELDS else '[]'))
    return d


def encode(question, key):
    """Column value for a question field, JSON-encoding structured fields."""
    if key in JSON_FIELDS:
        return json.dumps(question.get(key, {} if key in OBJECT_FIELDS else []), ensure_ascii=False)
    return question.get(key, None if key == 'difficulty' else '')


def store_paper(conn, paper):
    """Insert a paper and its new questions. Returns the number of questions added.

    Existing questions keep learner data; a complete Fenbi capture may refresh source fields,
    but never overwrites a manually edited question.
    """
    conn.execute('''INSERT INTO papers(id,title,year,source,sha256,duration_minutes,subject,kind,exam_level)
        VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
        subject=CASE WHEN excluded.subject!='' THEN excluded.subject ELSE papers.subject END,
        kind=CASE WHEN excluded.kind!='' THEN excluded.kind ELSE papers.kind END,
        exam_level=CASE WHEN excluded.exam_level!='' THEN excluded.exam_level ELSE papers.exam_level END''',
                 (paper['id'], paper['title'], paper.get('year'), paper.get('source', ''), paper.get('sha256', ''),
                  paper.get('duration_minutes', 120), paper.get('subject', ''), paper.get('kind', ''),
                  paper.get('exam_level', '')))
    placeholders = ','.join('?' for _ in FIELDS)
    added = 0
    for q in paper['questions']:
        q = dict(q, paper_id=paper['id'])
        cur = conn.execute(f'INSERT OR IGNORE INTO questions({",".join(FIELDS)}) VALUES({placeholders})',
                           [encode(q, k) for k in FIELDS])
        added += cur.rowcount
        if cur.rowcount or not q.get('raw'):
            continue
        conn.execute('UPDATE questions SET raw=?,difficulty=? WHERE id=?',
                     (json.dumps(q['raw'], ensure_ascii=False), q.get('difficulty'), q['id']))
        if q.get('provider') != 'fenbi':
            continue
        if q['raw'].get('capture_format') == 'paper-solution-v1':
            fields = [k for k in FIELDS if k not in ('id', 'paper_id', 'raw')]
            conn.execute('UPDATE questions SET ' + ','.join(k + '=?' for k in fields) + ' WHERE id=? AND edited=0',
                         [encode(q, k) for k in fields] + [q['id']])
        else:
            conn.execute('UPDATE questions SET topic=?,tags=? WHERE id=? AND edited=0',
                         (q['topic'], json.dumps(q['tags'], ensure_ascii=False), q['id']))
    return added


def initialize():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with connect() as conn:
        conn.executescript(SCHEMA)
        for table, columns in MIGRATIONS.items():
            existing = {r[1] for r in conn.execute(f'PRAGMA table_info({table})')}
            for name, definition in columns.items():
                if name not in existing:
                    conn.execute(f'ALTER TABLE {table} ADD COLUMN {name} {definition}')
        if 'user_id' not in {r[1] for r in conn.execute('PRAGMA table_info(marks)')}:
            # Favorites and notes were keyed by question alone; rebuild them keyed by (user, question).
            conn.executescript('''ALTER TABLE marks RENAME TO marks_legacy;
                CREATE TABLE marks(user_id INTEGER REFERENCES users(id),
                    question_id TEXT NOT NULL REFERENCES questions(id), favorite INTEGER DEFAULT 0,
                    note TEXT DEFAULT '', PRIMARY KEY(user_id, question_id));
                INSERT INTO marks(user_id, question_id, favorite, note)
                    SELECT NULL, question_id, favorite, note FROM marks_legacy;
                DROP TABLE marks_legacy;''')
        # Sessions from before activity tracking count as last active when they were created.
        conn.execute('UPDATE sessions SET updated_at=created_at WHERE updated_at IS NULL')
        conn.executescript(USER_INDEXES)
        # Seed from the rebuildable bank files on first start; papers already stored are left alone.
        for bank in (ROOT / 'data/bank.json', ROOT / 'data/fenbi-bank.json'):
            if not bank.exists():
                continue
            for paper in json.loads(bank.read_text(encoding='utf-8'))['papers']:
                if not conn.execute('SELECT 1 FROM papers WHERE id=?', (paper['id'],)).fetchone():
                    store_paper(conn, paper)
