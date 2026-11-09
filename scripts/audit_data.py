"""Read-only integrity report for the current local bank."""
import sys,json,re
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import database,services

def audit():
    with database.connect() as conn:
        questions=[database.decode(q) for q in conn.execute('SELECT * FROM questions')]
    fenbi=[q for q in questions if q['provider']=='fenbi']
    missing=[]
    for q in questions:
        for url in re.findall(r'\[\[image:(/assets/[^\]]+)\]\]',q['stem']+q['material']+json.dumps(q['options'])):
            if not (database.ROOT/'data'/url.lstrip('/')).is_file():missing.append({'id':q['id'],'url':url})
    catalog=database.ROOT/'data/fenbi/keypoint-catalog.json'
    report={
        'counts':services.metadata()['counts'],
        'personal_attempts':services.statistics({'days':'0'})['summary']['count'],
        'fenbi_questions':len(fenbi),
        'with_platform_statistics':sum(bool(q['raw'].get('platform_statistics')) for q in fenbi),
        'with_keypoints':sum(bool(q['raw'].get('keypoints')) for q in fenbi),
        'keypoint_catalog_records':len(json.loads(catalog.read_text(encoding='utf-8'))['records']) if catalog.exists() else 0,
        'local_image_files':len(list((database.ROOT/'data/assets').glob('*'))),
        'missing_images':missing,
        'review_questions':[{'id':q['id'],'issues':q['issues']} for q in questions if q['quality']=='review'],
    }
    return report
if __name__=='__main__':
    report=audit()
    print(json.dumps(report,ensure_ascii=False,indent=2))
    if report['missing_images']:raise SystemExit(1)
