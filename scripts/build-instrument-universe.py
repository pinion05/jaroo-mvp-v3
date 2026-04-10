from __future__ import annotations

import csv
import gzip
import io
import json
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = ROOT / 'src/lib/data/instrument-universe.json'
SEC_URL = 'https://www.sec.gov/files/company_tickers.json'
KRX_URL = 'https://github.com/FinanceData/stock_master/raw/master/stock_master.csv.gz'
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
]


def fetch_bytes(url: str) -> bytes:
    request = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


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


def build_kr_entries() -> list[dict[str, object]]:
    raw = fetch_bytes(KRX_URL)
    with gzip.GzipFile(fileobj=io.BytesIO(raw)) as gz:
        text = gz.read().decode('utf-8')

    reader = csv.DictReader(io.StringIO(text))
    entries: list[dict[str, object]] = []

    for row in reader:
        symbol = str(row.get('Symbol') or '').strip()
        name = str(row.get('Name') or '').strip()
        market = str(row.get('Market') or '').strip().upper()

        if not symbol or not name or market not in {'KOSPI', 'KOSDAQ', 'KONEX'}:
            continue

        code = symbol.zfill(6)
        aliases = []
        if name.startswith('SK'):
            aliases.append(name.removeprefix('SK').strip())
        if ' ' in name:
            aliases.append(name.replace(' ', ''))

        entries.append(
            {
                'name': name,
                'code': code,
                'market': market,
                'marketTone': 'kosdaq' if market == 'KOSDAQ' else 'kospi',
                'kind': 'stock',
                'locale': 'KR',
                'aliases': sorted({alias for alias in aliases if alias and alias != name}),
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
    us_entries = build_us_entries()
    universe = dedupe_entries([*kr_entries, *us_entries, *MANUAL_ENTRIES])
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(universe, ensure_ascii=False), encoding='utf-8')
    print(
        json.dumps(
            {
                'output': str(OUTPUT_PATH),
                'totalCount': len(universe),
                'krCount': len([entry for entry in universe if entry.get('locale') == 'KR']),
                'usCount': len([entry for entry in universe if entry.get('locale') == 'US']),
            },
            ensure_ascii=False,
        )
    )


if __name__ == '__main__':
    main()
