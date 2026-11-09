#!/usr/bin/env python3
"""로컬 재현(TC-BBSC-007): 딥스캔 런 진행 중 F5 → 페이지 응답성·메모리 측정.

대상: http://localhost:3014 (워크트리 로컬 스택). 순수 CDP — agent-browser 무개입.
절차: (전이된 세션) → 포트폴리오 세션 시딩(삼성전자) → 홈 카드 확장 → 딥스캔 분석 클릭
      → +8s F5(Page.reload) → 120s 관찰(eval 지연·렌더러 RSS·CPU).
출력: 인자 JSON 경로 (기본 /tmp/jaroo-wedge/f5-local-before.json)

전제:
- 로컬 스택: PORT=3014 CRAWLER_PORT=3045 JAROO_CRAWLER_BASE_URL=http://127.0.0.1:3045 \
  JAROO_LLM_MOCK=1 npm run dev   (crawler .env 빈 파일 필요)
- 전용 크롬: google-chrome --headless=new --remote-debugging-port=9232 \
  --user-data-dir=<프로필> about:blank
- 세션: /deepscan은 인증 게이트 — 같은 Supabase 프로젝트를 쓰는 신뢰 브라우저의
  sb-*-auth-token 쿠키를 CDP Network.setCookie로 전이한다.
  상세는 docs/tc/TC-BBSC-007-whitebox-wedge.md §5.
"""
import json, urllib.request, asyncio, time, os, subprocess, sys

PORT = int(os.environ.get('BBS_CDP_PORT', '9232'))
BASE = os.environ.get('JAROO_LOCAL_BASE', 'http://localhost:3014')
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/jaroo-wedge/f5-local-before.json'
PROFILE = os.environ.get('BBS_CHROME_PROFILE', '/tmp/jaroo-wedge/chrome-profile')

def http_json(path, method='GET', timeout=20):
    req = urllib.request.Request(f'http://127.0.0.1:{PORT}{path}', method=method)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)

async def new_tab(url):
    return http_json(f'/json/new?{url}', method='PUT')

class Page:
    def __init__(self, ws):
        self.ws = ws; self.id = 0
    async def send(self, method, params=None):
        self.id += 1
        await self.ws.send(json.dumps({'id': self.id, 'method': method, 'params': params or {}}))
        return self.id
    async def recv_result(self, want_id, timeout=25):
        t0 = time.time()
        while time.time() - t0 < timeout:
            try:
                raw = await asyncio.wait_for(self.ws.recv(), timeout=timeout)
            except asyncio.TimeoutError:
                return None
            m = json.loads(raw)
            if m.get('id') == want_id:
                return m.get('result')
        return None
    async def eval(self, expr, timeout=10):
        t0 = time.time()
        i = await self.send('Runtime.evaluate', {'expression': expr, 'returnByValue': True, 'awaitPromise': True})
        r = await self.recv_result(i, timeout)
        return round((time.time() - t0) * 1000), (r['result'].get('value') if r and 'result' in r else None)

def top_rss():
    """이 재현 전용 프로파일(--user-data-dir)을 쓰는 chrome 프로세스 상위 3개 (pid, rssMB, cpu%)."""
    out = subprocess.run(['ps', '-o', 'pid,rss,pcpu,args', '--no-headers', '-C', 'chrome', '-C', 'chromium'],
                         capture_output=True, text=True).stdout
    rows = []
    for line in out.strip().split('\n'):
        if PROFILE not in line:
            continue
        f = line.split(None, 3)
        if len(f) >= 4:
            try: rows.append((int(f[0]), int(f[1]), float(f[2])))
            except ValueError: pass
    rows.sort(key=lambda x: -x[1])
    return [(pid, rss // 1024, cpu) for pid, rss, cpu in rows[:3]]

def log(msg):
    print(f'[{time.strftime("%H:%M:%S")}] {msg}', flush=True)

SEED_PORTFOLIO_JS = """(function(){
  var row = {name:'삼성전자',quantity:'12주',profitAmount:'1200000',profitRate:'100.0%',evaluationAmount:'2,354,700',averagePrice:'71,500',averagePriceCurrency:'KRW',code:'005930',resolvedName:'삼성전자',resolvedCode:'005930',resolvedMarket:'KOSPI',resolvedMarketTone:'kospi',resolvedKind:'stock'};
  var session = {broker:'OCR 적용 포트폴리오', rows:[row], appliedAt:new Date().toISOString()};
  sessionStorage.setItem('jaroo:applied-home-portfolio', JSON.stringify(session));
  return 'seeded';
})()"""

async def main():
    import websockets
    ev = {'meta': {'startedAt': time.strftime('%Y-%m-%dT%H:%M:%S'), 'scenario': '딥스캔 런 진행 중(+8s) F5(Page.reload) — 순수 CDP 로컬 스택', 'base': BASE}}
    t = await new_tab(f'{BASE}/login')
    async with websockets.connect(t['webSocketDebuggerUrl'], max_size=64*1024*1024) as ws:
        p = Page(ws)
        await p.send('Page.enable'); await p.send('Runtime.enable')
        async def nav(url, wait=3.0):
            i = await p.send('Page.navigate', {'url': url})
            await p.recv_result(i, 40)
            await asyncio.sleep(wait)
        await nav(f'{BASE}/login', 4)
        _, me = await p.eval("(function(){return fetch('/api/auth/me').then(function(r){return r.json()}).then(function(b){return (b&&b.user&&(b.user.email||b.user.id))||null})})()")
        log('me: ' + str(me))
        if not me:
            log('FATAL: 세션 없음 — transfer-session.py 먼저 실행'); sys.exit(2)
        await nav(f'{BASE}/home', 4)
        _, seeded = await p.eval(SEED_PORTFOLIO_JS)
        log('portfolio seed: ' + str(seeded))
        await nav(f'{BASE}/home', 4)
        _, home = await p.eval("(document.body.innerText||'').replace(/\\s+/g,' ').slice(0,100)")
        log('home: ' + str(home))
        # 종목 카드 확장 → 딥스캔 분석 클릭
        started = False
        for attempt in range(5):
            _, r = await p.eval("(function(){"
                "var head=Array.from(document.querySelectorAll('button')).find(function(x){return (x.innerText||'').indexOf('삼성전자')!==-1&&x.innerText.length>10;});"
                "if(head){head.click(); return 'expanded'} return 'nohead'"
                "})()")
            await asyncio.sleep(1.5)
            _, r = await p.eval("(function(){var b=Array.from(document.querySelectorAll('a,button')).find(function(x){return (x.innerText||'').indexOf('딥스캔 분석')!==-1}); if(!b) return 'nobtn'; b.click(); return 'started'})()")
            log(f'run attempt {attempt}: ' + str(r))
            if r == 'started':
                started = True
                break
            await asyncio.sleep(2)
        if not started:
            log('FATAL: 딥스캔 시작 실패'); sys.exit(3)
        await asyncio.sleep(8)
        _, s = await p.eval("location.pathname + ' | ' + document.body.innerText.replace(/\\s+/g,' ').slice(0,60)")
        log('pre-reload state: ' + str(s))
        ev['preReload'] = s
        log('F5 — Page.reload (런 진행 중)')
        t0 = time.time()
        i = await p.send('Page.reload')
        rr = await p.recv_result(i, 15)
        ev['reloadAckSec'] = round(time.time() - t0, 1)
        log('reload ack: ' + str(ev['reloadAckSec']) + 's')
        samples = []
        n = int(os.environ.get('BBS_SAMPLE_COUNT', '12'))
        for k in range(n):
            await asyncio.sleep(10)
            dt, v = await p.eval("location.pathname + ' | ' + document.body.innerText.replace(/\\s+/g,' ').slice(0,60)", timeout=6)
            rec = {'atSec': (k + 1) * 10, 'evalLatencyMs': dt, 'evalOk': v is not None, 'preview': (v or '')[:70], 'topRssMb': top_rss()}
            samples.append(rec)
            log(json.dumps(rec, ensure_ascii=False))
        ev['samples'] = samples
        ok_ratio = sum(1 for s in samples if s['evalOk']) / len(samples)
        max_rss = max((s['topRssMb'][0][1] if s['topRssMb'] else 0) for s in samples)
        ev['maxRssMb'] = max_rss
        ev['verdict'] = 'WEDGE(평가 불응답 다수)' if ok_ratio < 0.5 else ('SLOW' if any(s['evalLatencyMs'] > 3000 for s in samples) else 'RESPONSIVE')
        log(f"VERDICT: {ev['verdict']} maxRss={max_rss}MB")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w') as f:
        json.dump(ev, f, ensure_ascii=False, indent=2)
    log('evidence: ' + OUT)

if __name__ == '__main__':
    asyncio.run(main())
