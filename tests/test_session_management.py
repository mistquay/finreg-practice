import tempfile
import unittest
from pathlib import Path

import database
import services


class SessionManagementTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old = database.DB_PATH
        database.DB_PATH = Path(self.tmp.name) / 'sessions.sqlite3'
        database.initialize()

    def tearDown(self):
        database.DB_PATH = self.old
        self.tmp.cleanup()

    def practice(self, count=3):
        return services.create_session({'filters': {'paper_id': 'pdf-2024'}, 'count': count, 'shuffle': False})

    def test_discard_without_answers_deletes_session(self):
        s = self.practice()
        self.assertEqual(services.discard_session(s['id'])['discarded'], True)
        with self.assertRaises(ValueError):
            services.get_session(s['id'])

    def test_discard_keeps_submitted_answers(self):
        s = self.practice()
        qid = s['question_ids'][0]
        services.answer(s['id'], {'question_id': qid, 'selected': services.get_question(qid, True)['answer'], 'elapsed_ms': 1000})
        result = services.discard_session(s['id'])
        self.assertEqual(result, {'discarded': False, 'status': 'completed'})
        self.assertEqual(services.get_session(s['id'])['status'], 'completed')
        self.assertEqual(services.statistics({})['summary']['count'], 1)

    def test_explicit_question_ids_keep_order_and_skip_unready(self):
        ids = ['pdf-2024-003', 'pdf-2024-001', 'pdf-2024-003']
        with database.connect() as c:
            review = c.execute("SELECT id FROM questions WHERE quality='review' LIMIT 1").fetchone()['id']
        s = services.create_session({'question_ids': ids + [review], 'mode': 'review'})
        self.assertEqual(s['question_ids'], ['pdf-2024-003', 'pdf-2024-001'])
        with self.assertRaises(ValueError):
            services.create_session({'question_ids': 'pdf-2024-001'})

    def test_mixed_subjects_share_the_count_evenly(self):
        modules = ['计算机专业', '英语', '经济金融基础']
        s = services.create_session({'filters': {'module': modules}, 'count': 30})
        picked = [services.get_question(qid)['module'] for qid in s['question_ids']]
        self.assertEqual({m: picked.count(m) for m in modules}, {m: 10 for m in modules})
        self.assertEqual(services.list_questions({'module': modules})['total'],
                         sum(services.list_questions({'module': m})['total'] for m in modules))
        with self.assertRaises(ValueError):
            services.create_session({'filters': {'module': ['英语', 3]}})

    def test_balanced_gives_a_short_pool_share_to_the_others(self):
        self.assertEqual(services._balanced([[1, 2], list('abcdefgh')], 6), [1, 2, 'a', 'b', 'c', 'd'])
        self.assertEqual(services._balanced([[1], []], 5), [1])

    def test_metadata_reports_paper_progress_and_session_answers(self):
        s = self.practice()
        qid = s['question_ids'][0]
        services.answer(s['id'], {'question_id': qid, 'selected': ['A'], 'elapsed_ms': 1000})
        meta = services.metadata()
        paper = next(p for p in meta['papers'] if p['id'] == 'pdf-2024')
        self.assertEqual(paper['done'], 1)
        self.assertEqual(next(x for x in meta['sessions'] if x['id'] == s['id'])['answered'], 1)


if __name__ == '__main__':
    unittest.main()
