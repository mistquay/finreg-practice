"""Archive complete business payloads and build an offline bank from captured responses."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser
from urllib.request import Request,urlopen
from urllib.parse import urlparse
from datetime import datetime,timezone,timedelta
import json,re,hashlib,sys,threading,time
try:
    import requests
except ImportError:
    requests=None
HTTP_LOCAL=threading.local()
IMAGE_LOCK=threading.Lock()
IMAGE_LAST=0.0
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from importer import PlainText
ASSETS=ROOT/'data/assets';ASSETS.mkdir(exist_ok=True)
ASSET_INDEX={p.stem:p for p in ASSETS.iterdir() if p.is_file()}
class Content(PlainText):
    def handle_starttag(self,tag,attrs):
        if tag=='img':
            src=dict(attrs).get('src','');item=asset_map.get(src)
            if item:self.parts.append('[[image:'+item+']]')
            else:self.parts.append('[图片未能保存，请核对来源]');self.images.append(src)
        else:super().handle_starttag(tag,attrs)
def plain(s):
    p=Content();p.feed(s or '');return re.sub(r'\n{3,}','\n\n',''.join(p.parts)).strip(),p.images

def download(src):
    global IMAGE_LAST
    url='https:'+src if src.startswith('//') else src
    host=(urlparse(url).hostname or '').lower()
    if urlparse(url).scheme not in ('https','http') or not any(host==h or host.endswith('.'+h) for h in ('fbstatic.cn','fenbike.cn','fenbi.com')):return src,None,'unsupported image host'
    key=hashlib.sha256(url.encode()).hexdigest()[:24]
    existing=ASSET_INDEX.get(key)
    if existing and existing.exists():return src,'/assets/'+existing.name,None
    try:
        with IMAGE_LOCK:
            time.sleep(max(0,IMAGE_LAST+.08-time.monotonic()))
            IMAGE_LAST=time.monotonic()
        headers={'User-Agent':'Mozilla/5.0','Referer':'https://www.fenbi.com/'}
        if requests is not None:
            if not hasattr(HTTP_LOCAL,'session'):
                from urllib3.util.retry import Retry
                HTTP_LOCAL.session=requests.Session()
                retries=Retry(total=3,backoff_factor=2,status_forcelist=[429,500,502,503,504],respect_retry_after_header=True)
                HTTP_LOCAL.session.mount('https://',requests.adapters.HTTPAdapter(max_retries=retries))
            with HTTP_LOCAL.session.get(url,headers=headers,timeout=(10,25),stream=True) as response:
                response.raise_for_status()
                ctype=response.headers.get('Content-Type','').split(';')[0].strip()
                data=bytearray()
                for chunk in response.iter_content(65536):
                    data.extend(chunk)
                    if len(data)>8_000_000:raise ValueError('image too large')
        else:
            with urlopen(Request(url,headers=headers),timeout=25) as response:
                ctype=response.headers.get_content_type();data=response.read(8_000_001)
        ext={'image/png':'.png','image/jpeg':'.jpg','image/gif':'.gif','image/webp':'.webp'}.get(ctype)
        if not ext:raise ValueError('unsupported '+ctype)
        if len(data)>8_000_000:raise ValueError('image too large')
        filename=key+ext;target=ASSETS/filename
        temp=target.with_suffix(ext+'.part');temp.write_bytes(data);temp.replace(target)
        ASSET_INDEX[key]=target
        return src,'/assets/'+filename,None
    except Exception as e:return src,None,str(e)

asset_map={}
def main():
    global asset_map
    folder=ROOT/'data/fenbi'; files=sorted(folder.glob('*-exercise-response.txt'))
    loaded=[];urls=set()
    for file in files:
        year=int(file.name[:4]); exercise=json.loads(file.read_text(encoding='utf-8'));details=json.loads((folder/f'{year}-details.json').read_text(encoding='utf-8'))
        loaded.append((year,exercise,details))
        def images(obj):
            if isinstance(obj,str):
                p=PlainText();p.feed(obj);urls.update(p.images)
            elif isinstance(obj,dict):
                for v in obj.values():images(v)
            elif isinstance(obj,list):
                for v in obj:images(v)
        images(exercise);images(details)
    failures=[]
    for src,path,err in ThreadPoolExecutor(max_workers=4).map(download,sorted(urls)):
        if path:asset_map[src]=path
        else:failures.append({'url':src,'error':err})
    (ROOT/'data/asset-map.json').write_text(json.dumps(asset_map,ensure_ascii=False,indent=2),encoding='utf-8')
    papers=[];timestamp=datetime.now(timezone(timedelta(hours=8))).isoformat(timespec='seconds')
    manifest={'collected_at':timestamp,'source':'fenbi','documents':[],'images':len(asset_map),'image_failures':failures}
    archive=ROOT/'data/raw/fenbi';archive.mkdir(parents=True,exist_ok=True)
    catalog_file=folder/'keypoint-catalog.json'
    catalog=json.loads(catalog_file.read_text(encoding='utf-8')) if catalog_file.exists() else {}
    catalog_records=catalog.get('records',{})
    catalog_bytes=json.dumps(catalog,ensure_ascii=False,indent=2).encode()
    catalog_hash=hashlib.sha256(catalog_bytes).hexdigest()
    catalog_name=f'keypoint-catalog-{catalog_hash[:12]}.json'
    (archive/catalog_name).write_bytes(catalog_bytes)
    manifest['documents'].append({'file':catalog_name,'sha256':catalog_hash,'kind':'keypoint-catalog'})
    for year,exercise,details in loaded:
        extra_path=folder/f'{year}-enrichment.json'
        extra=json.loads(extra_path.read_text(encoding='utf-8')) if extra_path.exists() else {}
        extra_meta={m['id']:m for m in extra.get('metadata',[])}
        for kind,payload in [('exercise',exercise),('questions',details),('enrichment',extra)]:
            content=json.dumps(payload,ensure_ascii=False,indent=2).encode();digest=hashlib.sha256(content).hexdigest();name=f'{year}-{kind}-{digest[:12]}.json';(archive/name).write_bytes(content)
            manifest['documents'].append({'file':name,'sha256':hashlib.sha256(content).hexdigest(),'year':year,'kind':kind})
        mat={m['globalId']:m for m in exercise.get('materials',[])};cats={};mats={}
        def card(node,path=None):
            path=path or []
            if node.get('name'):path=path+[node['name']]
            if node.get('key'):cats[node['key']]=path;mats[node['key']]=node.get('materialKeys',[])
            for child in node.get('children',[]):card(child,path)
        card(exercise['card']);dmap={q['id']:q for q in details};questions=[];pid=f'fenbi-xingce-{year}-city'
        for n,item in enumerate(exercise['questions'],1):
            q=dmap[item['id']];stem,missing=plain(q['content']);opts=next((x['options'] for x in q.get('accessories',[]) if 'options' in x),[])
            options={}
            for i,v in enumerate(opts):
                val,imgs=plain(v);options[chr(65+i)]=val;missing+=imgs
            material_html='\n'.join(mat[k]['content'] for k in mats.get(item['globalId'],[]) if k in mat)
            if not material_html and isinstance(q.get('material'),dict):material_html=q['material'].get('content','')
            material,imgs=plain(material_html);missing+=imgs
            choice=q.get('correctAnswer',{}).get('choice','');answer=[];issues=[]
            if isinstance(choice,str) and re.fullmatch('[0-7](?:,[0-7])*',choice):answer=[chr(65+int(v)) for v in choice.split(',')]
            else:issues.append('参考答案结构需要核验')
            if missing:issues.append('部分图片未保存，需核验')
            path=cats.get(item['globalId'],['待分类']);category=path[0]
            keypoints=extra.get('keypoints',{}).get(str(q['id']),[])
            point_names=[p['name'] for p in keypoints if isinstance(p,dict) and p.get('name')]
            topic=' / '.join(point_names) if point_names else path[-1]
            tags=list(dict.fromkeys(path+point_names))
            questions.append(dict(id=f'{pid}-{q["id"]}',paper_id=pid,number=n,year=year,stem=stem,options=options,answer=answer,explanation='',material=material,
                type='single' if len(answer)<=1 else 'multiple',module='行测',category=category,topic=topic,tags=tags,
                source=exercise['name'],source_page=0,source_url='https://www.fenbi.com/spa/tiku/guide/realTest/xingce/xingce',quality='review' if issues else 'ready',issues=issues,
                provider='fenbi',external_id=str(q['id']),difficulty=q.get('difficulty'),raw={'question':q,'platform_statistics':extra_meta.get(q['id'],{}),'keypoints':keypoints,'keypoint_details':[catalog_records.get(str(p['id']),{}) for p in keypoints],'exercise_question':item,'chapter_path':path,'material_keys':mats.get(item['globalId'],[]),'collected_at':timestamp}))
        papers.append(dict(id=pid,title=exercise['name'],year=year,source=exercise['name'],duration_minutes=120,questions=questions))
    (ROOT/'data/fenbi-bank.json').write_text(json.dumps({'version':1,'papers':papers},ensure_ascii=False,indent=2),encoding='utf-8')
    (archive/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'papers':len(papers),'questions':sum(len(p['questions']) for p in papers),'images':len(asset_map),'failures':failures},ensure_ascii=False))
if __name__=='__main__':main()
