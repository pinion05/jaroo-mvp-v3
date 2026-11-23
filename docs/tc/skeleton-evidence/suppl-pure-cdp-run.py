#!/usr/bin/env python3
"""순수 CDP 딥스캔 런 관찰 — agent-browser 완전 배제.
탭 생존·런 타임라인·세션 상태를 기록한다."""
import json, urllib.request, asyncio, sys, time, os

PORT = 9231
AUTH = os.environ.get('BB_BASIC_AUTH', '')
BASE = 'https://jaroo-dev.up.railway.app'

def http_json(path, method='GET'):
    req = urllib.request.Request(f'http://127.0.0.1:{PORT}{path}', method=method)
    with urllib.request.urlopen(req) as r:
        return json.load(r)

def pages():
    return [t for t in http_json('/json/list') if t['type'] == 'page']

async def new_tab(url):
    t = http_json(f'/json/new?{url}', method='PUT')
    return t

class Page:
    def __init__(self, ws):
        self.ws = ws; self.id = 0
    async def send(self, method, params=None):
        self.id += 1
        await self.ws.send(json.dumps({'id': self.id, 'method': method, 'params': params or {}}))
        return self.id
    async def recv_result(self, want_id, timeout=20):
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
    async def eval(self, expr, timeout=20):
        i = await self.send('Runtime.evaluate', {'expression': expr, 'returnByValue': True, 'awaitPromise': True})
        r = await self.recv_result(i, timeout)
        if r and 'result' in r:
            return r['result'].get('value')
        return None

async def main():
    import websockets
    # 기존 탭 정리 대신 새 탭 생성
    t = await new_tab('about:blank')
    ws_url = t['webSocketDebuggerUrl']
    target_id = t['id']
    print('TAB', target_id[:10])
    async with websockets.connect(ws_url, max_size=64*1024*1024) as ws:
        p = Page(ws)
        await p.send('Page.enable')
        await p.send('Runtime.enable')
        async def nav(url, wait=3.0):
            i = await p.send('Page.navigate', {'url': url})
            await p.recv_result(i, 30)
            await asyncio.sleep(wait)
        def alive():
            return any(x['id'] == target_id for x in pages())
        def log(msg):
            print(f'[{time.strftime("%H:%M:%S")}] {msg}', flush=True)

        # 1) Basic Auth 캐시된 클린 URL 로그인 페이지
        await nav(f'{BASE}/login', 4)
        log('login page: ' + str(await p.eval('location.pathname')))
        # 2) 동의 체크 + Google 자동로그인
        await p.eval("(function(){var c=document.querySelector('input[type=checkbox]'); if(c&&!c.checked){c.click()} return 'chk:'+(c?c.checked:'none')})()")
        await asyncio.sleep(0.5)
        r = await p.eval("(function(){var b=Array.from(document.querySelectorAll('button')).find(function(x){return (x.innerText||'').indexOf('Google로 시작하기')!==-1}); if(b){b.dispatchEvent(new MouseEvent('click',{bubbles:true})); return 'dispatched'} return 'nobutton'})()")
        log('google click: ' + str(r))
        await asyncio.sleep(7)
        # 3) 클린 오리진 홈에서 인증 확인
        await nav(f'{BASE}/home', 3)
        me = await p.eval("fetch('/api/auth/me').then(function(r){return r.text()}).then(function(t){return t.slice(0,50)})")
        log('auth: ' + str(me))
        if not me or 'authenticated' not in json.dumps(me):
            log('LOGIN FAILED'); return
        # 4) 종목 확인/업로드
        st = await p.eval("(function(){return /포트폴리오 준비/.test(document.body.innerText)?'empty':'has'})()")
        log('stock: ' + str(st))
        if st == 'empty':
            await nav(f'{BASE}/screenshot', 3)
            # 파일입력 노드에 파일 지정
            i = await p.send('DOM.getDocument')
            doc = await p.recv_result(i, 20)
            root_id = doc['root']['nodeId']
            i = await p.send('DOM.querySelector', {'nodeId': root_id, 'selector': 'input[type=file]'})
            qr = await p.recv_result(i, 20)
            node_id = qr.get('nodeId', 0)
            i = await p.send('DOM.setFileInputFiles', {'files': ['/tmp/bbsc/synthetic-portfolio.png'], 'nodeId': node_id})
            await p.recv_result(i, 20)
            log('file set')
            for k in range(20):
                await asyncio.sleep(2.5)
                if not alive(): log('!! TAB DIED during OCR'); return
                r = await p.eval("(function(){var t=document.body.innerText; var m=t.match(/(\\d+)개 종목 인식/); if(!m) return 'wait'; var b=Array.from(document.querySelectorAll('button')).find(function(x){return x.innerText.includes('적용하기')}); if(b){b.click(); return 'applied'} return 'nobtn'})()")
                if r and r != 'wait':
                    log('ocr: ' + str(r)); break
            await asyncio.sleep(5)
        # 5) 홈 → 카드 → 딥스캔
        await nav(f'{BASE}/home', 3)
        r = await p.eval("(function(){var btns=Array.from(document.querySelectorAll('button')); var card=btns.find(function(b){return (b.innerText||'').includes('KOSPI')}); if(!card) return 'nocard'; card.click(); return 'card'})()")
        log('card: ' + str(r))
        await asyncio.sleep(2)
        r = await p.eval("(function(){var b=Array.from(document.querySelectorAll('button,a')).find(function(x){return (x.innerText||'').indexOf('딥스캔 분석')!==-1}); if(!b) return 'nobtn'; b.click(); return 'started'})()")
        log('deepscan: ' + str(r))
        # 6) 런 관찰 — 탭 생존 + 상태 1s 폴링
        t0 = time.time()
        last = None
        while time.time() - t0 < 180:
            await asyncio.sleep(1.0)
            if not alive():
                log(f'!! TAB DIED at +{time.time()-t0:.1f}s into run')
                log('   pages now: ' + str([x['url'][:60] for x in pages()]))
                return
            st = await p.eval("(function(){var t=document.body.innerText.replace(/\\s+/g,' '); var m=t.match(/분석가 응답을 기다리는 중… \\d{1,3}:\\d{2}/); return JSON.stringify({u:location.pathname, tmr:m?m[0].slice(-5):'', ready:t.indexOf('상세 결과 준비 완료')!==-1, teams:(t.match(/팀 요약 완료|요약 완료/g)||[]).length, t1:t.indexOf('시장·차트 팀')!==-1, t2:t.indexOf('심리·환경 팀')!==-1, t3:t.indexOf('가치·기본 팀')!==-1})})()")
            if st != last:
                log(f'+{time.time()-t0:6.1f}s {st}')
                last = st
            v = json.loads(st) if st else {}
            if v.get('ready') and v.get('t1') and v.get('t2') and v.get('t3'):
                log(f'RUN TERMINAL at +{time.time()-t0:.1f}s')
                # 종결 후 20초 생존 관찰
                for k in range(20):
                    await asyncio.sleep(1.0)
                    if not alive():
                        log(f'!! TAB DIED post-terminal at +{k}s'); return
                log('TAB SURVIVED post-terminal 20s')
                me2 = await p.eval("fetch('/api/auth/me').then(function(r){return r.text()}).then(function(t){return t.slice(0,50)})")
                log('post-auth: ' + str(me2))
                return
        log('observation window ended')

asyncio.run(main())
