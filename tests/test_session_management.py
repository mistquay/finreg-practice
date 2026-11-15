import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import auth
import database
import services


class SessionManagementTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old = database.DB_PATH
        database.DB_PATH = Path(self.tmp.name) / 'sessions.sqlite3'
        database.initialize()
        self.uid = auth.create_user('tester','test-password',admin=True)

    def tearDown(self):
        database.DB_PATH = self.old
        self.tmp.cleanup()

    def practice(self, count=3):
        return services.create_session(self.uid,{'filters': {'paper_id': 'pdf-2024'}, 'count': count, 'shuffle': False})

    def test_discard_without_answers_deletes_session(self):
        s = self.practice()
        self.assertEqual(services.discard_session(self.uid,s['id'])['discarded'], True)
        with self.assertRaises(ValueError):
            services.get_session(self.uid,s['id'])

    def test_discard_keeps_submitted_answers(self):
        s = self.practice()
        qid = s['question_ids'][0]
        services.answer(self.uid,s['id'], {'question_id': qid, 'selected': services.get_question(qid, True)['answer'], 'elapsed_ms': 1000})
        result = services.discard_session(self.uid,s['id'])
        self.assertEqual(result, {'discarded': False, 'status': 'completed'})
        self.assertEqual(services.get_session(self.uid,s['id'])['status'], 'completed')
        self.assertEqual(services.statistics(self.uid,{})['summary']['count'], 1)

    def test_explicit_question_ids_keep_order_and_skip_unready(self):
        ids = ['pdf-2024-003', 'pdf-2024-001', 'pdf-2024-003']
        with database.connect() as c:
            review = c.execute("SELECT id FROM questions WHERE quality='review' LIMIT 1").fetchone()['id']
        s = services.create_session(self.uid,{'question_ids': ids + [review], 'mode': 'review'})
        self.assertEqual(s['question_ids'], ['pdf-2024-003', 'pdf-2024-001'])
        with self.assertRaises(ValueError):
            services.create_session(self.uid,{'question_ids': 'pdf-2024-001'})

    def test_mixed_subjects_share_the_count_evenly(self):
        modules = ['计算机专业', '英语', '经济金融基础']
        s = services.create_session(self.uid,{'filters': {'module': modules}, 'count': 30})
        picked = [services.get_question(qid)['module'] for qid in s['question_ids']]
        self.assertEqual({m: picked.count(m) for m in modules}, {m: 10 for m in modules})
        self.assertEqual(services.list_questions(self.uid,{'module': modules})['total'],
                         sum(services.list_questions(self.uid,{'module': m})['total'] for m in modules))
        with self.assertRaises(ValueError):
            services.create_session(self.uid,{'filters': {'module': ['英语', 3]}})

    def test_balanced_gives_a_short_pool_share_to_the_others(self):
        self.assertEqual(services._balanced([[1, 2], list('abcdefgh')], 6), [1, 2, 'a', 'b', 'c', 'd'])
        self.assertEqual(services._balanced([[1], []], 5), [1])

    def test_sessions_report_real_progress_and_sort_by_last_activity(self):
        times = iter(f'2026-11-15T10:00:{n:02d}+08:00' for n in range(60))
        with patch.object(services, 'now', lambda: next(times)):
            older = self.practice()
            newer = self.practice()
            summary = {s['id']: s for s in services.metadata(self.uid)['sessions']}
            self.assertEqual([s['id'] for s in services.metadata(self.uid)['sessions']][:2], [newer['id'], older['id']])
            self.assertFalse(summary[older['id']]['started'])
            # Opening a session saves a draft without an answer: still not started.
            qid = older['question_ids'][0]
            services.update_session(self.uid, older['id'], {'drafts': {qid: {'selected': [], 'elapsed_ms': 500}}})
            first = services.metadata(self.uid)['sessions'][0]
            self.assertEqual((first['id'], first['started']), (older['id'], False))
            services.answer(self.uid, older['id'], {'question_id': qid, 'selected': ['A'], 'elapsed_ms': 900})
            first = services.metadata(self.uid)['sessions'][0]
            self.assertEqual((first['id'], first['started'], first['answered']), (older['id'], True, 1))
            exam = services.create_session(self.uid, {'mode': 'exam', 'filters': {'paper_id': 'pdf-2024'}, 'count': 2})
            services.update_session(self.uid, exam['id'], {'drafts': {exam['question_ids'][0]: {'selected': ['B']}}})
            first = services.metadata(self.uid)['sessions'][0]
            self.assertEqual((first['id'], first['started'], first['filled']), (exam['id'], True, 1))
            services.finish_session(self.uid, exam['id'], {})
            first = services.metadata(self.uid)['sessions'][0]
            self.assertEqual((first['status'], first['answered'], first['graded']), ('completed', 1, 1))
            self.assertIn(first['correct'], (0, 1))

    def test_metadata_reports_paper_progress_and_session_answers(self):
        s = self.practice()
        qid = s['question_ids'][0]
        services.answer(self.uid,s['id'], {'question_id': qid, 'selected': ['A'], 'elapsed_ms': 1000})
        meta = services.metadata(self.uid)
        paper = next(p for p in meta['papers'] if p['id'] == 'pdf-2024')
        self.assertEqual(paper['done'], 1)
        self.assertEqual(next(x for x in meta['sessions'] if x['id'] == s['id'])['answered'], 1)


if __name__ == '__main__':
    unittest.main()
