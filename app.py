"""Single-user study application. Python standard library; local by default."""
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
from urllib.parse import urlparse,parse_qs,unquote
import json,mimetypes,traceback,argparse,sqlite3,tempfile,os,gzip,time,signal
from pathlib import Path
from contextlib import closing
import database,services,importer
ROOT=Path(__file__).resolve().parent

def configured_origins(value):
    origins=set()
    for item in value.split(','):
        if not item.strip(): continue
        parsed=urlparse(item.strip())
        if (parsed.scheme not in ('http','https') or not parsed.hostname or '*' in parsed.hostname
                or parsed.username is not None or parsed.password is not None
                or parsed.path not in ('','/') or parsed.query or parsed.fragment):
            raise ValueError('FINREG_ALLOWED_ORIGINS 应为逗号分隔的 http(s)://主机[:端口]，不能包含路径')
        port=parsed.port
        host=parsed.hostname.lower()
        if ':' in host: host=f'[{host}]'
        if port and port!={'http':80,'https':443}[parsed.scheme]: host+=f':{port}'
        origins.add(f'{parsed.scheme}://{host}')
    return origins

class Handler(BaseHTTPRequestHandler):
    def send(self,data,status=200,ctype='application/json; charset=utf-8',headers=None):
        body=json.dumps(data,ensure_ascii=False,separators=(',',':')).encode() if ctype.startswith('application/json') else data
        headers=dict(headers or {})
        if ctype.startswith('application/json') and len(body)>1024 and 'gzip' in {part.strip() for part in self.headers.get('Accept-Encoding','').split(',')}:
            body=gzip.compress(body,compresslevel=1)
            headers.update({'Content-Encoding':'gzip','Vary':'Accept-Encoding'})
        self.send_response(status); self.send_header('Content-Type',ctype); self.send_header('Content-Length',str(len(body)))
        self.send_header('X-Content-Type-Options','nosniff'); self.send_header('Cache-Control','no-store')
        for k,v in (headers or {}).items(): self.send_header(k,v)
        self.end_headers(); self.wfile.write(body)
    def json_body(self):
        if not self.headers.get('Content-Type','').startswith('application/json'): raise ValueError('请提交 JSON 数据')
        size=int(self.headers.get('Content-Length',0))
        if size<1 or size>30_000_000: raise ValueError('数据大小不合法（上限30MB）')
        return json.loads(self.rfile.read(size))
    def authorized(self):
        port=self.server.server_port
        origins={f'http://127.0.0.1:{port}',f'http://localhost:{port}'} | getattr(self.server,'allowed_origins',set())
        hosts={urlparse(origin).netloc for origin in origins}
        for origin in origins:
            parsed=urlparse(origin)
            if parsed.port is None: hosts.add(f'{parsed.netloc}:{443 if parsed.scheme=="https" else 80}')
        if self.headers.get('Host','').lower() not in hosts: return False
        origin=self.headers.get('Origin')
        return not origin or origin in origins
    def do_GET(self):
        if not self.authorized():return self.send({'error':'访问来源未获允许，请检查 FINREG_ALLOWED_ORIGINS'},403)
        url=urlparse(self.path); path=url.path; filters={k:v[-1] for k,v in parse_qs(url.query).items()}
        try:
            if path=='/healthz':return self.send({'status':'ok'})
            if path=='/api/meta':
                started=time.perf_counter(); meta=services.metadata()
                return self.send(meta,headers={'Server-Timing':f'meta;dur={(time.perf_counter()-started)*1000:.1f}'})
            if path=='/api/questions':return self.send(services.list_questions(filters))
            if path.startswith('/api/question/'):
                return self.send(services.get_question(unquote(path.split('/')[-1]),filters.get('answer')=='1',filters.get('compact')!='1'))
            if path.startswith('/api/session/'):return self.send(services.get_session(path.split('/')[-1]))
            if path=='/api/stats':return self.send(services.statistics(filters))
            if path=='/api/backup':
                with tempfile.TemporaryDirectory() as tmp:
                    target=Path(tmp)/'practice.sqlite3'
                    with database.connect() as src,closing(sqlite3.connect(target)) as dest: src.backup(dest)
                    return self.send(target.read_bytes(),ctype='application/octet-stream',headers={'Content-Disposition':'attachment; filename="finreg-backup.sqlite3"'})
            if path=='/api/export':
                with database.connect() as c:
                    papers=[dict(p) for p in c.execute('SELECT * FROM papers')]
                    for p in papers:p['questions']=[database.decode(q) for q in c.execute('SELECT * FROM questions WHERE paper_id=? ORDER BY number',(p['id'],))]
                return self.send({'version':1,'papers':papers},headers={'Content-Disposition':'attachment; filename="finreg-questions.json"'})
            if path.startswith('/sources/'):
                base=ROOT/'data/sources'; name=unquote(path[len('/sources/'):])
            elif path.startswith('/assets/'):
                base=ROOT/'data/assets'; name=unquote(path[len('/assets/'):])
            elif path.startswith('/tools/'):
                base=ROOT/'tools'; name=unquote(path[len('/tools/'):])
            else: base=ROOT/'web'; name=unquote(path.lstrip('/')) or 'index.html'
            file=(base/name).resolve()
            if not file.is_relative_to(base.resolve()) or not file.is_file():return self.send({'error':'文件不存在'},404)
            ctype=mimetypes.guess_type(str(file))[0] or 'application/octet-stream'
            if file.suffix=='.js':ctype='text/javascript; charset=utf-8'
            return self.send(file.read_bytes(),ctype=ctype)
        except (ValueError,KeyError,TypeError) as e:return self.send({'error':str(e)},400)
        except Exception:
            traceback.print_exc();return self.send({'error':'服务处理失败，请查看服务日志'},500)
    def do_POST(self):
        if not self.authorized():return self.send({'error':'访问来源未获允许，请检查 FINREG_ALLOWED_ORIGINS'},403)
        try:
            body=self.json_body(); path=urlparse(self.path).path
            if path=='/api/session':result=services.create_session(body)
            elif path.startswith('/api/session/'):
                parts=path.strip('/').split('/'); sid=parts[2]
                if len(parts)==4 and parts[3]=='answer': result=services.answer(sid,body)
                elif len(parts)==4 and parts[3]=='finish': result=services.finish_session(sid,body)
                else: result=services.update_session(sid,body)
            elif path.startswith('/api/mark/'):result=services.mark(unquote(path.split('/')[-1]),body)
            elif path.startswith('/api/edit/'):result=importer.edit_question(unquote(path.split('/')[-1]),body)
            elif path=='/api/import':result=importer.import_data(body['data'],body.get('preview',False))
            else:return self.send({'error':'接口不存在'},404)
            return self.send(result)
        except (ValueError,KeyError,TypeError,sqlite3.IntegrityError) as e:return self.send({'error':str(e)},400)
        except Exception:
            traceback.print_exc();return self.send({'error':'保存失败，请查看服务日志'},500)
    def log_message(self,fmt,*args):print(f'{self.log_date_time_string()} {fmt%args}',flush=True)

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--host',default=os.environ.get('FINREG_HOST','127.0.0.1'))
    parser.add_argument('--port',type=int,default=int(os.environ.get('FINREG_PORT','8765')))
    args=parser.parse_args()
    origins=configured_origins(os.environ.get('FINREG_ALLOWED_ORIGINS',''))
    database.initialize(); server=ThreadingHTTPServer((args.host,args.port),Handler)
    server.allowed_origins=origins
    server.daemon_threads=False
    def stop(signum,frame): raise KeyboardInterrupt
    signal.signal(signal.SIGTERM,stop)
    print(f'FinReg Practice: http://{args.host}:{args.port}',flush=True)
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.server_close()
if __name__=='__main__':main()
