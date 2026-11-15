"""Study logic: question queries, practice sessions, scoring, marks and statistics.

The question bank is shared; sessions, answers, favorites and notes belong to the user `uid`.
"""
from __future__ import annotations

import json
import random
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from database import FIELDS, connect, decode

TZ = timezone(timedelta(hours=8))
MODE_TITLES = {'practice': '模块练习', 'review': '错题复习', 'exam': '整卷练习'}
MAX_SESSION_QUESTIONS = 200
# Answers in an unsubmitted exam are drafts: they never count toward stats, wrong lists or coverage.
COUNTED = "(s.mode!='exam' OR s.status='completed')"
QUESTION_COLUMNS = ','.join(k for k in FIELDS if k != 'raw')


def now():
    return datetime.now(TZ).isoformat(timespec='seconds')


def _last_correct(alias):
    """Subquery for the user's latest counted result on a question; takes one `uid` parameter."""
    return (f'(SELECT a.correct FROM attempts a JOIN sessions s ON s.id=a.session_id '
            f'WHERE a.question_id={alias}.id AND a.user_id=? AND {COUNTED} ORDER BY a.id DESC LIMIT 1)')


def where(filters, uid, alias='q'):
    """Translate filters into a SQL condition over questions; personal filters use `uid`'s records."""
    clauses, values = [], []
    for key in ('module', 'category', 'topic', 'paper_id', 'quality', 'type', 'year'):
        value = filters.get(key)
        if isinstance(value, list):
            # JSON bodies may pass several values, e.g. a mixed practice over three subjects.
            if not all(isinstance(v, str) for v in value):
                raise ValueError(f'筛选条件 {key} 格式错误')
            if value:
                clauses.append(f'{alias}.{key} IN ({",".join("?" for _ in value)})')
                values.extend(value)
        elif value:
            clauses.append(f'{alias}.{key}=?')
            values.append(value)
    for key in ('kind', 'exam_level'):
        if filters.get(key):
            clauses.append(f'EXISTS(SELECT 1 FROM papers p WHERE p.id={alias}.paper_id AND p.{key}=?)')
            values.append(filters[key])
    if filters.get('tag'):
        clauses.append(f'EXISTS(SELECT 1 FROM json_each({alias}.tags) WHERE value=?)')
        values.append(filters['tag'])
    if filters.get('search'):
        clauses.append(f'({alias}.stem LIKE ? OR {alias}.explanation LIKE ?)')
        values.extend(['%' + filters['search'] + '%'] * 2)
    if filters.get('favorite') == '1':
        clauses.append(f'EXISTS(SELECT 1 FROM marks m WHERE m.question_id={alias}.id AND m.user_id=? '
                       f'AND m.favorite=1)')
        values.append(uid)
    if filters.get('wrong') == '1':
        clauses.append(f'{_last_correct(alias)}=0')
        values.append(uid)
    if filters.get('unseen') == '1':
        clauses.append(f'NOT EXISTS(SELECT 1 FROM attempts a JOIN sessions s ON s.id=a.session_id '
                       f'WHERE a.question_id={alias}.id AND a.user_id=? AND {COUNTED})')
        values.append(uid)
    return (' AND '.join(clauses) or '1=1'), values


# ---------------------------------------------------------------- questions

def list_questions(uid, filters):
    clause, args = where(filters, uid)
    page = max(1, int(filters.get('page', 1)))
    limit = min(100, max(1, int(filters.get('limit', 20))))
    columns = ','.join('q.' + k for k in FIELDS if k not in ('answer', 'explanation', 'raw'))
    with connect() as c:
        total = c.execute(f'SELECT count(*) FROM questions q WHERE {clause}', args).fetchone()[0]
        rows = c.execute(f'''SELECT {columns}, coalesce(m.favorite,0) favorite, coalesce(m.note,'') note,
            {_last_correct('q')} last_correct
            FROM questions q LEFT JOIN marks m ON m.question_id=q.id AND m.user_id=? WHERE {clause}
            ORDER BY q.year DESC, q.paper_id, q.number LIMIT ? OFFSET ?''',
                         [uid, uid] + args + [limit, (page - 1) * limit]).fetchall()
    return {'items': [decode(r) for r in rows], 'total': total, 'page': page,
            'pages': (total + limit - 1) // limit}


def get_question(qid, with_answer=False, include_raw=True, uid=None):
    """One question; favorite and note come from `uid` (none when uid is None)."""
    excluded = set() if with_answer else {'answer', 'explanation', 'raw'}
    if not include_raw:
        excluded.add('raw')
    columns = ','.join('q.' + k for k in FIELDS if k not in excluded)
    with connect() as c:
        row = c.execute(f'''SELECT {columns}, q.edited, coalesce(m.favorite,0) favorite, coalesce(m.note,'') note
            FROM questions q LEFT JOIN marks m ON q.id=m.question_id AND m.user_id=? WHERE q.id=?''',
                        (uid, qid)).fetchone()
    if not row:
        raise ValueError('题目不存在')
    return decode(row)


def metadata(uid):
    """Everything the non-practice screens need in one request: papers, facets, counts, recent sessions."""
    with connect() as c:
        papers = [dict(r) for r in c.execute('''SELECT p.id, p.title, p.year, p.duration_minutes, p.subject,
            p.kind, p.exam_level, count(q.paper_id) total, coalesce(sum(q.quality='ready'),0) ready
            FROM papers p LEFT JOIN questions q ON q.paper_id=p.id GROUP BY p.id ORDER BY p.year DESC''')]
        facets = [dict(r) for r in c.execute('''SELECT module, category, topic, count(*) total,
            sum(quality='ready') ready, sum(quality='review') review
            FROM questions GROUP BY module, category, topic''')]
        tags = [r[0] for r in c.execute('''SELECT DISTINCT j.value FROM (SELECT DISTINCT tags FROM questions) t,
            json_each(t.tags) j ORDER BY j.value''')]
        counts = {k: sum(f[k] for f in facets) for k in ('total', 'ready', 'review')}
        for facet in facets:
            facet.pop('review')
        counts['favorites'] = c.execute('SELECT count(*) FROM marks WHERE user_id=? AND favorite=1',
                                        (uid,)).fetchone()[0]
        counts['wrong'] = c.execute(f'''SELECT count(*) FROM attempts a JOIN sessions s ON s.id=a.session_id
            WHERE a.user_id=? AND {COUNTED} AND a.correct=0 AND a.id=(
                SELECT max(b.id) FROM attempts b JOIN sessions s ON s.id=b.session_id
                WHERE b.question_id=a.question_id AND b.user_id=a.user_id AND {COUNTED})''',
                                    (uid,)).fetchone()[0]
        counts['seen'] = c.execute(f'''SELECT count(DISTINCT a.question_id) FROM attempts a
            JOIN sessions s ON s.id=a.session_id WHERE a.user_id=? AND {COUNTED}''', (uid,)).fetchone()[0]
        done = dict(c.execute(f'''SELECT q.paper_id, count(DISTINCT a.question_id) FROM attempts a
            JOIN sessions s ON s.id=a.session_id JOIN questions q ON q.id=a.question_id
            WHERE a.user_id=? AND {COUNTED} GROUP BY q.paper_id''', (uid,)).fetchall())
        for paper in papers:
            paper['done'] = done.get(paper['id'], 0)
        sessions = [_session_summary(r) for r in c.execute('''SELECT id, title, mode, created_at, updated_at,
            status, position, drafts, json_array_length(question_ids) total,
            (SELECT count(*) FROM attempts a WHERE a.session_id=sessions.id) answered,
            (SELECT count(*) FROM attempts a WHERE a.session_id=sessions.id AND a.correct=1) correct,
            (SELECT count(*) FROM attempts a WHERE a.session_id=sessions.id AND a.correct IS NOT NULL) graded
            FROM sessions WHERE user_id=? ORDER BY updated_at DESC LIMIT 12''', (uid,))]
    return {'papers': papers, 'facets': facets, 'tags': tags, 'counts': counts, 'sessions': sessions}


# ---------------------------------------------------------------- sessions

def _filled(selected):
    return isinstance(selected, list) and any(isinstance(x, str) and x.strip() for x in selected)


def _session_summary(row):
    """Home-page view of a session: `started` once anything has been answered or filled in."""
    session = dict(row)
    drafts = json.loads(session.pop('drafts') or '{}')
    session['filled'] = sum(1 for key, draft in drafts.items()
                            if not key.startswith('__') and isinstance(draft, dict) and _filled(draft.get('selected')))
    session['started'] = bool(session['answered'] or session['filled'])
    return session


def _touch(conn, sid):
    conn.execute('UPDATE sessions SET updated_at=? WHERE id=?', (now(), sid))


def create_session(uid, data):
    mode = data.get('mode', 'practice')
    if mode not in MODE_TITLES:
        raise ValueError('无效练习模式')
    explicit = data.get('question_ids')
    with connect() as c:
        if explicit is not None:
            # Re-practice a known set (e.g. the wrong answers of a finished session) in the given order.
            if not isinstance(explicit, list) or not all(isinstance(x, str) for x in explicit):
                raise ValueError('题目列表格式错误')
            ready = {r['id'] for r in c.execute(
                "SELECT id FROM questions WHERE quality='ready' AND id IN (SELECT value FROM json_each(?))",
                (json.dumps(explicit),))}
            ids = [x for x in dict.fromkeys(explicit) if x in ready][:MAX_SESSION_QUESTIONS]
        else:
            filters = dict(data.get('filters') or {}, quality='ready')
            if mode == 'review':
                filters['wrong'] = '1'
            limit = None
            if not data.get('full_paper') and (mode != 'exam' or data.get('count') is not None):
                limit = min(MAX_SESSION_QUESTIONS, max(1, int(data.get('count', 20))))
            where(filters, uid)  # validate every filter value before any per-subject query
            modules = filters.get('module')
            if limit and isinstance(modules, list) and len(modules) > 1:
                # Mixed subjects share the count evenly, otherwise a large bank crowds out small ones.
                pools = []
                for module in dict.fromkeys(modules):
                    pool = _matching_ids(c, dict(filters, module=module), uid)
                    random.shuffle(pool)
                    pools.append(pool)
                ids = _balanced(pools, limit)
                random.shuffle(ids)
            else:
                ids = _matching_ids(c, filters, uid)
                # A whole paper in exam mode keeps its original order unless shuffling is asked for.
                if data.get('shuffle', mode != 'exam' or not filters.get('paper_id')):
                    random.shuffle(ids)
                if limit:
                    ids = ids[:limit]
        if not ids:
            raise ValueError('当前条件下没有可练习题目；待核验题默认不参与组卷。')
        sid = uuid.uuid4().hex
        title = str(data.get('title') or MODE_TITLES[mode])[:120]
        created = now()
        c.execute('''INSERT INTO sessions(id,created_at,updated_at,mode,title,question_ids,user_id)
            VALUES(?,?,?,?,?,?,?)''', (sid, created, created, mode, title, json.dumps(ids), uid))
    return get_session(uid, sid)


def _matching_ids(conn, filters, uid):
    clause, args = where(filters, uid)
    return [r['id'] for r in conn.execute(
        f'SELECT id FROM questions q WHERE {clause} ORDER BY year DESC, paper_id, number', args)]


def _balanced(pools, count):
    """Take up to `count` items round-robin; a short pool's unused share goes to the others."""
    picked = [[] for _ in pools]
    total = 0
    while total < count:
        progressed = False
        for taken, pool in zip(picked, pools):
            if total < count and len(taken) < len(pool):
                taken.append(pool[len(taken)])
                total += 1
                progressed = True
        if not progressed:
            break
    return [x for taken in picked for x in taken]


def _read_session(conn, uid, sid):
    # Another user's session looks exactly like a missing one.
    row = conn.execute('SELECT * FROM sessions WHERE id=? AND user_id=?', (sid, uid)).fetchone()
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


def _load_questions(conn, ids):
    rows = conn.execute(f'SELECT {QUESTION_COLUMNS} FROM questions WHERE id IN (SELECT value FROM json_each(?))',
                        (json.dumps(ids),))
    return {r['id']: decode(r) for r in rows}


def _clamp_position(session, data):
    return max(0, min(len(session['question_ids']) - 1, int(data.get('position', session['position']))))


def _drafts(session, data):
    drafts = data.get('drafts', session['drafts'])
    if not isinstance(drafts, dict):
        raise ValueError('暂存数据格式错误')
    return drafts


def get_session(uid, sid):
    with connect() as conn:
        session = _read_session(conn, uid, sid)
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
    """Store one answer. Without `replace`, a repeated submission returns the first result unchanged."""
    selected, elapsed = _validate_answer(question, selected, elapsed)
    gradable = question['type'] != 'essay' and question['answer'] and question['quality'] == 'ready'
    correct = int(selected == sorted(question['answer'])) if gradable else None
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
        first = not conn.execute('SELECT 1 FROM attempts WHERE question_id=? AND user_id=? LIMIT 1',
                                 (question['id'], session['user_id'])).fetchone()
        conn.execute('''INSERT INTO attempts(question_id,session_id,selected,correct,elapsed_ms,
            created_at,is_first,mode,answer_snapshot,user_id) VALUES(?,?,?,?,?,?,?,?,?,?)''',
                     (question['id'], session['id'], json.dumps(selected), correct, elapsed, now(),
                      int(first), session['mode'], json.dumps(snapshot), session['user_id']))
    essay = question['type'] == 'essay'
    return dict(question_id=question['id'], correct=correct, selected=selected,
                elapsed_ms=elapsed, answer=snapshot,
                explanation=snapshot[0] if essay and snapshot else question['explanation'],
                duplicate=bool(old))


def update_session(uid, sid, data):
    """Autosave position and drafts. Returns a light acknowledgement, not the whole session."""
    if data.get('status') == 'completed':
        return finish_session(uid, sid, data)
    if data.get('status', 'active') != 'active':
        raise ValueError('无效练习状态')
    with connect() as conn:
        conn.execute('BEGIN IMMEDIATE')
        session = _read_session(conn, uid, sid)
        # An in-flight autosave must never reopen or overwrite a submitted exam.
        if session['status'] == 'completed':
            return dict(saved=True, status='completed', position=session['position'])
        position = _clamp_position(session, data)
        drafts = _drafts(session, data)
        if drafts.get('__updated', 0) < session['drafts'].get('__updated', 0):
            return dict(saved=True, stale=True, status='active', position=session['position'])
        conn.execute('UPDATE sessions SET position=?,drafts=?,updated_at=? WHERE id=?',
                     (position, json.dumps(drafts, ensure_ascii=False), now(), sid))
    return dict(saved=True, status='active', position=position)


def answer(uid, sid, data):
    """Grade one question immediately (practice and review modes)."""
    with connect() as conn:
        conn.execute('BEGIN IMMEDIATE')
        session = _read_session(conn, uid, sid)
        qid = data.get('question_id')
        if qid not in session['question_ids']:
            raise ValueError('该题不在本次练习中')
        if session['mode'] == 'exam' and session['status'] == 'active':
            raise ValueError('考试模式请完成整卷后交卷，不逐题判分')
        old = conn.execute('SELECT 1 FROM attempts WHERE session_id=? AND question_id=?', (sid, qid)).fetchone()
        if session['status'] != 'active' and not old:
            raise ValueError('练习已结束')
        question = _load_questions(conn, [qid])[qid]
        result = _record_answer(conn, session, question, data.get('selected'), data.get('elapsed_ms', 0))
        _touch(conn, sid)
        return result


def _is_blank(question, selected):
    if not selected:
        return True
    return (question['type'] == 'essay' and isinstance(selected, list) and len(selected) == 1
            and isinstance(selected[0], str) and not selected[0].strip())


def finish_session(uid, sid, data):
    """End a session. Exams are graded here, atomically, from the submitted drafts."""
    with connect() as conn:
        conn.execute('BEGIN IMMEDIATE')
        session = _read_session(conn, uid, sid)
        if session['status'] == 'active':
            drafts = _drafts(session, data)
            position = _clamp_position(session, data)
            if session['mode'] == 'exam':
                questions = _load_questions(conn, session['question_ids'])
                previous = {a['question_id']: a for a in session['attempts']}
                for qid in session['question_ids']:
                    draft = drafts.get(qid, previous.get(qid, {}))
                    if not isinstance(draft, dict):
                        raise ValueError('单题暂存数据格式错误')
                    selected = draft.get('selected', [])
                    if _is_blank(questions[qid], selected):
                        # Removing a previously selected answer leaves it unscored.
                        conn.execute('DELETE FROM attempts WHERE session_id=? AND question_id=?', (sid, qid))
                        continue
                    _record_answer(conn, session, questions[qid], selected, draft.get('elapsed_ms', 0),
                                   replace=True)
            conn.execute("UPDATE sessions SET position=?,drafts=?,status='completed',updated_at=? WHERE id=?",
                         (position, json.dumps(drafts, ensure_ascii=False), now(), sid))
    return get_session(uid, sid)


def discard_session(uid, sid):
    """Drop an unfinished session. Practice answers already submitted stay in the history."""
    with connect() as conn:
        conn.execute('BEGIN IMMEDIATE')
        session = _read_session(conn, uid, sid)
        if session['status'] != 'active':
            return dict(discarded=False, status='completed')
        if session['attempts']:
            conn.execute("UPDATE sessions SET status='completed' WHERE id=?", (sid,))
            return dict(discarded=False, status='completed')
        conn.execute('DELETE FROM sessions WHERE id=?', (sid,))
    return dict(discarded=True, status='deleted')


# ---------------------------------------------------------------- marks

def mark(uid, qid, data):
    get_question(qid)
    with connect() as c:
        old = c.execute('SELECT * FROM marks WHERE user_id=? AND question_id=?', (uid, qid)).fetchone()
        favorite = int(bool(data.get('favorite', old['favorite'] if old else False)))
        note = str(data.get('note', old['note'] if old else ''))[:20000]
        c.execute('''INSERT INTO marks(user_id,question_id,favorite,note) VALUES(?,?,?,?)
            ON CONFLICT(user_id,question_id) DO UPDATE SET favorite=excluded.favorite, note=excluded.note''',
                  (uid, qid, favorite, note))
    return {'favorite': favorite, 'note': note}


# ---------------------------------------------------------------- statistics

def aggregate(rows):
    graded = [r for r in rows if r['correct'] is not None]
    correct = sum(r['correct'] == 1 for r in graded)
    elapsed = sum(r['elapsed_ms'] for r in rows)
    return {'count': len(rows), 'graded': len(graded), 'correct': correct, 'wrong': len(graded) - correct,
            'accuracy': round(correct / len(graded) * 100, 1) if graded else None,
            'elapsed_ms': elapsed, 'avg_ms': round(elapsed / len(rows)) if rows else 0,
            'unique': len({r['question_id'] for r in rows})}


def statistics(uid, filters):
    """Summary, today, daily trend and grouped breakdown, all by Beijing calendar day."""
    clause, args = where(filters, uid)
    today = datetime.now(TZ).date()
    days = max(0, min(3650, int(filters.get('days', 7))))
    extra = ['a.user_id=?']
    args.append(uid)
    if days:
        extra.append('substr(a.created_at,1,10)>=?')
        args.append((today - timedelta(days=days - 1)).isoformat())
    extra.append('substr(a.created_at,1,10)<=?')
    args.append(today.isoformat())
    extra.append(f'EXISTS(SELECT 1 FROM sessions s WHERE s.id=a.session_id AND {COUNTED})')
    if filters.get('attempt') == 'first':
        extra.append('a.is_first=1')
    if filters.get('mode'):
        extra.append('a.mode=?')
        args.append(filters['mode'])
    with connect() as c:
        rows = [dict(r) for r in c.execute(f'''SELECT a.*, q.module, q.category, q.topic, q.tags, q.paper_id
            FROM attempts a JOIN questions q ON q.id=a.question_id
            WHERE {clause} AND {" AND ".join(extra)}''', args)]
    group = filters.get('group', 'module')
    if group not in ('module', 'category', 'topic', 'tag'):
        group = 'module'
    daily, groups = defaultdict(list), defaultdict(list)
    for r in rows:
        daily[r['created_at'][:10]].append(r)
        for key in (json.loads(r['tags']) if group == 'tag' else [r[group]]):
            groups[key].append(r)
    if days:
        start = today - timedelta(days=days - 1)
    else:
        start = datetime.fromisoformat(min(daily) if daily else today.isoformat()).date()
    trend = []
    date = start
    while date <= today:
        key = date.isoformat()
        trend.append(dict(date=key, **aggregate(daily[key])))
        date += timedelta(days=1)
    return {'summary': aggregate(rows), 'today': aggregate(daily[today.isoformat()]), 'trend': trend,
            'groups': [dict(name=k, last=max(x['created_at'] for x in v), **aggregate(v)) for k, v in groups.items()],
            'timezone': 'Asia/Shanghai', 'group': group}
