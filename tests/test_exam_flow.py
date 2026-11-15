import tempfile,unittest
from pathlib import Path
import auth,database,services,importer

class ExamFlowTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.old=database.DB_PATH
        database.DB_PATH=Path(self.tmp.name)/'exam.sqlite3';database.initialize();self.uid=auth.create_user('tester','test-password',admin=True)
    def tearDown(self):
        database.DB_PATH=self.old;self.tmp.cleanup()
    def exam(self):
        return services.create_session(self.uid,{'mode':'exam','filters':{'paper_id':'pdf-2024'},'count':3,'shuffle':False})
    def draft(self,s,correct=True):
        result={}
        for qid in s['question_ids']:
            q=services.get_question(qid,True)
            result[qid]={'selected':q['answer'] if correct else [next(x for x in q['options'] if x not in q['answer'])],'elapsed_ms':2500}
        return result
    def test_exam_drafts_are_ungraded_and_editable_until_atomic_finish(self):
        s=self.exam();drafts=self.draft(s,False)
        ack=services.update_session(self.uid,s['id'],{'drafts':drafts,'position':2})
        self.assertEqual(ack['saved'],True);self.assertNotIn('attempts',ack)
        self.assertEqual(services.get_session(self.uid,s['id'])['attempts'],[])
        self.assertEqual(services.statistics(self.uid,{})['summary']['count'],0)
        with self.assertRaisesRegex(ValueError,'整卷'): services.answer(self.uid,s['id'],{'question_id':s['question_ids'][0],'selected':['A']})
        drafts=self.draft(s,True)
        finished=services.finish_session(self.uid,s['id'],{'drafts':drafts})
        self.assertEqual(finished['status'],'completed');self.assertEqual(len(finished['attempts']),3)
        self.assertTrue(all(a['correct']==1 for a in finished['attempts']))
        self.assertEqual(services.statistics(self.uid,{})['summary']['correct'],3)
        again=services.finish_session(self.uid,s['id'],{'drafts':{}})
        self.assertEqual([a['id'] for a in again['attempts']],[a['id'] for a in finished['attempts']])
        services.update_session(self.uid,s['id'],{'drafts':{},'status':'active'})
        self.assertEqual(services.get_session(self.uid,s['id'])['status'],'completed')
        self.assertEqual(services.get_session(self.uid,s['id'])['drafts'],drafts)
    def test_invalid_final_draft_rolls_back_whole_exam(self):
        s=self.exam();drafts=self.draft(s);drafts[s['question_ids'][-1]]['selected']=['Z']
        with self.assertRaises(ValueError):services.finish_session(self.uid,s['id'],{'drafts':drafts})
        fresh=services.get_session(self.uid,s['id']);self.assertEqual(fresh['status'],'active');self.assertEqual(fresh['attempts'],[])
    def test_unanswered_exam_questions_do_not_create_attempts(self):
        s=self.exam();drafts=self.draft(s);drafts.pop(s['question_ids'][0]);drafts[s['question_ids'][1]]['selected']=[]
        finished=services.finish_session(self.uid,s['id'],{'drafts':drafts})
        self.assertEqual(len(finished['attempts']),1)
        self.assertEqual(services.statistics(self.uid,{})['summary']['graded'],1)
    def test_stale_save_does_not_overwrite_newer_draft(self):
        s=self.exam();new=dict(self.draft(s),__updated=200)
        services.update_session(self.uid,s['id'],{'drafts':new})
        services.update_session(self.uid,s['id'],{'drafts':{'__updated':100}})
        self.assertEqual(services.get_session(self.uid,s['id'])['drafts'],new)
    def test_metadata_is_fresh_after_edit_import_and_answer(self):
        before=services.metadata(self.uid);self.assertEqual(before['counts']['total'],1110)
        qid='pdf-2024-001';q=services.get_question(qid,True)
        importer.edit_question(qid,{'tags':['新的动态标签'],'quality':'review','issues':['测试']})
        after=services.metadata(self.uid);self.assertEqual(after['counts']['ready'],before['counts']['ready']-1)
        self.assertIn('新的动态标签',after['tags'])
        self.assertNotIn('raw',services.get_question(qid))
        self.assertNotIn('raw',services.get_question(qid,True,False))
        self.assertIn('raw',services.get_question(qid,True))
        new_q=dict(q,id='meta-new-q',paper_id='meta-new',quality='ready',issues=[])
        importer.import_data({'version':1,'papers':[{'id':'meta-new','title':'动态导入','questions':[new_q]}]})
        self.assertEqual(services.metadata(self.uid)['counts']['total'],1111)
        s=services.create_session(self.uid,{'filters':{'paper_id':'meta-new'}})
        services.answer(self.uid,s['id'],{'question_id':'meta-new-q','selected':new_q['answer']})
        self.assertEqual(services.metadata(self.uid)['counts']['seen'],1)
    def test_whitespace_only_essay_is_unanswered_at_submission(self):
        importer.edit_question('pdf-2024-001',{'type':'essay','answer':[],'options':{},'explanation':'文字参考答案'})
        s=self.exam();drafts=self.draft(s)
        drafts['pdf-2024-001']['selected']=['   \n ']
        result=services.finish_session(self.uid,s['id'],{'drafts':drafts})
        self.assertEqual(len(result['attempts']),2)
        self.assertNotIn('pdf-2024-001',[a['question_id'] for a in result['attempts']])
    def test_exam_count_and_full_paper_are_explicit(self):
        s=self.exam();self.assertEqual(len(s['question_ids']),3)
        full=services.create_session(self.uid,{'mode':'practice','full_paper':True,'filters':{'paper_id':'pdf-2024'}})
        self.assertEqual(len(full['question_ids']),117)

if __name__=='__main__':unittest.main()
