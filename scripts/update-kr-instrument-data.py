from __future__ import annotations

import html
import json
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
KR_STOCK_JSON_PATH = ROOT / 'packages/instrument-core/data/kr/kr-stock-name-to-code.json'
KR_STOCK_TXT_PATH = ROOT / 'packages/instrument-core/data/kr/kr-stock-name-to-code.txt'
INSTRUMENT_UNIVERSE_PATH = ROOT / 'src/lib/data/instrument-universe.json'
MANIFEST_PATH = ROOT / 'packages/instrument-core/manifest.json'

KRX_KIND_LIST_URL = 'https://kind.krx.co.kr/corpgeneral/corpList.do?method=download&searchType=13'
USER_AGENT = 'JarooMVP/4.0 contact@jaroo.app'

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

KR_KIND_MARKET_MAP = {
    '유가': 'KOSPI',
    '코스피': 'KOSPI',
    '코스닥': 'KOSDAQ',
    '코넥스': 'KONEX',
}


def fetch_kind_html() -> str:
    request = urllib.request.Request(KRX_KIND_LIST_URL, headers={'User-Agent': USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read().decode('euc-kr', 'ignore')


def strip_html_cell(value: str) -> str:
    without_tags = re.sub(r'<[^>]+>', '', value)
    return html.unescape(without_tags).replace('\xa0', ' ').strip()


def parse_krx_kind_listing_rows(html_text: str) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    headers: list[str] = []

    for raw_row in re.findall(r'<tr[^>]*>(.*?)</tr>', html_text, re.S | re.I):
        cells = [
            strip_html_cell(cell)
            for cell in re.findall(r'<t[dh][^>]*>(.*?)</t[dh]>', raw_row, re.S | re.I)
        ]

        if not cells:
            continue

        if not headers:
            headers = cells
            continue

        if len(cells) < len(headers):
            continue

        rows.append(dict(zip(headers, cells)))

    return rows


def build_kr_aliases(name: str, code: str, existing_aliases: list[str] | None = None) -> list[str]:
    aliases = set(existing_aliases or [])
    aliases.update(KR_ALIAS_SEEDS_BY_CODE.get(code, []))

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


def load_json(path: Path):
    return json.loads(path.read_text(encoding='utf-8'))


def normalize_code(raw_code: str) -> str:
    code = raw_code.strip().upper()
    return code.zfill(6) if code.isdigit() else code


def build_current_kr_stock_entries(existing_universe: list[dict[str, object]]) -> list[dict[str, object]]:
    rows = parse_krx_kind_listing_rows(fetch_kind_html())
    existing_aliases_by_code: dict[str, set[str]] = {}

    for entry in existing_universe:
        if entry.get('locale') != 'KR' or entry.get('kind') != 'stock':
            continue

        code = str(entry.get('code') or '').strip().upper()
        if not code:
            continue

        aliases = existing_aliases_by_code.setdefault(code, set())
        for alias in entry.get('aliases') or []:
            if isinstance(alias, str) and alias.strip():
                aliases.add(alias.strip())

    entries: list[dict[str, object]] = []
    seen_codes: set[str] = set()

    for row in rows:
        market = KR_KIND_MARKET_MAP.get(str(row.get('시장구분') or '').strip())
        raw_name = str(row.get('회사명') or '').strip()
        code = normalize_code(str(row.get('종목코드') or ''))

        if not market or market not in {'KOSPI', 'KOSDAQ', 'KONEX'} or not raw_name or not code:
            continue

        if code in seen_codes:
            continue

        seen_codes.add(code)
        name = KR_NAME_OVERRIDES_BY_CODE.get(code, raw_name)
        entries.append(
            {
                'name': name,
                'code': code,
                'market': market,
                'marketTone': 'kosdaq' if market == 'KOSDAQ' else 'kospi',
                'kind': 'stock',
                'locale': 'KR',
                'aliases': build_kr_aliases(name, code, sorted(existing_aliases_by_code.get(code, set()))),
            }
        )

    return entries


def write_kr_stock_map(entries: list[dict[str, object]]) -> dict[str, str]:
    name_to_code = load_json(KR_STOCK_JSON_PATH)

    for entry in entries:
        name_to_code[str(entry['name'])] = str(entry['code'])

    name_to_code = dict(sorted(name_to_code.items()))

    KR_STOCK_JSON_PATH.write_text(
        json.dumps(name_to_code, ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8',
    )
    KR_STOCK_TXT_PATH.write_text(
        ''.join(f'{name} : {code}\n' for name, code in name_to_code.items()),
        encoding='utf-8',
    )
    return name_to_code


def write_instrument_universe(entries: list[dict[str, object]]) -> list[dict[str, object]]:
    existing_universe = load_json(INSTRUMENT_UNIVERSE_PATH)
    index_by_code = {
        str(entry.get('code') or '').strip().upper(): entry
        for entry in existing_universe
        if entry.get('locale') == 'KR' and entry.get('kind') == 'stock' and entry.get('code')
    }

    appended_entries: list[dict[str, object]] = []

    for entry in entries:
        code = str(entry.get('code') or '').strip().upper()
        existing_entry = index_by_code.get(code)

        if not existing_entry:
            appended_entries.append(entry)
            index_by_code[code] = entry
            continue

        # Supplement existing rows instead of replacing them: keep historical/manual
        # canonical names stable, but make the current KRX/KIND name searchable.
        existing_aliases = {
            alias.strip()
            for alias in existing_entry.get('aliases') or []
            if isinstance(alias, str) and alias.strip()
        }
        current_aliases = {
            alias.strip()
            for alias in entry.get('aliases') or []
            if isinstance(alias, str) and alias.strip()
        }
        current_name = str(entry.get('name') or '').strip()
        existing_name = str(existing_entry.get('name') or '').strip()

        if current_name and current_name != existing_name:
            current_aliases.add(current_name)

        merged_aliases = sorted(alias for alias in existing_aliases | current_aliases if alias != existing_name)
        existing_entry['aliases'] = merged_aliases
        existing_entry['market'] = entry['market']
        existing_entry['marketTone'] = entry['marketTone']

    universe = [*existing_universe, *appended_entries]
    INSTRUMENT_UNIVERSE_PATH.write_text(json.dumps(universe, ensure_ascii=False), encoding='utf-8')
    return universe


def update_manifest() -> None:
    manifest = load_json(MANIFEST_PATH)
    files = manifest.setdefault('files', {})

    for file_path in sorted((ROOT / 'packages/instrument-core/data').glob('**/*')):
        if not file_path.is_file():
            continue

        relative_path = file_path.relative_to(ROOT / 'packages/instrument-core').as_posix()
        files[relative_path] = file_path.stat().st_size

    MANIFEST_PATH.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def main() -> None:
    existing_universe = load_json(INSTRUMENT_UNIVERSE_PATH)
    kr_entries = build_current_kr_stock_entries(existing_universe)
    name_to_code = write_kr_stock_map(kr_entries)
    universe = write_instrument_universe(kr_entries)
    update_manifest()

    market_counts: dict[str, int] = {}
    for entry in kr_entries:
        market = str(entry['market'])
        market_counts[market] = market_counts.get(market, 0) + 1

    print(
        json.dumps(
            {
                'source': KRX_KIND_LIST_URL,
                'krStockMapCount': len(name_to_code),
                'krStockMarketCounts': market_counts,
                'instrumentUniverseCount': len(universe),
                'hpsp': name_to_code.get('HPSP'),
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == '__main__':
    main()
