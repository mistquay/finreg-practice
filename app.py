"""Single-user study application. Python standard library only; listens on localhost by default."""
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
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

import database
import importer
import services

ROOT = Path(__file__).resolve().parent
MAX_BODY = 30_000_000
# URL prefix -> folder under ROOT; everything else is served from web/.
STATIC_DIRS = {'/sources/': 'data/sources', '/assets/': 'data/assets'}
CLIENT_ERRORS = (ValueError, KeyError, TypeError)


class Download:
    """A binary attachment response."""

    def __init__(self, body, filename):
        self.body, self.filename = body, filename


# ---------------------------------------------------------------- GET handlers (filters -> response)

def get_meta(filters):
    started = time.perf_counter()
    meta = services.metadata()
    return meta, {'Server-Timing': f'meta;dur={(time.perf_counter() - started) * 1000:.1f}'}


def get_question(filters, qid):
    return services.get_question(qid, filters.get('answer') == '1', filters.get('compact') != '1')


def get_backup(filters):
    # The SQLite backup API gives a consistent copy while the server keeps running.
    with tempfile.TemporaryDirectory() as tmp:
        target = Path(tmp) / 'practice.sqlite3'
        with database.connect() as src, closing(sqlite3.connect(target)) as dest:
            src.backup(dest)
        return Download(target.read_bytes(), 'finreg-backup.sqlite3')


def get_export(filters):
    with database.connect() as c:
        papers = [dict(p) for p in c.execute('SELECT * FROM papers')]
        for p in papers:
            p['questions'] = [database.decode(q) for q in c.execute(
                'SELECT * FROM questions WHERE paper_id=? ORDER BY number', (p['id'],))]
    return {'version': 1, 'papers': papers}, {'Content-Disposition': 'attachment; filename="finreg-questions.json"'}


GET_ROUTES = [
    (r'/healthz', lambda f: {'status': 'ok'}),
    (r'/api/meta', get_meta),
    (r'/api/questions', services.list_questions),
    (r'/api/question/([^/]+)', get_question),
    (r'/api/session/([^/]+)', lambda f, sid: services.get_session(sid)),
    (r'/api/stats', services.statistics),
    (r'/api/backup', get_backup),
    (r'/api/export', get_export),
]

POST_ROUTES = [
    (r'/api/session', lambda body: services.create_session(body)),
    (r'/api/session/([^/]+)', lambda body, sid: services.update_session(sid, body)),
    (r'/api/session/([^/]+)/answer', lambda body, sid: services.answer(sid, body)),
    (r'/api/session/([^/]+)/finish', lambda body, sid: services.finish_session(sid, body)),
    (r'/api/session/([^/]+)/discard', lambda body, sid: services.discard_session(sid)),
    (r'/api/mark/([^/]+)', lambda body, qid: services.mark(qid, body)),
    (r'/api/edit/([^/]+)', lambda body, qid: importer.edit_question(qid, body)),
    (r'/api/import', lambda body: importer.import_data(body['data'], body.get('preview', False))),
]


def match(routes, path):
    for pattern, handler in routes:
        m = re.fullmatch(pattern, path)
        if m:
            return handler, [unquote(g) for g in m.groups()]
    return None, None


class Handler(BaseHTTPRequestHandler):
    def send(self, data, status=200, ctype='application/json; charset=utf-8', headers=None):
        headers = dict(headers or {})
        is_json = ctype.startswith('application/json')
        body = json.dumps(data, ensure_ascii=False, separators=(',', ':')).encode() if is_json else data
        accepts = {part.strip() for part in self.headers.get('Accept-Encoding', '').split(',')}
        if is_json and len(body) > 1024 and 'gzip' in accepts:
            body = gzip.compress(body, compresslevel=1)
            headers.update({'Content-Encoding': 'gzip', 'Vary': 'Accept-Encoding'})
        self.send_response(status)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Cache-Control', 'no-store')
        for k, v in headers.items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def json_body(self):
        if not self.headers.get('Content-Type', '').startswith('application/json'):
            raise ValueError('请提交 JSON 数据')
        size = int(self.headers.get('Content-Length', 0))
        if size < 1 or size > MAX_BODY:
            raise ValueError('数据大小不合法（上限30MB）')
        return json.loads(self.rfile.read(size))

    def respond(self, result):
        headers = None
        if isinstance(result, tuple):
            result, headers = result
        if isinstance(result, Download):
            return self.send(result.body, ctype='application/octet-stream',
                             headers={'Content-Disposition': f'attachment; filename="{result.filename}"'})
        return self.send(result, headers=headers)

    def send_static(self, path):
        for prefix, folder in STATIC_DIRS.items():
            if path.startswith(prefix):
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

    def do_GET(self):
        url = urlparse(self.path)
        filters = {k: v[-1] for k, v in parse_qs(url.query).items()}
        try:
            handler, args = match(GET_ROUTES, url.path)
            if handler:
                return self.respond(handler(filters, *args))
            return self.send_static(url.path)
        except CLIENT_ERRORS as e:
            return self.send({'error': str(e)}, 400)
        except Exception:
            traceback.print_exc()
            return self.send({'error': '服务处理失败，请查看服务日志'}, 500)

    def do_POST(self):
        try:
            handler, args = match(POST_ROUTES, urlparse(self.path).path)
            if not handler:
                return self.send({'error': '接口不存在'}, 404)
            return self.respond(handler(self.json_body(), *args))
        except CLIENT_ERRORS + (sqlite3.IntegrityError,) as e:
            return self.send({'error': str(e)}, 400)
        except Exception:
            traceback.print_exc()
            return self.send({'error': '保存失败，请查看服务日志'}, 500)

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
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
