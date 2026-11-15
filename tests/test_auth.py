import json
import tempfile
import threading
import unittest
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import app
import auth
import database
import services


class AuthTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old = database.DB_PATH
        database.DB_PATH = Path(self.tmp.name) / 'auth.sqlite3'
        database.initialize()
        auth._setup['code'] = None
        auth._failures.clear()
        self.sleep = patch.object(auth.time, 'sleep')
        self.sleep.start()

    def tearDown(self):
        self.sleep.stop()
        database.DB_PATH = self.old
        self.tmp.cleanup()

    def admin(self):
        code = auth.setup_code()
        return auth.register({'username': 'owner', 'password': 'owner-password', 'code': auth.format_code(code)})

    def invite(self, admin_uid):
        return auth.create_invite(admin_uid)['code']

    def test_password_hash_round_trip(self):
        stored = auth.hash_password('correct horse')
        self.assertTrue(stored.startswith('scrypt$'))
        self.assertTrue(auth.verify_password('correct horse', stored))
        self.assertFalse(auth.verify_password('wrong horse', stored))
        self.assertFalse(auth.verify_password('x', 'not-a-hash'))

    def test_first_account_needs_setup_code_and_takes_over_existing_records(self):
        with database.connect() as c:
            c.execute("INSERT INTO sessions(id,created_at,mode,title,question_ids) VALUES('old','2026-11-01T08:00:00+08:00','practice','旧练习','[]')")
            c.execute("INSERT INTO marks(user_id,question_id,favorite,note) VALUES(NULL,'pdf-2024-001',1,'旧笔记')")
        with self.assertRaisesRegex(ValueError, '初始化码'):
            auth.register({'username': 'intruder', 'password': 'password-123', 'code': 'WRONG'})
        uid = self.admin()
        self.assertEqual(auth.session_user(auth.start_session(uid))['role'], 'admin')
        self.assertIsNone(auth.setup_code())
        self.assertEqual(services.get_session(uid, 'old')['title'], '旧练习')
        self.assertEqual(services.get_question('pdf-2024-001', uid=uid)['note'], '旧笔记')

    def test_setup_code_from_environment(self):
        with patch.dict('os.environ', {'FINREG_SETUP_CODE': 'abcd-efgh-jkmn'}):
            self.assertEqual(auth.setup_code(), 'ABCDEFGHJKMN')

    def test_invite_codes_are_single_use_and_revocable(self):
        admin = self.admin()
        code = self.invite(admin)
        uid = auth.register({'username': '朋友', 'password': 'friend-password', 'code': code.lower()})
        self.assertEqual(auth.session_user(auth.start_session(uid))['role'], 'user')
        with self.assertRaisesRegex(ValueError, '邀请码'):
            auth.register({'username': 'second', 'password': 'friend-password', 'code': code})
        revoked = self.invite(admin)
        auth.revoke_invite(revoked)
        with self.assertRaisesRegex(ValueError, '邀请码'):
            auth.register({'username': 'third', 'password': 'friend-password', 'code': revoked})
        expired = self.invite(admin)
        with database.connect() as c:
            c.execute('UPDATE invites SET expires_at=? WHERE code=?',
                      (auth.stamp(-timedelta(minutes=1)), auth.normalize_code(expired)))
        with self.assertRaisesRegex(ValueError, '邀请码'):
            auth.register({'username': 'fourth', 'password': 'friend-password', 'code': expired})
        statuses = {i['code']: i['status'] for i in auth.overview()['invites']}
        self.assertEqual(statuses, {code: 'used', revoked: 'revoked', expired: 'expired'})
        with self.assertRaisesRegex(ValueError, '已被使用'):
            auth.register({'username': 'OWNER', 'password': 'friend-password', 'code': self.invite(admin)})

    def test_login_checks_password_lockout_and_disabled_accounts(self):
        admin = self.admin()
        uid = auth.register({'username': 'friend', 'password': 'friend-password', 'code': self.invite(admin)})
        self.assertEqual(auth.login('FRIEND', 'friend-password'), uid)
        for _ in range(auth.MAX_FAILURES):
            with self.assertRaisesRegex(ValueError, '用户名或密码错误'):
                auth.login('friend', 'nope')
        with self.assertRaisesRegex(ValueError, '次数过多'):
            auth.login('friend', 'friend-password')
        auth._failures.clear()
        token = auth.start_session(uid)
        auth.update_user(admin, uid, {'disabled': True})
        self.assertIsNone(auth.session_user(token))
        with self.assertRaisesRegex(ValueError, '停用'):
            auth.login('friend', 'friend-password')
        with self.assertRaisesRegex(ValueError, '自己'):
            auth.update_user(admin, admin, {'disabled': True})

    def test_password_change_keeps_this_device_and_signs_out_others(self):
        uid = self.admin()
        here, there = auth.start_session(uid), auth.start_session(uid)
        with self.assertRaisesRegex(ValueError, '当前密码'):
            auth.change_password(uid, here, {'current': 'bad', 'password': 'new-password-1'})
        auth.change_password(uid, here, {'current': 'owner-password', 'password': 'new-password-1'})
        self.assertIsNotNone(auth.session_user(here))
        self.assertIsNone(auth.session_user(there))
        self.assertEqual(auth.login('owner', 'new-password-1'), uid)

    def test_study_records_are_private_to_each_user(self):
        admin = self.admin()
        friend = auth.register({'username': 'friend', 'password': 'friend-password', 'code': self.invite(admin)})
        s = services.create_session(admin, {'filters': {'paper_id': 'pdf-2024'}, 'count': 2, 'shuffle': False})
        qid = s['question_ids'][0]
        services.answer(admin, s['id'], {'question_id': qid, 'selected': ['A'], 'elapsed_ms': 1000})
        services.mark(admin, qid, {'favorite': True, 'note': '我的笔记'})
        with self.assertRaisesRegex(ValueError, '练习不存在'):
            services.get_session(friend, s['id'])
        with self.assertRaisesRegex(ValueError, '练习不存在'):
            services.answer(friend, s['id'], {'question_id': qid, 'selected': ['A'], 'elapsed_ms': 1000})
        self.assertEqual(services.statistics(friend, {'days': '0'})['summary']['count'], 0)
        self.assertEqual(services.metadata(friend)['counts']['favorites'], 0)
        self.assertEqual(services.metadata(friend)['sessions'], [])
        self.assertEqual(services.get_question(qid, uid=friend)['note'], '')
        self.assertEqual(services.list_questions(friend, {'favorite': '1'})['total'], 0)
        self.assertEqual(services.list_questions(admin, {'favorite': '1'})['total'], 1)
        # The friend's first answer to the same question is still their first.
        s2 = services.create_session(friend, {'filters': {'paper_id': 'pdf-2024'}, 'count': 2, 'shuffle': False})
        services.answer(friend, s2['id'], {'question_id': qid, 'selected': ['A'], 'elapsed_ms': 1000})
        self.assertEqual(services.statistics(friend, {'attempt': 'first'})['summary']['count'], 1)


class AuthHttpTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old = database.DB_PATH
        database.DB_PATH = Path(self.tmp.name) / 'http.sqlite3'
        database.initialize()
        auth._setup['code'] = None
        auth._failures.clear()
        self.admin = auth.create_user('owner', 'owner-password')
        self.friend = auth.create_user('friend', 'friend-password')
        self.server = app.ThreadingHTTPServer(('127.0.0.1', 0), app.Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f'http://127.0.0.1:{self.server.server_port}'

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        database.DB_PATH = self.old
        self.tmp.cleanup()

    def call(self, path, data=None, cookie=None, headers=None):
        headers = dict(headers or {})
        if cookie:
            headers['Cookie'] = cookie
        body = None
        if data is not None:
            headers['Content-Type'] = 'application/json'
            body = json.dumps(data).encode()
        return urlopen(Request(self.base + path, data=body, headers=headers), timeout=5)

    def status(self, *args, **kwargs):
        try:
            with self.call(*args, **kwargs) as response:
                return response.status
        except HTTPError as error:
            error.close()
            return error.code

    def test_api_needs_login_and_admin_routes_need_admin(self):
        self.assertEqual(self.status('/healthz'), 200)
        self.assertEqual(self.status('/index.html'), 200)
        self.assertEqual(self.status('/api/meta'), 401)
        self.assertEqual(self.status('/api/session', {'count': 1}), 401)
        with self.call('/api/auth/me') as response:
            self.assertEqual(json.load(response), {'user': None, 'setup': False})
        friend = 'finreg_session=' + auth.start_session(self.friend)
        self.assertEqual(self.status('/api/meta', cookie=friend), 200)
        for path in ('/api/backup', '/api/export', '/api/admin/users'):
            self.assertEqual(self.status(path, cookie=friend), 403, path)
        self.assertEqual(self.status('/api/import', {'data': {}}, cookie=friend), 403)
        self.assertEqual(self.status('/api/admin/invites', {}, cookie=friend), 403)
        admin = 'finreg_session=' + auth.start_session(self.admin)
        with self.call('/api/admin/users', cookie=admin) as response:
            self.assertEqual([u['username'] for u in json.load(response)['users']], ['owner', 'friend'])

    def test_login_sets_http_only_cookie_and_logout_clears_it(self):
        with self.call('/api/auth/login', {'username': 'friend', 'password': 'friend-password'},
                       headers={'X-Forwarded-Proto': 'https'}) as response:
            cookie = response.headers['Set-Cookie']
            self.assertEqual(json.load(response)['user']['username'], 'friend')
        for flag in ('HttpOnly', 'SameSite=Lax', 'Secure', 'Path=/'):
            self.assertIn(flag, cookie)
        session = cookie.split(';')[0]
        self.assertEqual(self.status('/api/meta', cookie=session), 200)
        with self.call('/api/auth/logout', {}, cookie=session) as response:
            self.assertIn('Max-Age=0', response.headers['Set-Cookie'])
        self.assertEqual(self.status('/api/meta', cookie=session), 401)
        with patch.object(auth.time, 'sleep'):
            self.assertEqual(self.status('/api/auth/login', {'username': 'friend', 'password': 'bad'}), 400)

    def test_html_carries_security_headers(self):
        with self.call('/') as response:
            self.assertIn("frame-ancestors 'none'", response.headers['Content-Security-Policy'])
            self.assertEqual(response.headers['X-Frame-Options'], 'DENY')


if __name__ == '__main__':
    unittest.main()
