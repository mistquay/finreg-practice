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
