from __future__ import annotations

import csv
import gzip
import html
import io
import json
import re
import urllib.request
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = ROOT / 'src/lib/data/instrument-universe.json'
SEC_URL = 'https://www.sec.gov/files/company_tickers.json'
KRX_URL = 'https://github.com/FinanceData/stock_master/raw/master/stock_master.csv.gz'
WISE_ETF_LOOKUP_URL = 'https://comp.wisereport.co.kr/ETF/lookup.aspx'
USER_AGENT = 'JarooMVP/4.0 contact@jaroo.app'

US_ALIAS_SEEDS = {
    'NVDA': ['엔비디아', 'nvidia'],
    'AAPL': ['애플', 'apple'],
    'MSFT': ['마이크로소프트', 'microsoft'],
    'AMZN': ['아마존', 'amazon'],
    'GOOGL': ['알파벳', '구글', 'alphabet', 'google'],
    'META': ['메타', '페이스북', 'meta', 'facebook'],
    'TSLA': ['테슬라', 'tesla'],
    'QQQ': ['인베스코 qqq', 'invesco qqq'],
    'SPY': ['spdr s&p 500', 'spy etf'],
}

KR_ALIAS_SEEDS_BY_CODE = {
    '005930': ['삼전'],
    '005380': ['현대차'],
    '005490': ['포스코홀딩스', '포스코 홀딩스', 'POSCO홀딩스', 'POSCO 홀딩스', 'posco holdings'],
    '035420': ['네이버', 'naver'],
    '003720': ['삼영'],
    '067160': ['아프리카TV', '아프리카티비', 'SOOP', '숲'],
    '148020': ['KBSTAR 200'],
    '100840': ['SNT에너지', 'SNT 에너지', 'LST에너지', 'LST 에너지', 'S&TC'],
    '152100': ['ARIRANG 200'],
    '323410': ['카뱅'],
    '373220': ['엘지에너지솔루션', 'lg에너지솔루션'],
}

KR_NAME_OVERRIDES_BY_CODE = {
    '067160': 'SOOP',
    '148020': 'KBSTAR 200',
    '100840': 'SNT에너지',
    '152100': 'ARIRANG 200',
}

KR_MANUAL_ENTRIES = [
    {
        'name': '카카오뱅크',
        'code': '323410',
        'market': 'KOSPI',
        'marketTone': 'kospi',
        'kind': 'stock',
        'locale': 'KR',
        'aliases': ['카뱅'],
    },
    {
        'name': 'LG에너지솔루션',
        'code': '373220',
        'market': 'KOSPI',
        'marketTone': 'kospi',
        'kind': 'stock',
        'locale': 'KR',
        'aliases': ['엘지에너지솔루션', 'lg에너지솔루션'],
    },
]

MANUAL_ENTRIES = [
    {
        'name': 'KODEX 200',
        'code': '069500',
        'market': 'ETF',
        'marketTone': 'etf',
        'kind': 'etf',
        'locale': 'KR',
        'aliases': ['kodex200', 'kodex 200'],
    },
    {
        'name': 'QQQ',
        'ticker': 'QQQ',
        'market': 'ETF',
        'marketTone': 'etf',
        'kind': 'etf',
        'locale': 'US',
        'aliases': ['invesco qqq', 'nasdaq 100 etf'],
    },
    {
        'name': 'SPY',
        'ticker': 'SPY',
        'market': 'ETF',
        'marketTone': 'etf',
        'kind': 'etf',
        'locale': 'US',
        'aliases': ['spdr s&p 500 etf', 's&p500 etf'],
    },
    *KR_MANUAL_ENTRIES,
]


def fetch_bytes(url: str) -> bytes:
    request = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def fetch_text(url: str) -> str:
    return fetch_bytes(url).decode('utf-8', 'ignore')


def post_form(url: str, form: dict[str, str], referer: str | None = None) -> str:
    encoded_form = urllib.parse.urlencode(form).encode('utf-8')
    headers = {'User-Agent': USER_AGENT}
    if referer:
        headers['Referer'] = referer

    request = urllib.request.Request(url, data=encoded_form, headers=headers)
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read().decode('utf-8', 'ignore')


def simplify_us_title(title: str) -> list[str]:
    cleaned = re.sub(r'\s+', ' ', title).strip()
    simplified = re.sub(
        r'\b(incorporated|inc|corporation|corp|co|company|holdings|holding|plc|limited|ltd|class\s+[a-z]|common\s+stock|ordinary\s+shares?)\b',
        '',
        cleaned,
        flags=re.IGNORECASE,
    )
    simplified = re.sub(r'\s+', ' ', simplified).strip(' .,-')

    variants = {cleaned}
    if simplified and simplified.lower() != cleaned.lower():
        variants.add(simplified)

    return [variant for variant in variants if variant]


def build_kr_aliases(name: str, code: str) -> list[str]:
    aliases = set(KR_ALIAS_SEEDS_BY_CODE.get(code, []))

    if name.startswith('SK'):
        aliases.add(name.removeprefix('SK').strip())

    if name.startswith('LG'):
        aliases.add(f'엘지{name.removeprefix("LG")}')
        aliases.add(name.lower())

    if ' ' in name:
        aliases.add(name.replace(' ', ''))

    if name.endswith('자동차'):
        aliases.add(f'{name.removesuffix("자동차")}차')

    return sorted(alias for alias in aliases if alias and alias != name)


def parse_wisereport_lookup_rows(html_text: str) -> list[tuple[str, str, str]]:
    return [
        (
            html.unescape(kind).strip(),
            html.unescape(code).strip(),
            html.unescape(title or anchor_name).strip(),
        )
        for row in re.findall(
            r'<tr>\s*<td class="c1 center">([^<]+)</td>\s*<td class="c2 center"><a [^>]*>([^<]+)</a></td>\s*<td class="c3 txt"[^>]*title="([^"]*)"[^>]*><a [^>]*>([^<]*)</a></td>\s*</tr>',
            html_text,
            re.S,
        )
        for kind, code, title, anchor_name in [row]
    ]


def build_kr_entries() -> list[dict[str, object]]:
    raw = fetch_bytes(KRX_URL)
    with gzip.GzipFile(fileobj=io.BytesIO(raw)) as gz:
        text = gz.read().decode('utf-8')

    reader = csv.DictReader(io.StringIO(text))
    entries: list[dict[str, object]] = []

    for row in reader:
        symbol = str(row.get('Symbol') or '').strip()
        raw_name = str(row.get('Name') or '').strip()
        market = str(row.get('Market') or '').strip().upper()

        if not symbol or not raw_name or market not in {'KOSPI', 'KOSDAQ', 'KONEX'}:
            continue

        code = symbol.zfill(6)
        name = KR_NAME_OVERRIDES_BY_CODE.get(code, raw_name)
        entries.append(
            {
                'name': name,
                'code': code,
                'market': market,
                'marketTone': 'kosdaq' if market == 'KOSDAQ' else 'kospi',
                'kind': 'stock',
                'locale': 'KR',
                'aliases': build_kr_aliases(name, code),
            }
        )

    return entries


def build_kr_exchange_product_entries(product_type: str, cmp_typ: str) -> list[dict[str, object]]:
    lookup_html = fetch_text(WISE_ETF_LOOKUP_URL)
    view_state_match = re.search(r'id="__VIEWSTATE" value="([^"]+)"', lookup_html)
    view_state_generator_match = re.search(r'id="__VIEWSTATEGENERATOR" value="([^"]+)"', lookup_html)

    if not view_state_match or not view_state_generator_match:
        raise RuntimeError('Failed to locate WiseReport ETF lookup form state.')

    lookup_result_html = post_form(
        WISE_ETF_LOOKUP_URL,
        {
            '__VIEWSTATE': view_state_match.group(1),
            '__VIEWSTATEGENERATOR': view_state_generator_match.group(1),
            'cmp_typ': cmp_typ,
            'ord_col': '',
            'ord_typ': '',
            'index': '0',
        },
        referer=WISE_ETF_LOOKUP_URL,
    )

    rows = parse_wisereport_lookup_rows(lookup_result_html)
    entries: list[dict[str, object]] = []

    for kind, code, raw_name in rows:
        if kind.upper() != product_type.upper():
            continue

        normalized_code = code.strip().upper()
        name = KR_NAME_OVERRIDES_BY_CODE.get(normalized_code, raw_name.strip())

        if not normalized_code or not name:
            continue

        entries.append(
            {
                'name': name,
                'code': normalized_code,
                'market': product_type.upper(),
                'marketTone': 'etf',
                'kind': 'etf',
                'locale': 'KR',
                'aliases': build_kr_aliases(name, normalized_code),
            }
        )

    return entries


def build_us_entries() -> list[dict[str, object]]:
    raw = fetch_bytes(SEC_URL)
    data = json.loads(raw.decode('utf-8'))
    entries: list[dict[str, object]] = []

    for item in data.values():
        ticker = str(item.get('ticker') or '').strip().upper()
        title = str(item.get('title') or '').strip()
        if not ticker or not title:
            continue

        aliases = set(simplify_us_title(title))
        aliases.update(US_ALIAS_SEEDS.get(ticker, []))
        aliases.discard(title)

        entries.append(
            {
                'name': title,
                'ticker': ticker,
                'market': 'US',
                'marketTone': 'nasdaq',
                'kind': 'stock',
                'locale': 'US',
                'aliases': sorted(alias for alias in aliases if alias),
            }
        )

    return entries


def dedupe_entries(entries: list[dict[str, object]]) -> list[dict[str, object]]:
    deduped: dict[str, dict[str, object]] = {}

    for entry in entries:
        code = str(entry.get('code') or '')
        ticker = str(entry.get('ticker') or '')
        key = code or ticker or str(entry['name'])

        if key in deduped:
            existing_aliases = set(deduped[key].get('aliases') or [])
            existing_aliases.update(entry.get('aliases') or [])
            deduped[key]['aliases'] = sorted(existing_aliases)
            continue

        deduped[key] = entry

    return list(deduped.values())


def main() -> None:
    kr_entries = build_kr_entries()
    kr_etf_entries = build_kr_exchange_product_entries('ETF', '5')
    kr_etn_entries = build_kr_exchange_product_entries('ETN', '25')
    us_entries = build_us_entries()
    universe = dedupe_entries([*kr_entries, *kr_etf_entries, *kr_etn_entries, *us_entries, *MANUAL_ENTRIES])
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(universe, ensure_ascii=False), encoding='utf-8')
    print(
        json.dumps(
            {
                'output': str(OUTPUT_PATH),
                'totalCount': len(universe),
                'krCount': len([entry for entry in universe if entry.get('locale') == 'KR']),
                'krEtfCount': len([entry for entry in universe if entry.get('locale') == 'KR' and entry.get('market') == 'ETF']),
                'krEtnCount': len([entry for entry in universe if entry.get('locale') == 'KR' and entry.get('market') == 'ETN']),
                'usCount': len([entry for entry in universe if entry.get('locale') == 'US']),
            },
            ensure_ascii=False,
        )
    )


if __name__ == '__main__':
    main()
