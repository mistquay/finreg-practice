"""Authenticated, resumable capture of the catalogs exposed by Fenbi's website."""
from __future__ import annotations
import argparse, hashlib, http.cookiejar, json, threading, time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, build_opener, HTTPCookieProcessor

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data/fenbi-api'
COMMON = dict(app='web', kav=131, av=134, hav=128, version='3.0.0.0')
CATALOGS = [('xingce', 1, '国考真题'), ('xingce', 2972, '国考模拟题'),
            ('shenlun', 101, '国考真题'), ('shenlun', 3379, '申论小模考')]

def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    temp.replace(path)

def load(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))

class Client:
    def __init__(self, state, interval=.3):
        self.cookies = load(state)['cookies']
        self.interval = interval
        self.lock = threading.Lock()
        self.last = 0
        self.local = threading.local()
        self.stopped = threading.Event()

    def opener(self):
        if not hasattr(self.local, 'opener'):
            jar = http.cookiejar.CookieJar()
            for c in self.cookies:
                if c['domain'].lstrip('.') != 'fenbi.com' and not c['domain'].endswith('.fenbi.com'):
                    continue
                jar.set_cookie(http.cookiejar.Cookie(0, c['name'], c['value'], None, False,
                    c['domain'], True, c['domain'].startswith('.'), c['path'], True,
                    c['secure'], None if c['expires'] < 0 else int(c['expires']), False, None, None, {}, False))
            self.local.opener = build_opener(HTTPCookieProcessor(jar))
        return self.local.opener

    def get(self, url, params=None):
        host = urlparse(url).hostname or ''
        if urlparse(url).scheme != 'https' or not any(host == h or host.endswith('.'+h) for h in ('fenbi.com','fbstatic.cn','fenbike.cn')):
            raise ValueError('Unsupported business response URL')
        if params:
            url += ('&' if '?' in url else '?') + urlencode(params)
        for attempt in range(4):
            if self.stopped.is_set():
                raise RuntimeError('Capture stopped after authentication/rate-limit failure')
            with self.lock:
                time.sleep(max(0, self.last + self.interval - time.monotonic()))
                self.last = time.monotonic()
            try:
                req = Request(url, headers={'User-Agent':'Mozilla/5.0', 'Referer':'https://www.fenbi.com/'})
                with self.opener().open(req, timeout=35) as response:
                    return json.loads(response.read().decode('utf-8'))
            except HTTPError as error:
                if error.code in (401,403):
                    self.stopped.set()
                    raise RuntimeError(f'HTTP {error.code}; refresh login or check account access') from None
                if error.code not in (429,500,502,503,504) or attempt == 3:
                    if error.code == 429: self.stopped.set()
                    raise RuntimeError(f'HTTP {error.code}') from None
                time.sleep(min(30, max(2**(attempt+1), float(error.headers.get('Retry-After','0')))))
            except (URLError, TimeoutError, json.JSONDecodeError):
                if attempt == 3: raise
                time.sleep(2**(attempt+1))

    def api(self, prefix, endpoint, **params):
        return self.get(f'https://tiku.fenbi.com/api/{prefix}/{endpoint}', dict(COMMON, **params))

def catalog(client):
    entries = {}
    report = []
    for prefix, label, kind in CATALOGS:
        page = 0
        found = 0
        kept = 0
        while True:
            doc = client.api(prefix, 'papers/v2', labelId=label, toPage=page, pageSize=15)
            if not isinstance(doc, dict) or not isinstance(doc.get('list'), list) or 'pageInfo' not in doc:
                raise ValueError(f'Unexpected catalog {prefix}/{label}: {str(doc)[:100]}')
            save(DATA / 'catalogs' / f'{prefix}-{label}-{page}.json', doc)
            for row in doc['list']:
                found += 1
                kept += 1
                entries[f'{prefix}-{row["id"]}'] = dict(prefix=prefix, label_id=label,
                    kind=kind, listing=row)
            page += 1
            if page >= doc['pageInfo']['totalPage']: break
        report.append(dict(prefix=prefix,label_id=label,listed=found,selected=kept))
        print(json.dumps(report[-1],ensure_ascii=False), flush=True)
    save(DATA / 'catalog.json', {'captured_at':datetime.now(timezone.utc).isoformat(),
        'scope':report, 'papers':list(entries.values())})

def capture_one(client, entry, refresh=False):
    row = entry['listing']; prefix = entry['prefix']; key = f'{prefix}-{row["id"]}'
    target = DATA / 'papers' / f'{key}.json'
    if target.exists() and not refresh: return key, 'cached', None
    gate = client.get('https://tiku.fenbi.com/combine/exercise/getPaperSolution', dict(COMMON,
        format='html',key=row['combineKey'],routecs=prefix,paperId=row['id'],checkId=row['encodeCheckInfo']))
    if gate.get('code') != 1:
        save(DATA/'unavailable'/f'{key}.json',dict(entry=entry,response=gate))
        return key, 'unavailable', {'code':gate.get('code'),'message':gate.get('msg')}
    urls = (gate.get('data') or {}).get('staticUrl',{}).get('urls',[])
    if not urls: raise ValueError('No static paper URL')
    paper = client.get(urls[0])
    if not isinstance(paper,dict) or not paper.get('solutions') or not paper.get('card'):
        raise ValueError('Incomplete paper solution response')
    save(target, dict(entry=entry, captured_at=datetime.now(timezone.utc).isoformat(),
        gate=gate, static_url=urls[0], paper=paper))
    return key, 'saved', len(paper['solutions'])

def papers(client, workers, refresh):
    entries = load(DATA/'catalog.json')['papers']
    report = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        tasks = {pool.submit(capture_one, client, item, refresh):item for item in entries}
        for future in as_completed(tasks):
            entry=tasks[future]; key=f'{entry["prefix"]}-{entry["listing"]["id"]}'
            try: key,status,detail=future.result()
            except Exception as e: status,detail='failed',str(e)
            report.append(dict(key=key,status=status,detail=detail))
            save(DATA/'capture-report.json', report)
            if len(report)%10==0 or status in ('failed','unavailable'):
                print(f'{len(report)}/{len(entries)} {key} {status} {detail}',flush=True)
    print('Capture summary:',json.dumps({s:sum(r['status']==s for r in report) for s in {r['status'] for r in report}}),flush=True)

def enrich(client, workers):
    ids={};points={}
    for path in (DATA/'papers').glob('*.json'):
        doc=load(path)
        for q in doc['paper']['solutions']:
            prefix=q.get('tikuPrefix',doc['entry']['prefix'])
            ids.setdefault(prefix,set()).add(q['id'])
            points.setdefault(prefix,set()).update(p['id'] for p in q.get('keypoints',[]))
    jobs=[]
    for prefix,question_ids in ids.items():
        for endpoint in ('questions','question/meta','solution/keypoints'):
            values=sorted(question_ids)
            for start in range(0,len(values),100):
                batch=values[start:start+100]
                digest=hashlib.sha256(','.join(map(str,batch)).encode()).hexdigest()[:16]
                path=DATA/'enrichment'/f'{"" if prefix=="xingce" else prefix+"-"}{endpoint.replace("/","-")}-{digest}.json'
                if not path.exists():jobs.append((prefix,endpoint,batch,path))
    def fetch(job):
        prefix,endpoint,batch,path=job
        response=client.api(prefix,endpoint,ids=','.join(map(str,batch)))
        if not isinstance(response,list) or len(response)!=len(batch):
            raise ValueError(f'Incomplete {prefix}/{endpoint} batch')
        if endpoint!='solution/keypoints' and {q.get('id') for q in response}!=set(batch):
            raise ValueError(f'Unmatched IDs in {prefix}/{endpoint}')
        if endpoint=='solution/keypoints' and not all(isinstance(row,list) for row in response):
            raise ValueError('Invalid positional keypoints response')
        save(path,dict(prefix=prefix,endpoint=endpoint,ids=batch,captured_at=datetime.now(timezone.utc).isoformat(),response=response))
    failures=[]
    with ThreadPoolExecutor(max_workers=workers) as pool:
        tasks={pool.submit(fetch,job):job for job in jobs}
        for n,f in enumerate(as_completed(tasks),1):
            try:f.result()
            except Exception as e:failures.append(dict(prefix=tasks[f][0],endpoint=tasks[f][1],ids=tasks[f][2],error=str(e)))
            if n%20==0:print(f'Enrichment {n}/{len(jobs)}, failures {len(failures)}',flush=True)
    save(DATA/'enrichment-report.json',dict(unique_questions={prefix:len(values) for prefix,values in ids.items()},failed=failures))
    for prefix,wanted in points.items():
        path=DATA/f'keypoints-{prefix}.json'
        result=load(path) if path.exists() else {'records':{},'batches':[]}
        wanted.update(p['parentId'] for p in result['records'].values() if p.get('parentId'))
        for depth in range(12):
            remaining=sorted(wanted-set(map(int,result['records'])))
            if not remaining:break
            for start in range(0,len(remaining),100):
                batch=remaining[start:start+100];response=client.api(prefix,'keypoints',ids=','.join(map(str,batch)))
                if not isinstance(response,list):raise ValueError('Invalid keypoints response')
                result['batches'].append(dict(ids=batch,response=response))
                for point in response:result['records'][str(point['id'])]=point
                save(path,result)
            wanted.update(p['parentId'] for p in result['records'].values() if p.get('parentId'))
        print(prefix,'keypoint records',len(result['records']),flush=True)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('stage',choices=['catalog','papers','enrich','all'])
    parser.add_argument('--state',type=Path,default=ROOT/'data/fenbi/session.private.json')
    parser.add_argument('--workers',type=int,default=3)
    parser.add_argument('--refresh',action='store_true')
    args=parser.parse_args();client=Client(args.state)
    if args.stage in ('catalog','all'):catalog(client)
    if args.stage in ('papers','all'):papers(client,max(1,min(4,args.workers)),args.refresh)
    if args.stage in ('enrich','all'):enrich(client,max(1,min(4,args.workers)))
if __name__=='__main__':main()