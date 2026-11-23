#!/usr/bin/env python3
"""TC-BBSC-007 확정 재현: 딥스캔 런 '진행 중' F5 새로고침 → 페이지 응답성·메모리 측정."""
import json, urllib.request, asyncio, time, os, subprocess

PORT = int(os.environ.get('BBS_CDP_PORT', '9232'))
BASE = 'https://jaroo-dev.up.railway.app'
AUTH = os.environ.get('BB_BASIC_AUTH')  # 필수: 하드코딩 금지 규칙

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
    out = subprocess.run(['ps', '-o', 'pid,rss,pcpu', '--no-headers', '-C', 'chrome'], capture_output=True, text=True).stdout
    rows = []
    for line in out.strip().split('\n'):
        f = line.split()
        if len(f) >= 3:
            try: rows.append((int(f[0]), int(f[1]), float(f[2])))
            except ValueError: pass
    rows.sort(key=lambda x: -x[1])
    return [(pid, rss // 1024, cpu) for pid, rss, cpu in rows[:3]]

def log(msg):
    print(f'[{time.strftime("%H:%M:%S")}] {msg}', flush=True)

async def main():
    import websockets
    ev = {'meta': {'startedAt': time.strftime('%Y-%m-%dT%H:%M:%S'), 'scenario': '딥스캔 런 진행 중(+8s) F5(Page.reload) — 순수 CDP, agent-browser 무개입'}}
    t = await new_tab(f'https://{AUTH}@{BASE}/login')
    async with websockets.connect(t['webSocketDebuggerUrl'], max_size=64*1024*1024) as ws:
        p = Page(ws)
        await p.send('Page.enable'); await p.send('Runtime.enable')
        async def nav(url, wait=3.0):
            i = await p.send('Page.navigate', {'url': url})
            await p.recv_result(i, 40)
            await asyncio.sleep(wait)
        await nav(f'{BASE}/login', 4)
        await p.eval("(function(){var c=document.querySelector('input[type=checkbox]'); if(c&&!c.checked){c.click()}})()")
        await asyncio.sleep(0.5)
        await p.eval("(function(){var b=Array.from(document.querySelectorAll('button')).find(function(x){return (x.innerText||'').indexOf('Google로 시작하기')!==-1}); if(b){b.dispatchEvent(new MouseEvent('click',{bubbles:true}))}})()")
        await asyncio.sleep(7)
        await nav(f'{BASE}/home', 3)
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
        await nav(f'{BASE}/home', 3)
        await p.eval("(function(){var b=Array.from(document.querySelectorAll('button')).find(function(x){return (x.innerText||'').includes('KOSPI')}); if(b){b.click()}})()")
        await asyncio.sleep(2)
        _, r = await p.eval("(function(){var b=Array.from(document.querySelectorAll('button,a')).find(function(x){return (x.innerText||'').indexOf('딥스캔 분석')!==-1}); if(!b) return 'nobtn'; b.click(); return 'started'})()")
        log('run: ' + str(r))
        await asyncio.sleep(8)
        _, s = await p.eval("document.body.innerText.replace(/\\s+/g,' ').slice(0,60)")
        log('pre-reload state: ' + str(s))
        ev['preReload'] = s
        # F5
        log('F5 — Page.reload (런 진행 중)')
        t0 = time.time()
        i = await p.send('Page.reload')
        rr = await p.recv_result(i, 15)
        ev['reloadAckSec'] = round(time.time() - t0, 1)
        log('reload ack: ' + str(ev['reloadAckSec']) + 's')
        samples = []
        for k in range(12):  # 120s
            await asyncio.sleep(10)
            dt, v = await p.eval("location.pathname + ' | ' + document.body.innerText.replace(/\\s+/g,' ').slice(0,60)", timeout=6)
            rec = {'atSec': (k + 1) * 10, 'evalLatencyMs': dt, 'evalOk': v is not None, 'preview': (v or '')[:70], 'topRssMb': top_rss()}
            samples.append(rec)
            log(json.dumps(rec, ensure_ascii=False))
        ev['samples'] = samples
        ok_ratio = sum(1 for s in samples if s['evalOk']) / len(samples)
        ev['verdict'] = 'WEDGE(평가 불응답 다수)' if ok_ratio < 0.5 else ('SLOW' if any(s['evalLatencyMs'] > 3000 for s in samples) else 'RESPONSIVE')
        log('VERDICT: ' + ev['verdict'])
    out = '/home/pinion/livemolo/jaroo-mvp-v3/docs/tc/skeleton-evidence/f5-midrun-wedge.json'
    with open(out, 'w') as f:
        json.dump(ev, f, ensure_ascii=False, indent=2)
    log('evidence: ' + out)

asyncio.run(main())
