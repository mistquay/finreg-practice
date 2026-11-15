import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path

import auth
import database
import services


class DashboardTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.old = database.DB_PATH

    @classmethod
    def tearDownClass(cls):
        database.DB_PATH = cls.old
        cls.tmp.cleanup()

    def setUp(self):
        database.DB_PATH = Path(self.tmp.name) / (self.id().split('.')[-1] + '.sqlite3')
        database.initialize()
        self.uid = auth.create_user('tester', 'test-password', admin=True)

    def answer(self, qid, right=True, mode='practice'):
        q = services.get_question(qid, True)
        s = services.create_session(self.uid, {'question_ids': [qid], 'mode': mode})
        selected = q['answer'] if right else [next(k for k in q['options'] if k not in q['answer'])]
        return services.answer(self.uid, s['id'], {'question_id': qid, 'selected': selected, 'elapsed_ms': 30000})

    def shift_days(self, qid, days):
        """Move this user's attempts on a question back by `days` Beijing days."""
        when = (datetime.now(services.TZ) - timedelta(days=days)).isoformat(timespec='seconds')
        with database.connect() as c:
            c.execute('UPDATE attempts SET created_at=? WHERE question_id=? AND user_id=?', (when, qid, self.uid))

    def test_settings_defaults_save_and_validation(self):
        self.assertEqual(services.get_settings(self.uid),
                         {'exam_name': '', 'exam_date': '', 'daily_goal': 50, 'focus': []})
        saved = services.save_settings(self.uid, {'exam_date': '2027-01-10', 'daily_goal': '80',
                                                  'focus': ['计算机专业', '计算机专业', '行测']})
        self.assertEqual(saved['daily_goal'], 80)
        self.assertEqual(saved['focus'], ['计算机专业', '行测'])
        # Partial updates keep the other fields.
        services.save_settings(self.uid, {'exam_name': '金融监管笔试'})
        self.assertEqual(services.get_settings(self.uid)['exam_date'], '2027-01-10')
        for bad in ({'exam_date': '2027/01/10'}, {'daily_goal': 2}, {'daily_goal': 'x'},
                    {'focus': '行测'}, {'exam_name': '长' * 31}):
            with self.assertRaises(ValueError):
                services.save_settings(self.uid, bad)
        services.save_settings(self.uid, {'exam_date': ''})
        self.assertIsNone(services.dashboard(self.uid)['countdown'])

    def test_dashboard_today_streak_tasks_and_wrong_modules(self):
        empty = services.dashboard(self.uid)
        self.assertEqual(empty['today']['count'], 0)
        self.assertEqual(empty['streak'], 0)
        self.assertEqual(len(empty['recent']), 14)
        self.assertEqual(len(empty['week']), 7)
        self.assertEqual([t['key'] for t in empty['tasks']], ['goal'])

        self.answer('pdf-2024-001', right=True)
        self.answer('pdf-2024-002', right=False)
        self.answer('pdf-2024-003', right=True)
        self.shift_days('pdf-2024-003', 1)
        services.save_settings(self.uid, {'daily_goal': 5, 'exam_date': (
            datetime.now(services.TZ).date() + timedelta(days=30)).isoformat()})

        d = services.dashboard(self.uid)
        self.assertEqual(d['today']['count'], 2)
        self.assertEqual(d['today']['accuracy'], 50)
        self.assertEqual(d['yesterday']['count'], 1)
        self.assertEqual(d['streak'], 2)
        self.assertEqual(d['countdown'], 30)
        self.assertEqual(d['tasks'][0], {'key': 'goal', 'label': '完成 5 题', 'done': 2, 'total': 5})
        self.assertEqual(d['tasks'][1]['key'], 'review')
        self.assertEqual(d['tasks'][1]['total'], 1)
        module = services.get_question('pdf-2024-002')['module']
        self.assertEqual(d['wrong_modules'], {module: 1})
        subject = next(s for s in d['subjects'] if s['name'] == module)
        self.assertEqual((subject['seen'], subject['graded'], subject['wrong']), (3, 3, 1))

        meta = services.metadata(self.uid)
        self.assertEqual(meta['counts']['wrong'], 1)
        self.assertEqual(meta['counts']['wrong_modules'], {module: 1})
        paper = next(p for p in meta['papers'] if p['id'] == services.get_question('pdf-2024-001')['paper_id'])
        self.assertEqual((paper['done'], paper['graded'], paper['correct']), (3, 3, 2))

    def test_unsubmitted_exam_does_not_count(self):
        q = services.get_question('pdf-2024-001', True)
        s = services.create_session(self.uid, {'question_ids': ['pdf-2024-001'], 'mode': 'exam'})
        services.update_session(self.uid, s['id'], {'position': 0, 'drafts': {
            'pdf-2024-001': {'selected': q['answer'], 'elapsed_ms': 1000}}})
        d = services.dashboard(self.uid)
        self.assertEqual(d['today']['count'], 0)
        self.assertEqual(d['streak'], 0)

    def test_statistics_compare_and_heatmap(self):
        self.answer('pdf-2024-001', right=True)
        self.answer('pdf-2024-002', right=False)
        self.shift_days('pdf-2024-002', 8)
        stats = services.statistics(self.uid, {'days': '7', 'compare': '1', 'heatmap': '1'})
        self.assertEqual(stats['summary']['count'], 1)
        self.assertEqual(stats['previous']['count'], 1)
        self.assertEqual(stats['previous']['wrong'], 1)
        heat = stats['heatmap']
        self.assertEqual(datetime.fromisoformat(heat[0]['date']).weekday(), 0)
        self.assertGreater(len(heat), 25 * 7)
        self.assertEqual(sum(h['count'] for h in heat), 2)
        self.assertNotIn('previous', services.statistics(self.uid, {'days': '0', 'compare': '1'}))


if __name__ == '__main__':
    unittest.main()
