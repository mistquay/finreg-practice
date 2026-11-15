"""Multi-user study application. Python standard library only; listens on localhost by default."""
import argparse
import gzip
import json
import mimetypes
import os
import re
import signal
import sqlite3
import tempfile
import time
import traceback
from contextlib import closing
from http.cookies import CookieError, SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

import auth
import database
import importer
import services

ROOT = Path(__file__).resolve().parent
MAX_BODY = 30_000_000
# URL prefix -> folder under ROOT; everything else is served from web/. Both need a signed-in user.
STATIC_DIRS = {'/sources/': 'data/sources', '/assets/': 'data/assets'}
CLIENT_ERRORS = (ValueError, KeyError, TypeError, sqlite3.IntegrityError)
PUBLIC, USER, ADMIN = 'public', 'user', 'admin'
CSP = ("default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; object-src 'none'; "
       "base-uri 'self'; form-action 'self'; frame-ancestors 'none'")


class Download:
    """A binary attachment response."""

    def __init__(self, body, filename):
        self.body, self.filename = body, filename


class Request:
    """What a route handler sees. Set `cookie` to a token to sign in, or to '' to sign out."""

    def __init__(self, user, token, filters=None, body=None):
        self.user, self.token, self.filters, self.body = user, token, filters or {}, body or {}
        self.cookie = None

    @property
    def uid(self):
        return self.user['id']


# ---------------------------------------------------------------- handlers

def auth_me(req):
    return {'user': req.user, 'setup': not auth.has_users()}


def sign_in(req, uid):
    auth.end_session(req.token)
    req.cookie = auth.start_session(uid)
    return {'user': auth.session_user(req.cookie)}


def auth_logout(req):
    auth.end_session(req.token)
    req.cookie = ''
    return {'user': None}


def get_meta(req):
    started = time.perf_counter()
    meta = services.metadata(req.uid)
    return meta, {'Server-Timing': f'meta;dur={(time.perf_counter() - started) * 1000:.1f}'}


def get_question(req, qid):
    return services.get_question(qid, req.filters.get('answer') == '1', req.filters.get('compact') != '1',
                                 uid=req.uid)


def get_backup(req):
    # The SQLite backup API gives a consistent copy while the server keeps running.
    with tempfile.TemporaryDirectory() as tmp:
        target = Path(tmp) / 'practice.sqlite3'
        with database.connect() as src, closing(sqlite3.connect(target)) as dest:
            src.backup(dest)
        return Download(target.read_bytes(), 'finreg-backup.sqlite3')


def get_export(req):
    with database.connect() as c:
        papers = [dict(p) for p in c.execute('SELECT * FROM papers')]
        for p in papers:
            p['questions'] = [database.decode(q) for q in c.execute(
                'SELECT * FROM questions WHERE paper_id=? ORDER BY number', (p['id'],))]
    return {'version': 1, 'papers': papers}, {'Content-Disposition': 'attachment; filename="finreg-questions.json"'}


# (method, path pattern, who may call it, handler(request, *path groups))
ROUTES = [
    ('GET', r'/healthz', PUBLIC, lambda r: {'status': 'ok'}),
    ('GET', r'/api/auth/me', PUBLIC, auth_me),
    ('POST', r'/api/auth/login', PUBLIC,
     lambda r: sign_in(r, auth.login(r.body.get('username'), r.body.get('password')))),
    ('POST', r'/api/auth/register', PUBLIC, lambda r: sign_in(r, auth.register(r.body))),
    ('POST', r'/api/auth/logout', PUBLIC, auth_logout),
    ('POST', r'/api/auth/password', USER, lambda r: auth.change_password(r.uid, r.token, r.body)),

    ('GET', r'/api/meta', USER, get_meta),
    ('GET', r'/api/questions', USER, lambda r: services.list_questions(r.uid, r.filters)),
    ('GET', r'/api/question/([^/]+)', USER, get_question),
    ('GET', r'/api/session/([^/]+)', USER, lambda r, sid: services.get_session(r.uid, sid)),
    ('GET', r'/api/stats', USER, lambda r: services.statistics(r.uid, r.filters)),
    ('GET', r'/api/dashboard', USER, lambda r: services.dashboard(r.uid)),
    ('GET', r'/api/settings', USER, lambda r: services.get_settings(r.uid)),
    ('POST', r'/api/settings', USER, lambda r: services.save_settings(r.uid, r.body)),
    ('POST', r'/api/session', USER, lambda r: services.create_session(r.uid, r.body)),
    ('POST', r'/api/session/([^/]+)', USER, lambda r, sid: services.update_session(r.uid, sid, r.body)),
    ('POST', r'/api/session/([^/]+)/answer', USER, lambda r, sid: services.answer(r.uid, sid, r.body)),
    ('POST', r'/api/session/([^/]+)/finish', USER, lambda r, sid: services.finish_session(r.uid, sid, r.body)),
    ('POST', r'/api/session/([^/]+)/discard', USER, lambda r, sid: services.discard_session(r.uid, sid)),
    ('POST', r'/api/mark/([^/]+)', USER, lambda r, qid: services.mark(r.uid, qid, r.body)),

    ('GET', r'/api/backup', ADMIN, get_backup),
    ('GET', r'/api/export', ADMIN, get_export),
    ('POST', r'/api/edit/([^/]+)', ADMIN, lambda r, qid: importer.edit_question(qid, r.body)),
    ('POST', r'/api/import', ADMIN,
     lambda r: importer.import_data(r.body['data'], r.body.get('preview', False))),
    ('GET', r'/api/admin/users', ADMIN, lambda r: auth.overview()),
    ('POST', r'/api/admin/users/(\d+)', ADMIN, lambda r, uid: auth.update_user(r.uid, int(uid), r.body)),
    ('POST', r'/api/admin/invites', ADMIN, lambda r: auth.create_invite(r.uid)),
    ('POST', r'/api/admin/invites/([^/]+)/revoke', ADMIN, lambda r, code: auth.revoke_invite(code)),
]


def match(method, path):
    for route_method, pattern, access, handler in ROUTES:
        m = route_method == method and re.fullmatch(pattern, path)
        if m:
            return access, handler, [unquote(g) for g in m.groups()]
    return None


def session_cookie(token, secure):
    parts = [f'{auth.COOKIE}={token}', 'Path=/', 'HttpOnly', 'SameSite=Lax',
             f'Max-Age={auth.SESSION_DAYS * 86400 if token else 0}']
    if secure:
        parts.append('Secure')
    return '; '.join(parts)


class Handler(BaseHTTPRequestHandler):
    def send(self, data, status=200, ctype='application/json; charset=utf-8', headers=None):
        headers = dict(headers or {})
        is_json = ctype.startswith('application/json')
        body = json.dumps(data, ensure_ascii=False, separators=(',', ':')).encode() if is_json else data
        accepts = {part.strip() for part in self.headers.get('Accept-Encoding', '').split(',')}
        if is_json and len(body) > 1024 and 'gzip' in accepts:
            body = gzip.compress(body, compresslevel=1)
            headers.update({'Content-Encoding': 'gzip', 'Vary': 'Accept-Encoding'})
        if ctype.startswith('text/html'):
            headers['Content-Security-Policy'] = CSP
        self.send_response(status)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('Referrer-Policy', 'same-origin')
        self.send_header('Cache-Control', 'no-store')
        for k, v in headers.items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def json_body(self):
        # Requiring JSON (plus SameSite cookies) keeps other sites from posting forms as the user.
        if not self.headers.get('Content-Type', '').startswith('application/json'):
            raise ValueError('请提交 JSON 数据')
        size = int(self.headers.get('Content-Length', 0))
        if size < 1 or size > MAX_BODY:
            raise ValueError('数据大小不合法（上限30MB）')
        return json.loads(self.rfile.read(size))

    def token(self):
        jar = SimpleCookie()
        try:
            jar.load(self.headers.get('Cookie', ''))
        except CookieError:
            return None
        morsel = jar.get(auth.COOKIE)
        return morsel.value if morsel else None

    def https(self):
        # Behind Nginx with TLS the cookie is marked Secure; plain local HTTP keeps working.
        return self.headers.get('X-Forwarded-Proto', '').split(',')[0].strip().lower() == 'https'

    def respond(self, result, req):
        headers = {}
        if isinstance(result, tuple):
            result, headers = result
        if req.cookie is not None:
            headers['Set-Cookie'] = session_cookie(req.cookie, self.https())
        if isinstance(result, Download):
            headers['Content-Disposition'] = f'attachment; filename="{result.filename}"'
            return self.send(result.body, ctype='application/octet-stream', headers=headers)
        return self.send(result, headers=headers)

    def send_static(self, path, user):
        for prefix, folder in STATIC_DIRS.items():
            if path.startswith(prefix):
                if not user:
                    return self.send({'error': '请先登录'}, 401)
                base, name = ROOT / folder, unquote(path[len(prefix):])
                break
        else:
            base, name = ROOT / 'web', unquote(path.lstrip('/')) or 'index.html'
        file = (base / name).resolve()
        if not file.is_relative_to(base.resolve()) or not file.is_file():
            return self.send({'error': '文件不存在'}, 404)
        ctype = mimetypes.guess_type(str(file))[0] or 'application/octet-stream'
        if file.suffix == '.js':
            ctype = 'text/javascript; charset=utf-8'
        return self.send(file.read_bytes(), ctype=ctype)

    def dispatch(self, method):
        url = urlparse(self.path)
        token = self.token()
        try:
            user = auth.session_user(token)
            route = match(method, url.path)
            if not route:
                if method == 'GET':
                    return self.send_static(url.path, user)
                return self.send({'error': '接口不存在'}, 404)
            access, handler, args = route
            if access != PUBLIC and not user:
                return self.send({'error': '请先登录'}, 401)
            if access == ADMIN and user['role'] != 'admin':
                return self.send({'error': '需要管理员权限'}, 403)
            req = Request(user, token)
            if method == 'GET':
                req.filters = {k: v[-1] for k, v in parse_qs(url.query).items()}
            else:
                req.body = self.json_body()
            return self.respond(handler(req, *args), req)
        except CLIENT_ERRORS as e:
            return self.send({'error': str(e)}, 400)
        except Exception:
            traceback.print_exc()
            return self.send({'error': '服务处理失败，请查看服务日志'}, 500)

    def do_GET(self):
        self.dispatch('GET')

    def do_POST(self):
        self.dispatch('POST')

    def log_message(self, fmt, *args):
        print(f'{self.log_date_time_string()} {fmt % args}', flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--host', default=os.environ.get('FINREG_HOST', '127.0.0.1'))
    parser.add_argument('--port', type=int, default=int(os.environ.get('FINREG_PORT', '8765')))
    args = parser.parse_args()
    database.initialize()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    server.daemon_threads = False

    def stop(signum, frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, stop)
    print(f'FinReg Practice: http://{args.host}:{args.port}', flush=True)
    code = auth.setup_code()
    if code:
        print(f'尚未创建账号。打开页面，用初始化码 {auth.format_code(code)} 创建管理员账号；'
              f'现有学习记录将归入该账号。', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
