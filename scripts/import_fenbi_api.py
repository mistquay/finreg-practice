"""Convert API paper solutions into the local bank, keeping complete source archives."""
from pathlib import Path
import argparse,hashlib,json,re,sys,time
from concurrent.futures import ThreadPoolExecutor,as_completed
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT));sys.path.insert(0,str(ROOT/'scripts'))
import database
from importer import PlainText,validate_question
import import_fenbi as assets
from tools.fenbi_api import load,save,DATA

def image_urls(obj,out):
    if isinstance(obj,str) and '<img' in obj.lower():
        p=PlainText();p.feed(obj);out.update(p.images)
    elif isinstance(obj,dict):
        for value in obj.values():image_urls(value,out)
    elif isinstance(obj,list):
        for value in obj:image_urls(value,out)

def level(title):
    if any(x in title for x in ('行政执法','行政执法类','执法类')):return '行政执法'
    if any(x in title for x in ('副省','省级以上','省部级')):return '副省级'
    if any(x in title for x in ('地市','市地','市级以下')):return '地市级'
    return '通用/其他'

def identity(entry):
    name=entry['listing']['name'];year=int(re.search(r'(20\d{2}|19\d{2})',name)[0]) if re.search(r'(20\d{2}|19\d{2})',name) else 0
    if entry['prefix']=='xingce' and entry['kind']=='国考真题' and level(name)=='地市级' and year in (2024,2025,2026):
        return f'fenbi-xingce-{year}-city',year
    return f'fenbi-{entry["prefix"]}-{entry["listing"]["id"]}',year

def normalize(doc,details=None,metadata=None,catalogs=None,archive_ref='',keypoints=None):
    details=details or {};metadata=metadata or {};catalogs=catalogs or {}
    entry=doc['entry'];paper=doc['paper'];prefix=entry['prefix'];pid,year=identity(entry)
    subject='申论' if prefix=='shenlun' else '行测';exam_level=level(paper['name'])
    materials={m['globalId']:m for m in paper.get('materials',[])}
    material_numbers={m['globalId']:i for i,m in enumerate(paper.get('materials',[]),1)}
    positions={};paths={};material_keys={}
    def visit(node,path):
        if node.get('name'):path=path+[node['name']]
        if node.get('key'):
            positions[node['key']]=len(positions)+1;paths[node['key']]=path;material_keys[node['key']]=node.get('materialKeys',[])
        for child in node.get('children',[]):visit(child,path)
    visit(paper['card'],[])
    questions=[]
    for solution in sorted(paper['solutions'],key=lambda q:positions.get(q['globalId'],10**6)):
        qid=solution['id'];key=solution['globalId'];issues=[]
        stem,missing=assets.plain(solution.get('content',''))
        keys=material_keys.get(key,[])
        if not keys:
            mids=next((a.get('materialIndexes') for a in solution.get('accessories',[]) if a.get('materialIndexes')),[])
            keys=[k for k,m in materials.items() if m['id'] in mids]
        if any(k not in materials for k in keys):issues.append('部分关联材料缺失')
        chunks=[]
        for k in keys:
            if k in materials:
                text,bad=assets.plain(materials[k].get('content',''));missing+=bad
                chunks.append((f'给定资料 {material_numbers[k]}\n' if subject=='申论' else '')+text)
        material='\n\n'.join(chunks)
        opts=next((a['options'] for a in solution.get('accessories',[]) if a.get('type')==101 or (isinstance(a.get('options'),list) and all(isinstance(x,str) for x in a['options']))),[])
        options={}
        if subject!='申论':
            for i,item in enumerate(opts):
                text,bad=assets.plain(item);options[chr(65+i)]=text;missing+=bad
        answer=[]
        if subject!='申论':
            choice=(solution.get('correctAnswer') or {}).get('choice','')
            if re.fullmatch(r'[0-7](?:,[0-7])*',str(choice)):answer=[chr(65+int(v)) for v in str(choice).split(',')]
            if not answer or not options or any(a not in options for a in answer):issues.append('选项或参考答案不完整')
        explanation,bad=assets.plain(solution.get('solution',''));missing+=bad
        labels={'reference':'参考答案','demonstrate':'解题讲解','analysis':'解析','review':'点评'}
        for item in solution.get('solutionAccessories',[]):
            if isinstance(item.get('content'),str) and item['content'].strip():
                text,bad=assets.plain(item['content']);missing+=bad
                explanation+='\n\n'+labels.get(item.get('label'),item.get('label') or '补充解析')+'\n'+text
        if missing:issues.append('部分图片未保存，需核验')
        if not stem:issues.append('题干为空')
        points=(keypoints or {}).get(qid,solution.get('keypoints',[]));names=[p['name'] for p in points if p.get('name')]
        path=paths.get(key,[]);category=(names[0] if names else '综合写作') if subject=='申论' else (path[0] if path else '待分类')
        topic=' / '.join(names) or (path[-1] if path else category)
        extra=details.get(qid,{})
        tags=list(dict.fromkeys([entry['kind'],exam_level]+path+names))
        raw=dict(capture_format='paper-solution-v1',question=extra,solution=solution,
            platform_statistics=metadata.get(qid,{}),keypoints=points,
            keypoint_details=[catalogs.get(prefix,{}).get(str(p['id']),{}) for p in points],
            paper_listing=entry['listing'],chapter_path=path,material_keys=keys,
            collected_at=doc['captured_at'],source_archive=archive_ref)
        q=dict(id=f'{pid}-{qid}',paper_id=pid,number=positions.get(key,len(questions)+1),year=year,
            stem=stem or '来源题干缺失',options=options,answer=answer,explanation=explanation.strip(),material=material,
            type='essay' if subject=='申论' else ('multiple' if len(answer)>1 else 'single'),
            module=subject,category=category,topic=topic,tags=tags,source=paper['name'],source_page=0,
            source_url=f'https://www.fenbi.com/spa/tiku/guide/'+('shenlunList/shenlun/1000' if subject=='申论' else 'realTest/xingce/xingce'),
            quality='review' if issues else 'ready',issues=issues,provider='fenbi',external_id=str(qid),difficulty=extra.get('difficulty'),raw=raw)
        validate_question(q);questions.append(q)
    return dict(id=pid,title=paper['name'],year=year,source=paper['name'],subject=subject,
        kind=entry['kind'],exam_level=exam_level,duration_minutes=180 if subject=='申论' else 120,questions=questions)

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--skip-images',action='store_true');parser.add_argument('--no-db',action='store_true');parser.add_argument('--assets-only',action='store_true');args=parser.parse_args()
    files=sorted((DATA/'papers').glob('*.json'));urls=set()
    assets.asset_map=load(ROOT/'data/asset-map.json') if (ROOT/'data/asset-map.json').exists() else {}
    for path in files:image_urls(load(path)['paper'],urls)
    missing=[src for src in sorted(urls) if src not in assets.asset_map or not (ROOT/'data'/assets.asset_map[src].removeprefix('/')).exists()]
    print(f'{len(files)} papers; {len(urls)} image URLs; {len(missing)} to download',flush=True)
    aliases={}
    for src in missing:
        canonical='https:'+src if src.startswith('//') else src
        aliases.setdefault(canonical,[]).append(src)
    failures=[]
    if not args.skip_images:
        with ThreadPoolExecutor(max_workers=8) as pool:
            tasks={pool.submit(assets.download,src):src for src in aliases}
            for n,future in enumerate(as_completed(tasks),1):
                src,path,error=future.result()
                if path:
                    for alias in aliases[src]:assets.asset_map[alias]=path
                else:failures.append(dict(url=src,error=error))
                if n%100==0:
                    save(ROOT/'data/asset-map.json',assets.asset_map);print(f'Images {n}/{len(aliases)}, failures {len(failures)}',flush=True)
        save(ROOT/'data/asset-map.json',assets.asset_map)
    save(DATA/'image-report.json',dict(url_count=len(urls),failed=failures))
    if args.assets_only:return
    details={};metadata={};keypoints={}
    for path in (DATA/'enrichment').glob('*.json'):
        doc=load(path);prefix=doc.get('prefix','xingce')
        if doc['endpoint']=='solution/keypoints':
            keypoints.setdefault(prefix,{}).update(zip(doc['ids'],doc['response']))
        else:
            target=details if doc['endpoint']=='questions' else metadata
            target.setdefault(prefix,{}).update({q['id']:q for q in doc['response']})
    catalogs={prefix:load(DATA/f'keypoints-{prefix}.json')['records'] for prefix in ('xingce','shenlun') if (DATA/f'keypoints-{prefix}.json').exists()}
    if not args.no_db:database.initialize()
    report=[]
    for n,path in enumerate(files,1):
        doc=load(path);content=path.read_bytes();digest=hashlib.sha256(content).hexdigest()
        archive=ROOT/'data/raw/fenbi-api'/f'{path.stem}-{digest[:16]}.json';archive.parent.mkdir(parents=True,exist_ok=True)
        if not archive.exists():archive.write_bytes(content)
        paper=normalize(doc,details.get(doc['entry']['prefix'],{}),metadata.get(doc['entry']['prefix'],{}),catalogs,str(archive.relative_to(ROOT)).replace('\\','/'),keypoints.get(doc['entry']['prefix'],{}))
        save(DATA/'normalized'/f'{paper["id"]}.json',dict(version=1,papers=[paper]))
        added=0
        if not args.no_db:
            with database.connect() as conn:added=database.store_paper(conn,paper)
        report.append(dict(paper_id=paper['id'],title=paper['title'],subject=paper['subject'],kind=paper['kind'],exam_level=paper['exam_level'],
            questions=len(paper['questions']),ready=sum(q['quality']=='ready' for q in paper['questions']),added=added,
            explanations=sum(bool(q['explanation']) for q in paper['questions']),archive=str(archive.relative_to(ROOT)),sha256=digest))
        if n%20==0:print(f'Imported {n}/{len(files)}',flush=True)
    save(DATA/'import-report.json',report)
    print(json.dumps(dict(papers=len(report),questions=sum(p['questions'] for p in report),added=sum(p['added'] for p in report),review=sum(p['questions']-p['ready'] for p in report),image_failures=len(failures)),ensure_ascii=False),flush=True)
if __name__=='__main__':main()