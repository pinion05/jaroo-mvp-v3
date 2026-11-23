import json, re, urllib.parse, datetime

REPO = '/home/pinion/jaroo-mvp-v3-ui'
OUT = '/home/pinion/blog/public/ai-trader/draft5-snapshot.html'

# 1. CSS — Pretendard @font-face 제거 (CDN으로 대체)
css = open('/tmp/draft5-page.css').read()
def strip_pretendard(m):
    block = m.group(0)
    return '' if 'Pretendard' in block else block
css = re.sub(r'@font-face\{[^}]*\}', strip_pretendard, css)

# 2. 캡처 디코딩
def decode(path):
    raw = open(path).read().strip()
    m = re.search(r'CAP_START(.*?)CAP_END', raw, re.S)
    if not m: raise SystemExit(f'CAP_START 없음: {path}')
    return urllib.parse.unquote(m.group(1))

caps = {k: decode(f'/tmp/cap-{k}.txt') for k in ['sosim', 'doljin', 'baedang']}

# 3. 라이브 스탬프
live = json.load(open(f'{REPO}/public/ai-trader/draft5-live.json'))
def kst(iso):
    try: return datetime.datetime.fromisoformat(iso).strftime('%m/%d %H:%M')
    except: return iso
stamp = f"발굴 {kst(live['generatedAt'])} · 딥스캔 {kst(live.get('deepscanFetchedAt') or live['generatedAt'])} KST"
n_ds = len(live.get('deepscans', []))
n_articles = live.get('articleCount', 50)

chars = [
    ('sosim', 'sosim', '🐰', '소심이', '안정형 · 여행자금'),
    ('doljin', 'doljin', '🐂', '돌진이', '공격형 · 대학생'),
    ('baedang', 'baedang', '🐔', '배당콕', '배당 선호 · 퇴직 준비'),
]
tabs_html = '\n'.join(
    f'      <button type="button" data-target="{cid}"{" class=\"active\"" if i == 0 else ""}>{emoji} {name}<span class="snap-tab-sub">{sub}</span></button>'
    for i, (cid, _, emoji, name, sub) in enumerate(chars))
frames_html = '\n'.join(
    f'    <section id="{cid}" class="snap-frame"{" hidden" if i else ""}>\n{caps[key]}\n    </section>'
    for i, (cid, key, _, _, _) in enumerate(chars))

html = f'''<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI 트레이더 투자일기 — jaroo 실데모 스냅샷</title>
<meta name="description" content="jaroo AI 트레이더 — 네이버 메인뉴스를 성향대로 읽어 종목을 발굴하고, deepscan 리포트가 성향 문턱을 통과해야 매수합니다. 실데이터 스냅샷.">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<style>{css}</style>
<style>
  html, body {{ height: auto !important; overflow: visible !important; background: #e9ebef; }}
  * {{ max-height: none !important; }}
  .snap-header {{ position: sticky; top: 0; z-index: 100; background: #101322; color: #fff; padding: 10px 14px 12px; }}
  .snap-title {{ font-size: 15px; font-weight: 800; letter-spacing: -0.01em; }}
  .snap-title span {{ font-size: 10px; font-weight: 600; color: #93f0b8; margin-left: 8px; vertical-align: 2px; }}
  .snap-meta {{ font-size: 10px; color: rgba(255,255,255,.55); margin-top: 3px; font-variant-numeric: tabular-nums; }}
  .snap-tabs {{ display: flex; gap: 6px; margin-top: 9px; }}
  .snap-tabs button {{ flex: 1; border: 1px solid rgba(255,255,255,.16); background: rgba(255,255,255,.06); color: rgba(255,255,255,.75); border-radius: 10px; padding: 7px 4px 6px; font-size: 12px; font-weight: 700; font-family: Pretendard, sans-serif; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 2px; }}
  .snap-tabs button.active {{ background: #fff; color: #101322; border-color: #fff; }}
  .snap-tab-sub {{ font-size: 9px; font-weight: 500; opacity: .65; }}
  .snap-stage {{ max-width: 480px; margin: 0 auto; padding: 14px 10px 60px; }}
  .snap-frame {{ background: #fff; border-radius: 18px; overflow: hidden; box-shadow: 0 2px 14px rgba(16,19,34,.08); }}
  .snap-frame[hidden] {{ display: none; }}
  /* 앱 셸 고정 레이아웃 해제 — 정적 문서 흐름으로 */
  .snap-frame [class*="h-dvh"] {{ height: auto !important; min-height: 0 !important; }}
  .snap-frame .fixed, .snap-frame .sticky {{ position: static !important; }}
  .snap-frame [class*="overflow-hidden"], .snap-frame [class*="overflow-y-auto"] {{ overflow: visible !important; }}
  .snap-frame details summary {{ cursor: pointer; }}
</style>
</head>
<body>
  <header class="snap-header">
    <div class="snap-title">AI 트레이더 투자일기<span>실시간 발굴 스냅샷</span></div>
    <div class="snap-meta">{stamp} · 네이버 메인뉴스 {n_articles}건 · 딥스캔 {n_ds}종목 판정 · jaroo 실데이터 (pinion.kr 정적 스냅샷)</div>
    <nav class="snap-tabs" aria-label="캐릭터 전환">
{tabs_html}
    </nav>
  </header>
  <main class="snap-stage">
{frames_html}
  </main>
  <script>
    (function () {{
      var buttons = document.querySelectorAll('.snap-tabs button');
      buttons.forEach(function (btn) {{
        btn.addEventListener('click', function () {{
          document.querySelectorAll('.snap-frame').forEach(function (f) {{ f.hidden = f.id !== btn.dataset.target; }});
          buttons.forEach(function (b) {{ b.classList.toggle('active', b === btn); }});
          window.scrollTo({{ top: 0, behavior: 'smooth' }});
        }});
      }});
    }});
  </script>
</body>
</html>
'''
open(OUT, 'w').write(html)
print('written:', OUT, f'{len(html)/1024:.0f}KB')
