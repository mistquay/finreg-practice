"""Read-only audit of the expanded local bank and its source coverage."""
import json,re,sys
from pathlib import Path
from collections import Counter
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import database
from tools.fenbi_api import DATA,load,save

def audit():
    scopes=Counter();issues=Counter();errors=[];image_refs=set();unique=set();fields=Counter();review=[]
    with database.connect() as conn:
        integrity=conn.execute('PRAGMA quick_check').fetchone()[0]
        foreign_keys=[tuple(r) for r in conn.execute('PRAGMA foreign_key_check')]
        counts=dict(conn.execute('SELECT count(*) total,sum(quality="ready") ready,sum(quality="review") review FROM questions').fetchone())
        papers=[dict(r) for r in conn.execute('SELECT p.subject,p.kind,p.exam_level,count(DISTINCT p.id) papers,count(q.id) questions FROM papers p JOIN questions q ON q.paper_id=p.id GROUP BY p.subject,p.kind,p.exam_level')]
        personal={table:conn.execute(f'SELECT count(*) FROM {table}').fetchone()[0] for table in ('attempts','marks','sessions')}
        for row in conn.execute('SELECT * FROM questions'):
            q=database.decode(row)
            contents=q['stem']+q['material']+q['explanation']+json.dumps(q['options'],ensure_ascii=False)
            image_refs.update(re.findall(r'\[\[image:(/assets/[^\]]+)\]\]',contents))
            if '\ufffd' in contents and (q['quality']=='ready' or q['provider']=='fenbi'):errors.append({'id':q['id'],'error':'replacement character'})
            if q['quality']=='review':review.append({'id':q['id'],'issues':q['issues']});issues.update(q['issues'])
            if q['provider']!='fenbi':continue
            raw=q['raw'];prefix=raw.get('solution',{}).get('tikuPrefix')
            unique.add((prefix,q['external_id']))
            for key in ('question','solution','platform_statistics','keypoints','keypoint_details'):
                if raw.get(key):fields[key]+=1
            for key in ('question','solution','platform_statistics'):
                if str(raw.get(key,{}).get('id'))!=q['external_id']:
                    errors.append({'id':q['id'],'error':key+' ID missing/mismatch'})
            if q['type']=='essay' and (q['answer'] or q['options']):errors.append({'id':q['id'],'error':'essay has objective answer'})
            if q['explanation']:fields['explanation']+=1
            if raw.get('source_archive') and not (database.ROOT/raw['source_archive']).exists():errors.append({'id':q['id'],'error':'archive missing'})
        expected={r['paper_id']:r['questions'] for r in load(DATA/'import-report.json')}
        for pid,n in expected.items():
            actual=conn.execute('SELECT count(*) FROM questions WHERE paper_id=?',(pid,)).fetchone()[0]
            if n!=actual:errors.append({'id':pid,'error':f'paper count {actual}!={n}'})
    missing=[url for url in image_refs if not (database.ROOT/'data'/url.lstrip('/')).is_file()]
    empty=[url for url in image_refs if (database.ROOT/'data'/url.lstrip('/')).is_file() and (database.ROOT/'data'/url.lstrip('/')).stat().st_size==0]
    baseline=database.ROOT/'data/backups/before-expanded-bank.sqlite3'
    import sqlite3
    with sqlite3.connect(baseline) as before:
        baseline_personal={table:before.execute(f'SELECT count(*) FROM {table}').fetchone()[0] for table in personal}
    return dict(counts=counts,papers=papers,personal=personal,baseline_personal=baseline_personal,integrity=integrity,
        foreign_key_errors=foreign_keys,unique_fenbi_questions=len(unique),fields=dict(fields),image_references=len(image_refs),
        missing_images=missing,empty_images=empty,errors=errors,review=review,issue_counts=dict(issues))

if __name__=='__main__':
    result=audit();save(DATA/'validation.json',result)
    print(json.dumps({k:v for k,v in result.items() if k not in ('review','papers')},ensure_ascii=False,indent=2))
    if result['errors'] or result['missing_images'] or result['empty_images'] or result['foreign_key_errors'] or result['integrity']!='ok':raise SystemExit(1)