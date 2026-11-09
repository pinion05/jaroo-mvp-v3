#!/usr/bin/env python3
"""순수 CDP 이탈·재진입(TC-BBSC-007) — agent-browser 배제.
딥스캔 런 중 ①홈으로 이탈→재진입(navigate) ②F5 새로고침 두 경로 관찰."""
import json, urllib.request, asyncio, sys, time, os

PORT = 9231
BASE = 'https://jaroo-dev.up.railway.app'

def http_json(path, method='GET'):
    req = urllib.request.Request(f'http://127.0.0.1:{PORT}{path}', method=method)
    with urllib.request.urlopen(req) as r:
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
    async def eval(self, expr, timeout=25):
        i = await self.send('Runtime.evaluate', {'expression': expr, 'returnByValue': True, 'awaitPromise': True})
        r = await self.recv_result(i, timeout)
        if r and 'result' in r:
            return r['result'].get('value')
        return None

def state_expr():
    return ("(function(){var t=document.body.innerText.replace(/\\s+/g,' ');"
            "var m=t.match(/분석가 응답을 기다리는 중… \\d{1,3}:\\d{2}/);"
            "return JSON.stringify({u:location.pathname, tmr:m?m[0].slice(-5):'',"
            "wait:t.indexOf('분석가 응답을 기다리는 중')!==-1,"
            "ready:t.indexOf('상세 결과 준비 완료')!==-1, empty:t.indexOf('분석할 종목이 없습니다')!==-1,"
            "err:t.indexOf('불러오지 못했어요')!==-1||t.indexOf('다시 시도해주세요')!==-1,"
            "teams:(t.match(/요약 완료/g)||[]).length,"
            "t1:t.indexOf('시장·차트 팀')!==-1,t2:t.indexOf('심리·환경 팀')!==-1,t3:t.indexOf('가치·기본 팀')!==-1,"
            "txt:t.slice(0,120)})})()")

async def main():
    import websockets
    t = await new_tab('about:blank')
    ws_url = t['webSocketDebuggerUrl']
    target_id = t['id']
    async with websockets.connect(ws_url, max_size=64*1024*1024) as ws:
        p = Page(ws)
        await p.send('Page.enable'); await p.send('Runtime.enable')
        async def nav(url, wait=3.0):
            i = await p.send('Page.navigate', {'url': url})
            await p.recv_result(i, 30)
            await asyncio.sleep(wait)
        def alive():
            return any(x['id'] == target_id for x in pages())
        def log(msg):
            print(f'[{time.strftime("%H:%M:%S")}] {msg}', flush=True)
        async def state():
            v = await p.eval(state_expr())
            return json.loads(v) if v else {}

        # 준비: 로그인 → 종목 → 런 시작
        await nav(f'{BASE}/login', 4)
        await p.eval("(function(){var c=document.querySelector('input[type=checkbox]'); if(c&&!c.checked){c.click()}})()")
        await asyncio.sleep(0.5)
        await p.eval("(function(){var b=Array.from(document.querySelectorAll('button')).find(function(x){return (x.innerText||'').indexOf('Google로 시작하기')!==-1}); if(b){b.dispatchEvent(new MouseEvent('click',{bubbles:true}))}})()")
        await asyncio.sleep(7)
        await nav(f'{BASE}/home', 3)
        me = await p.eval("fetch('/api/auth/me').then(function(r){return r.text()}).then(function(t){return t.slice(0,40)})")
        log('auth: ' + str(me))
        st = await p.eval("(function(){return /포트폴리오 준비/.test(document.body.innerText)?'empty':'has'})()")
        if st == 'empty':
            await nav(f'{BASE}/screenshot', 3)
            i = await p.send('DOM.getDocument'); doc = await p.recv_result(i, 20)
            i = await p.send('DOM.querySelector', {'nodeId': doc['root']['nodeId'], 'selector': 'input[type=file]'})
            qr = await p.recv_result(i, 20)
            i = await p.send('DOM.setFileInputFiles', {'files': ['/tmp/bbsc/synthetic-portfolio.png'], 'nodeId': qr.get('nodeId', 0)})
            await p.recv_result(i, 20)
            for k in range(20):
                await asyncio.sleep(2.5)
                r = await p.eval("(function(){var t=document.body.innerText; var m=t.match(/(\\d+)개 종목 인식/); if(!m) return 'wait'; var b=Array.from(document.querySelectorAll('button')).find(function(x){return x.innerText.includes('적용하기')}); if(b){b.click(); return 'applied'} return 'nobtn'})()")
                if r and r != 'wait': break
            await asyncio.sleep(5)
        await nav(f'{BASE}/home', 3)
        await p.eval("(function(){var b=Array.from(document.querySelectorAll('button')).find(function(x){return (x.innerText||'').includes('KOSPI')}); if(b){b.click()}})()")
        await asyncio.sleep(2)
        r = await p.eval("(function(){var b=Array.from(document.querySelectorAll('button,a')).find(function(x){return (x.innerText||'').indexOf('딥스캔 분석')!==-1}); if(!b) return 'nobtn'; b.click(); return 'started'})()")
        log('run: ' + str(r))

        # ===== 경로 A: 런 중 홈 이탈 → /deepscan 재진입 =====
        await asyncio.sleep(5)
        s = await state(); log(f'A0 run+5s: {json.dumps(s, ensure_ascii=False)[:160]}')
        await nav(f'{BASE}/home', 3)
        s = await state(); log(f'A1 left(home): u={s.get("u")} err={s.get("err")}')
        await nav(f'{BASE}/deepscan', 4)
        for k in range(12):
            s = await state()
            log(f'A2 reenter +{k}: u={s.get("u")} wait={s.get("wait")} ready={s.get("ready")} empty={s.get("empty")} err={s.get("err")} teams={s.get("teams")} tmr={s.get("tmr")}')
            if s.get('ready') or s.get('empty') or s.get('err'): break
            await asyncio.sleep(2)
        # 재진입 후 종결 도달 여부(최대 90s)
        t0 = time.time(); reached = False
        while time.time() - t0 < 90:
            await asyncio.sleep(3)
            if not alive(): log('!! TAB DIED after reenter'); return
            s = await state()
            if s.get('ready') and s.get('t1') and s.get('t2') and s.get('t3'):
                log(f'A3 reenter TERMINAL at +{time.time()-t0:.0f}s after reenter — teams={s.get("teams")}')
                reached = True; break
            if s.get('empty'):
                log('A3 reenter shows EMPTY STATE (run not resumable via URL)'); break
        if not reached and not s.get('empty'):
            log(f'A3 no terminal in 90s — last: {json.dumps(s, ensure_ascii=False)[:140]}')

        # ===== 경로 B: 결과 상태에서 F5 새로고침 =====
        await asyncio.sleep(2)
        log('B: F5 reload on /deepscan')
        i = await p.send('Page.reload'); await p.recv_result(i, 40)
        await asyncio.sleep(5)
        for k in range(10):
            if not alive(): log('!! TAB DIED after reload'); return
            s = await state()
            if s:
                log(f'B+{k}: u={s.get("u")} wait={s.get("wait")} ready={s.get("ready")} empty={s.get("empty")} err={s.get("err")} teams={s.get("teams")}')
                break
            await asyncio.sleep(2)
        me2 = await p.eval("fetch('/api/auth/me').then(function(r){return r.text()}).then(function(t){return t.slice(0,40)})")
        log('B post-auth: ' + str(me2))
        log('DONE — tab alive: ' + str(alive()))

asyncio.run(main())
