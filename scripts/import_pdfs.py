"""Reproducible import of the six user-supplied papers; source PDFs stay intact."""
from pathlib import Path
import sys,re,json,hashlib
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from taxonomy import classify
from pypdf import PdfReader
ROOT=Path(__file__).resolve().parents[1]
HEADING=re.compile(r'(?m)^[一二三四五]、[^\n]*(?:选择题|阅读理解)[^\n]*\n?(?:[^\n]*(?:选项|多选|少选|符合题目|最佳选项)[^\n]*\n)?')

def clean(text):
    text=re.sub(r'---PAGE \d+---','',text)
    text=re.sub(r'(?m)^答案[:：]\s*$','',text)
    return re.sub(r'\n{3,}','\n\n',text).strip()

def parse_pdf(path):
    pages=[p.extract_text() or '' for p in PdfReader(path).pages]
    raw='\n'.join(f'---PAGE {i+1}---\n{x}' for i,x in enumerate(pages))
    year=int(path.name[:4]); paper_id=f'pdf-{year}'
    answers=list(re.finditer(r'(?m)^(\d{1,3})、\s*([A-D]{1,4})\s*$',raw))
    start=next(x.start() for x in answers if x.group(1)=='1')
    answer_text=raw[start:]; question_text=raw[:start]
    amap={}
    for i,m in enumerate(answers):
        n=int(m.group(1))
        if not 1<=n<=120 or n in amap: continue
        end=answers[i+1].start() if i+1<len(answers) else len(raw)
        explanation=clean(HEADING.sub('',raw[m.end():end]))
        amap[n]=(m.group(2),explanation)
    starts=list(re.finditer(r'(?m)^(\d{1,3})、',question_text))
    chosen=[]; expected=1
    for m in starts:
        if int(m.group(1))==expected:
            chosen.append(m); expected+=1
            if expected==121: break
    if len(chosen)!=120: raise ValueError(f'{year}: expected 120 questions, got {len(chosen)}')
    bodies={n+1:question_text[m.end():chosen[n+1].start() if n+1<len(chosen) else len(question_text)] for n,m in enumerate(chosen)}
    # Four passages precede groups of five questions. 2019 Q110's D option wraps once.
    passages={}
    b=clean(bodies[100]); h=re.search(r'[一二三四]、英语阅读理解题[^\n]*\n',b)
    if not h: raise ValueError(f'{year}: no English section boundary')
    intro=b[h.end():]
    intro=re.sub(r'^阅读下列[^\n]*\n','',intro)
    passages[101]=intro.strip(); bodies[100]=b[:h.start()]
    for prev in (105,110,115):
        b=clean(bodies[prev]); opts=list(re.finditer(r'(?<![A-Za-z])[A-D][．.]',b))
        d=next((m for m in opts if b[m.start()]=='D'),None)
        if not d: raise ValueError(f'{year} Q{prev}: D option missing')
        end=b.find('\n',d.end())
        if year==2019 and prev==110: end=b.find('\n',end+1)
        passages[prev+1]=b[end:].strip(); bodies[prev]=b[:end]
    questions=[]
    for n,m in enumerate(chosen,1):
        body=clean(HEADING.sub('',bodies[n]))
        all_options=list(re.finditer(r'(?<!\S)([A-D])[．.]',body))
        first=next((i for i,o in enumerate(all_options) if o.group(1)=='A'),len(all_options))
        options=all_options[first:]
        labels=[x.group(1) for x in options]
        flags=[]
        if labels!=list('ABCD'): flags.append('选项结构异常，需核对原卷')
        stem=body[:options[0].start()].strip() if options else body
        values={o.group(1):body[o.end():options[i+1].start() if i+1<len(options) else len(body)].strip() for i,o in enumerate(options)}
        answer,explanation=amap.get(n,('', ''))
        if not answer: flags.append('原文件未提取到参考答案')
        if n>=81 and n<=100 and len(answer)<2: flags.append('原卷标为多选但参考答案不足两个，需核验')
        if '\ufffd' in body or re.search(r'[\x00-\x08\x0b-\x1f\x7f]',body): flags.append('原文件文字损坏或乱码')
        if re.search(r'如下图|如图|见图|下图|图所示|下表(?!述)|图[1-9]',stem): flags.append('含图表，请对照原卷核验完整性')
        if year==2024 and n in (6,50): flags.append('原卷公式或代码存在缺损，需核验')
        module,category,topic,tags=classify(stem,n)
        material=passages[101+((n-101)//5)*5] if n>100 else ''
        page=int(re.findall(r'---PAGE (\d+)---',question_text[:m.start()])[-1])
        questions.append(dict(id=f'{paper_id}-{n:03}',paper_id=paper_id,number=n,year=year,stem=stem,options=values,
            answer=list(answer),explanation=explanation,material=material,type='multiple' if 81<=n<=100 else 'single',
            module=module,category=category,topic=topic,tags=tags,source=path.name,source_page=page,
            source_url='',quality='review' if flags else 'ready',issues=flags))
    return dict(id=paper_id,title=f'{year} 金融监管计算机类专业真题',year=year,source=path.name,
        sha256=hashlib.sha256(path.read_bytes()).hexdigest(),duration_minutes=120,questions=questions)

def main():
    papers=[parse_pdf(p) for p in sorted((ROOT/'data/sources').glob('*.pdf'))]
    (ROOT/'data/bank.json').write_text(json.dumps({'version':1,'papers':papers},ensure_ascii=False,indent=2),encoding='utf-8')
    report=[]
    for paper in papers:
        issues=[{'number':q['number'],'issues':q['issues']} for q in paper['questions'] if q['issues']]
        report.append({'year':paper['year'],'questions':len(paper['questions']),'ready':120-len(issues),'review':issues})
    (ROOT/'data/import-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False,indent=2))
if __name__=='__main__': main()
