import copy,json,tempfile,unittest
from pathlib import Path
import auth,database,services,importer
from scripts.import_fenbi_api import normalize,identity

class ExpandedBankTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.old=database.DB_PATH
        database.DB_PATH=Path(self.tmp.name)/'test.sqlite3';database.initialize();self.uid=auth.create_user('tester','test-password',admin=True)
    def tearDown(self):
        database.DB_PATH=self.old;self.tmp.cleanup()
    def paper(self,subject='shenlun'):
        essay=subject=='shenlun'
        solution=dict(id=987654,globalId='q1',tikuPrefix=subject,content='<p>归纳给定资料的做法。</p>' if essay else '<p>请选择正确选项。</p>',
          accessories=[] if essay else [{'type':101,'options':['甲','乙','丙','丁']}],keypoints=[{'id':10,'name':'归纳概括'}],
          solution='讲解',solutionAccessories=[{'label':'reference','content':'参考要点'}] if essay else [],
          correctAnswer=None if essay else {'choice':'1'})
        return dict(entry=dict(prefix=subject,kind='国考真题',listing=dict(id=999,name='2026年国家公考申论（副省级）')),
          captured_at='2026-11-09',paper=dict(name='2026年国家公考申论（副省级）',solutions=[solution],
          materials=[{'globalId':'m1','id':1,'content':'材料一'},{'globalId':'m2','id':2,'content':'材料二'}],
          card={'children':[{'name':'归纳概括','children':[{'key':'q1','materialKeys':['m2']}]}]}))
    def test_essay_reference_material_and_no_automatic_score(self):
        p=normalize(self.paper());q=p['questions'][0]
        self.assertEqual(q['type'],'essay');self.assertEqual(q['quality'],'ready')
        self.assertIn('给定资料 2',q['material']);self.assertNotIn('材料一',q['material'])
        self.assertIn('参考要点',q['explanation']);self.assertEqual(q['answer'],[])
        importer.import_data({'version':1,'papers':[p]})
        s=services.create_session(self.uid,{'filters':{'paper_id':p['id']}})
        services.update_session(self.uid,s['id'],{'drafts':{q['id']:{'selected':['草稿'], 'elapsed_ms':1200}}})
        self.assertEqual(services.get_session(self.uid,s['id'])['drafts'][q['id']]['selected'],['草稿'])
        for invalid in ([],[''],['a','b'],[123]):
            with self.assertRaises(ValueError):services.answer(self.uid,s['id'],{'question_id':q['id'],'selected':invalid})
        result=services.answer(self.uid,s['id'],{'question_id':q['id'],'selected':['我的答案<script>'], 'elapsed_ms':2000})
        self.assertIsNone(result['correct'])
        stats=services.statistics(self.uid,{'module':'申论'})['summary']
        self.assertEqual(stats['count'],1);self.assertEqual(stats['graded'],0);self.assertIsNone(stats['accuracy'])
        self.assertEqual(services.list_questions(self.uid,{'wrong':'1','module':'申论'})['total'],0)
        self.assertEqual(services.get_session(self.uid,s['id'])['attempts'][0]['answer_snapshot'],[q['explanation']])
    def test_refresh_preserves_manual_edits_marks_and_attempts(self):
        p=normalize(self.paper('xingce'));payload={'version':1,'papers':[p]};importer.import_data(payload);q=p['questions'][0]
        s=services.create_session(self.uid,{'filters':{'paper_id':p['id']}})
        services.answer(self.uid,s['id'],{'question_id':q['id'],'selected':['B'],'elapsed_ms':500})
        services.mark(self.uid,q['id'],{'note':'保留笔记','favorite':True})
        q['explanation']='补全解析';importer.import_data(payload)
        self.assertEqual(services.get_question(q['id'],True)['explanation'],'补全解析')
        importer.edit_question(q['id'],{'stem':'人工修改题干','explanation':'人工解析'})
        q['stem']='来源新题干';q['explanation']='来源解析';importer.import_data(payload)
        result=services.get_question(q['id'],True,uid=self.uid)
        self.assertEqual(result['stem'],'人工修改题干');self.assertEqual(result['explanation'],'人工解析')
        self.assertEqual(result['note'],'保留笔记');self.assertEqual(result['favorite'],1)
        self.assertEqual(services.statistics(self.uid,{})['summary']['count'],1)
        self.assertEqual(services.list_questions(self.uid,{'kind':'国考真题','exam_level':'副省级','year':'2026'})['total'],1)
    def test_old_city_ids_and_incomplete_answer_review(self):
        doc=self.paper('xingce');doc['entry']['listing']['name']='2026年国家公务员录用考试（地市级）'
        self.assertEqual(identity(doc['entry'])[0],'fenbi-xingce-2026-city')
        doc['paper']['solutions'][0]['correctAnswer']=None
        p=normalize(doc);self.assertEqual(p['questions'][0]['quality'],'review')
        self.assertIn('capture_format',p['questions'][0]['raw'])
if __name__=='__main__':unittest.main()