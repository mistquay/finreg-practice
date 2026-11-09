import unittest,tempfile,json,threading,urllib.request,urllib.error,sqlite3,re
from pathlib import Path
from datetime import datetime,timedelta
import database,services,importer
from app import Handler,ThreadingHTTPServer
class PracticeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory();cls.old=database.DB_PATH
    @classmethod
    def tearDownClass(cls):database.DB_PATH=cls.old;cls.tmp.cleanup()
    def setUp(self):
        database.DB_PATH=Path(self.tmp.name)/(self.id().split('.')[-1]+'.sqlite3');database.initialize()
    def session(self,qid):
        q=services.get_question(qid);s=services.create_session({'filters':{'paper_id':q['paper_id']},'count':200,'shuffle':False});self.assertIn(qid,s['question_ids']);return s
    def submit(self,s,qid,selected,ms=12000):return services.answer(s['id'],{'question_id':qid,'selected':selected,'elapsed_ms':ms})
    def test_all_real_sources_and_images(self):
        with database.connect() as c:
            rows=[database.decode(r) for r in c.execute('SELECT * FROM questions')]
        self.assertEqual(len(rows),1110);self.assertEqual(sum(q['provider']=='fenbi' for q in rows),390)
        self.assertEqual(sum(q['quality']=='review' for q in rows),5)
        for q in rows:
            if q['quality']=='ready':self.assertTrue(q['answer']);self.assertEqual(set(q['options']),set('ABCD'))
            if q['module']=='英语':self.assertGreater(len(q['material']),500)
            self.assertNotIn('答案:',q['options'].get('D',''))
            for url in re.findall(r'\[\[image:(/assets/[^\]]+)\]\]',q['stem']+q['material']+json.dumps(q['options'])):
                self.assertTrue((database.ROOT/'data'/url.lstrip('/')).exists(),url)
            if q['provider']=='fenbi':self.assertIn('correctAnswer',q['raw']['question'])
        self.assertEqual(sum(q['module']=='英语' for q in rows),120)
    def test_multiple_choice_exact_match_and_duplicate_submission(self):
        qid='pdf-2024-081';q=services.get_question(qid,True);s=self.session(qid)
        r=self.submit(s,qid,q['answer'][:-1]);self.assertEqual(r['correct'],0)
        r=self.submit(s,qid,q['answer']);self.assertTrue(r['duplicate']);self.assertEqual(r['correct'],0)
        self.assertEqual(services.statistics({})['summary']['count'],1)
        s2=self.session(qid);self.assertEqual(self.submit(s2,qid,list(reversed(q['answer'])))['correct'],1)
        self.assertEqual(services.statistics({'attempt':'first'})['summary']['wrong'],1)
        self.assertEqual(services.statistics({})['summary']['accuracy'],50)
        self.assertEqual(services.list_questions({'wrong':'1'})['total'],0)
    def test_unanswered_ungraded_and_scoring_validation(self):
        qid='pdf-2024-001';s=self.session(qid)
        for selected in ([],['Z'],['A','B']):
            with self.assertRaises(ValueError):self.submit(s,qid,selected)
        with self.assertRaises(ValueError):self.submit(s,'pdf-2020-001',['A'])
        with self.assertRaises(ValueError):self.submit(s,qid,['B'],-1)
        self.assertEqual(services.statistics({})['summary']['count'],0)
        services.update_session(s['id'],{'status':'completed'})
        with self.assertRaises(ValueError):self.submit(s,qid,['B'])
    def test_notes_favorites_and_drafts_persist(self):
        qid='pdf-2024-001';s=self.session(qid);services.mark(qid,{'favorite':True,'note':'复习 GDP'})
        services.mark(qid,{'favorite':False});self.assertEqual(services.get_question(qid)['note'],'复习 GDP')
        services.update_session(s['id'],{'position':3,'drafts':{qid:{'selected':['B'],'elapsed_ms':2000}}})
        fresh=services.get_session(s['id']);self.assertEqual(fresh['position'],3);self.assertEqual(fresh['drafts'][qid]['selected'],['B'])
    def test_filters_dates_and_empty_stats(self):
        self.assertIsNone(services.statistics({})['summary']['accuracy'])
        s=self.session('pdf-2024-001');self.submit(s,'pdf-2024-001',['B'],4000);self.submit(s,'pdf-2024-021',['A'],6000)
        self.assertEqual(services.statistics({'module':'经济金融基础'})['summary']['count'],1)
        self.assertEqual(services.statistics({'tag':'经济金融'})['summary']['count'],1)
        with database.connect() as c:
            old=(datetime.now(services.TZ)-timedelta(days=8)).isoformat();c.execute('UPDATE attempts SET created_at=? WHERE question_id=?',(old,'pdf-2024-021'))
        self.assertEqual(services.statistics({'days':'7'})['summary']['count'],1)
        self.assertEqual(services.statistics({'days':'0'})['summary']['count'],2)
        self.assertEqual(services.statistics({'days':'7'})['today']['count'],1)
    def test_import_validation_idempotence_and_edit_preservation(self):
        payload={'title':'测试导入','questions':[{'id':'one','stem':'正确内容？','options':['甲','乙','丙','丁'],'correct_answer':'B','module':'行测','raw_extra':'keep'}]}
        self.assertEqual(importer.import_data(payload,True)['added'],0)
        self.assertEqual(importer.import_data(payload)['added'],1)
        self.assertEqual(importer.import_data(payload)['duplicates'],1)
        q=importer.normalize(payload)[0]['questions'][0]
        self.assertEqual(services.get_question(q['id'],True)['raw']['raw_extra'],'keep')
        with database.connect() as c:self.assertEqual(c.execute('SELECT count(*) FROM imported_documents').fetchone()[0],1)
        importer.edit_question(q['id'],{'stem':'人工核验后的题干'})
        importer.import_data(payload);self.assertEqual(services.get_question(q['id'])['stem'],'人工核验后的题干')
        with self.assertRaises(ValueError):importer.import_data({'items':[{'id':'stats-only'}]})
        q['quality']='ready';q['answer']=['Z']
        with self.assertRaises(ValueError):importer.validate_question(q)
    def test_review_rows_excluded(self):
        s=services.create_session({'mode':'exam','filters':{'paper_id':'pdf-2024'},'shuffle':False})
        self.assertNotIn('pdf-2024-086',s['question_ids']);self.assertEqual(len(s['question_ids']),117)
    def test_http_export_backup_and_origin(self):
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start();base=f'http://127.0.0.1:{server.server_port}'
        try:
            data=json.load(urllib.request.urlopen(base+'/api/export'));self.assertEqual(len(data['papers']),9)
            backup=urllib.request.urlopen(base+'/api/backup').read();self.assertTrue(backup.startswith(b'SQLite format 3'))
            req=urllib.request.Request(base+'/api/session',data=b'{}',headers={'Content-Type':'application/json','Origin':'https://example.com'})
            with self.assertRaises(urllib.error.HTTPError) as ctx:urllib.request.urlopen(req)
            self.assertEqual(ctx.exception.code,403)
            with self.assertRaises(urllib.error.HTTPError):urllib.request.urlopen(base+'/sources/..%2F..%2Fapp.py')
        finally:server.shutdown();server.server_close();thread.join()
if __name__=='__main__':unittest.main()
