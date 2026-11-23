#!/usr/bin/env python3
"""TC-BBSC-007 규격 재현: 런 완료 후 /deepscan 재진입 시 페이지 응답성·메모리 측정.
출력: docs/tc/skeleton-evidence/reenter-wedge-repro.json"""
import json, urllib.request, asyncio, time, os, subprocess, sys

PORT = int(os.environ.get('BBS_CDP_PORT', '9232'))
BASE = 'https://jaroo-dev.up.railway.app'
AUTH = os.environ.get('BB_BASIC_AUTH')  # 필수: 하드코딩 금지 규칙

def http_json(path, method='GET', timeout=20):
    req = urllib.request.Request(f'http://127.0.0.1:{PORT}{path}', method=method)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)

def pages():
    return [t for t in http_json('/json/list') if t['type'] == 'page']

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
    async def eval(self, expr, timeout=15):
        t0 = time.time()
        i = await self.send('Runtime.evaluate', {'expression': expr, 'returnByValue': True, 'awaitPromise': True})
        r = await self.recv_result(i, timeout)
        dt = round((time.time() - t0) * 1000)
        v = r['result'].get('value') if r and 'result' in r else None
        return dt, v

def renderer_rss():
    out = subprocess.run(['ps', '-o', 'pid,rss,pcpu', '--no-headers', '-C', 'chrome'], capture_output=True, text=True).stdout
    rows = []
    for line in out.strip().split('\n'):
        if not line.strip(): continue
        f = line.split()
        if len(f) >= 3:
            rows.append((int(f[0]), int(f[1]), float(f[2])))
    rows.sort(key=lambda x: -x[1])
    return rows[:3]

def log(msg):
    print(f'[{time.strftime("%H:%M:%S")}] {msg}', flush=True)

async def main():
    import websockets
    ev = {'meta': {'startedAt': time.strftime('%Y-%m-%dT%H:%M:%S'), 'base': BASE, 'note': '런 완료 후 /deepscan 신규 탭 재진입 — 평가 지연·렌더러 RSS 측정'}}
    # 0) Basic Auth 최초 통과(신 프로필) — 임베디드 자격 1회
    t = await new_tab(f'https://{AUTH}@{BASE}/login')
    ws_url = t['webSocketDebuggerUrl']
    async with websockets.connect(ws_url, max_size=64*1024*1024) as ws:
        p = Page(ws)
        await p.send('Page.enable'); await p.send('Runtime.enable')
        async def nav(url, wait=3.0):
            i = await p.send('Page.navigate', {'url': url})
            await p.recv_result(i, 40)
            await asyncio.sleep(wait)
        # 로그인
        await nav(f'{BASE}/login', 4)
        await p.eval("(function(){var c=document.querySelector('input[type=checkbox]'); if(c&&!c.checked){c.click()}})()")
        await asyncio.sleep(0.5)
        await p.eval("(function(){var b=Array.from(document.querySelectorAll('button')).find(function(x){return (x.innerText||'').indexOf('Google로 시작하기')!==-1}); if(b){b.dispatchEvent(new MouseEvent('click',{bubbles:true}))}})()")
        await asyncio.sleep(7)
        await nav(f'{BASE}/home', 3)
        _, me = await p.eval("fetch('/api/auth/me').then(function(r){return r.text()}).then(function(t){return t.slice(0,40)})")
        log('auth: ' + str(me))
        # 종목
        _, st = await p.eval("(function(){return /포트폴리오 준비/.test(document.body.innerText)?'empty':'has'})()")
        if st == 'empty':
            await nav(f'{BASE}/screenshot', 3)
            i = await p.send('DOM.getDocument'); doc = await p.recv_result(i, 20)
            i = await p.send('DOM.querySelector', {'nodeId': doc['root']['nodeId'], 'selector': 'input[type=file]'})
            qr = await p.recv_result(i, 20)
            i = await p.send('DOM.setFileInputFiles', {'files': ['/tmp/bbsc/synthetic-portfolio.png'], 'nodeId': qr.get('nodeId', 0)})
            await p.recv_result(i, 20)
            for k in range(20):
                await asyncio.sleep(2.5)
                _, r = await p.eval("(function(){var t=document.body.innerText; var m=t.match(/(\\d+)개 종목 인식/); if(!m) return 'wait'; var b=Array.from(document.querySelectorAll('button')).find(function(x){return x.innerText.includes('적용하기')}); if(b){b.click(); return 'applied'} return 'nobtn'})()")
                if r and r != 'wait': break
            await asyncio.sleep(5)
        # 런
        await nav(f'{BASE}/home', 3)
        await p.eval("(function(){var b=Array.from(document.querySelectorAll('button')).find(function(x){return (x.innerText||'').includes('KOSPI')}); if(b){b.click()}})()")
        await asyncio.sleep(2)
        _, r = await p.eval("(function(){var b=Array.from(document.querySelectorAll('button,a')).find(function(x){return (x.innerText||'').indexOf('딥스캔 분석')!==-1}); if(!b) return 'nobtn'; b.click(); return 'started'})()")
        log('run: ' + str(r))
        t0 = time.time(); terminal = None
        while time.time() - t0 < 150:
            await asyncio.sleep(3)
            _, v = await p.eval("(function(){var t=document.body.innerText.replace(/\\s+/g,' '); return JSON.stringify({ready:t.indexOf('상세 결과 준비 완료')!==-1, t1:t.indexOf('시장·차트 팀')!==-1, t2:t.indexOf('심리·환경 팀')!==-1, t3:t.indexOf('가치·기본 팀')!==-1})})()")
            s = json.loads(v) if v else {}
            if all(s.get(k) for k in ('ready', 't1', 't2', 't3')):
                terminal = round(time.time() - t0, 1)
                log(f'TERMINAL at +{terminal}s')
                break
        ev['runTerminalSec'] = terminal
        await asyncio.sleep(3)
        ev['preReenterRss'] = renderer_rss()
        log('pre-reenter RSS(MB): ' + str([(pid, rss//1024, cpu) for pid, rss, cpu in ev['preReenterRss']]))

    # 1) 신규 탭으로 /deepscan 재진입(완료된 런 이후)
    t2 = await new_tab(f'{BASE}/deepscan')
    ev['reenterTab'] = t2['id'][:10]
    log('REENTER tab opened: ' + t2['id'][:10])
    ws2 = t2['webSocketDebuggerUrl']
    samples = []
    async with websockets.connect(ws2, max_size=64*1024*1024) as ws:
        p2 = Page(ws)
        await p2.send('Page.enable'); await p2.send('Runtime.enable')
        for k in range(9):  # 90초
            await asyncio.sleep(10)
            dt, v = await p2.eval("location.pathname + ' | ' + document.body.innerText.replace(/\\s+/g,' ').slice(0,60)", timeout=8)
            rss = renderer_rss()
            rec = {'atSec': (k + 1) * 10, 'evalLatencyMs': dt, 'evalOk': v is not None, 'preview': (v or '')[:80], 'topRss': [(pid, rss_//1024, cpu) for pid, rss_, cpu in rss]}
            samples.append(rec)
            log(json.dumps(rec, ensure_ascii=False))
            if v is None and k >= 2 and all(not s['evalOk'] for s in samples[-3:]):
                log('WEDGE CONFIRMED — 3연속 평가 불응답')
                break
    ev['reenterSamples'] = samples
    out = '/home/pinion/livemolo/jaroo-mvp-v3/docs/tc/skeleton-evidence/reenter-wedge-repro.json'
    with open(out, 'w') as f:
        json.dump(ev, f, ensure_ascii=False, indent=2)
    log('evidence: ' + out)

asyncio.run(main())
