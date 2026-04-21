#!/usr/bin/env python3
import argparse
import json
import pathlib
import re
import sys
from datetime import datetime, timezone
from urllib.request import Request, urlopen

BASE_URL = 'http://127.0.0.1:3040'


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument('tickers', nargs='*', default=['NVDA'])
    parser.add_argument('--runtime-input-file')
    return parser.parse_args()


def now_stamp():
    return datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')


def canonical_json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def fetch_json(path: str):
    req = Request(f'{BASE_URL}{path}', headers={'Accept': 'application/json'})
    with urlopen(req, timeout=60) as response:
        return json.loads(response.read().decode('utf-8'))


def row_index(rows, label):
    for idx, row in enumerate(rows or []):
        if isinstance(row, dict) and row.get('label') == label:
            return idx, row
    return None, None


def debug_source(alias, raw_file, request_path, selector, snapshot_generated_at=None, note=None):
    out = {
        'sourceAlias': alias,
        'rawFile': raw_file,
        'requestPath': request_path,
        'selector': selector,
    }
    if snapshot_generated_at:
        out['snapshotGeneratedAt'] = snapshot_generated_at
    if note:
        out['note'] = note
    return out


def debug_fact(value, source, quality=None, issues=None, notes=None):
    out = {'value': value, 'source': source}
    if quality:
        out['quality'] = quality
    if issues is not None:
        out['issues'] = issues
    if notes:
        out['notes'] = notes
    return out


def quality(availability, *, derivation_kind=None, input_origin=None, reason_codes=None, severity=None, actionability=None):
    out = {'availability': availability}
    if derivation_kind:
        out['derivationKind'] = derivation_kind
    if input_origin:
        out['inputOrigin'] = input_origin
    if reason_codes:
        out['reasonCode'] = list(reason_codes)
    if severity:
        out['severity'] = severity
    if actionability:
        out['actionability'] = actionability
    return out


def issue(field_ref, availability, *, reason_codes=None, derivation_kind=None, input_origin=None, severity=None, actionability=None, message=None):
    out = {'fieldRef': field_ref, 'availability': availability}
    if reason_codes:
        out['reasonCode'] = list(reason_codes)
    if derivation_kind:
        out['derivationKind'] = derivation_kind
    if input_origin:
        out['inputOrigin'] = input_origin
    if severity:
        out['severity'] = severity
    if actionability:
        out['actionability'] = actionability
    if message:
        out['message'] = message
    return out


def map_cell_record_to_series(cells):
    series = []
    for source_period_key, value in (cells or {}).items():
        try:
            num = float(value)
        except (TypeError, ValueError):
            continue
        item = {'sourcePeriodKey': source_period_key, 'value': num}
        item['granularity'] = 'unknown'
        match = re.match(r'^period:(\d{4})(\d{2})(?::(\d+))?$', source_period_key)
        if match:
            month = match.group(2)
            item['periodEnd'] = f"{match.group(1)}-{month}"
            if match.group(3):
                item['sequence'] = int(match.group(3))
                item['granularity'] = 'quarterly'
            elif month in {'04','07','10'}:
                item['granularity'] = 'quarterly'
            elif month == '01':
                item['granularity'] = 'mixed'
            else:
                item['granularity'] = 'annual'
        else:
            item['periodEnd'] = source_period_key
        series.append(item)
    return series


def strip_provenance(value):
    if isinstance(value, list):
        return [strip_provenance(x) for x in value]
    if not isinstance(value, dict):
        return value
    out = {}
    for key, nested in value.items():
        if key == 'decodeMeta' or key.endswith('DebugOnly'):
            continue
        if key == 'source' and isinstance(nested, dict) and {'sourceAlias', 'rawFile', 'requestPath', 'selector'}.issubset(nested.keys()):
            continue
        if key == 'sourceRefs':
            continue
        if key == 'notes' and isinstance(nested, list):
            kept = []
            for note in nested:
                if not isinstance(note, str):
                    continue
                low = note.lower()
                if 'endpoint' in low or 'jsonpath' in low or 'json_path' in low or 'json-path' in low or 'request_path' in low or 'request-path' in low or 'requestpath' in low or 'snapshot' in low or '/api/' in low or note.startswith('$.') or 'decoded by current' in low:
                    continue
                kept.append(note)
            if kept:
                out[key] = kept
            continue
        out[key] = strip_provenance(nested)
    return out

def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2))


def parse_numberish(value):
    if isinstance(value, (int, float)):
        return float(value)
    if not isinstance(value, str):
        return None
    normalized = value.strip().replace(',', '')
    normalized = re.sub(r'[^0-9.+-]', '', normalized)
    if not normalized:
        return None
    try:
        return float(normalized)
    except ValueError:
        return None


def load_runtime_input(path):
    if not path:
        return None
    value = json.loads(pathlib.Path(path).read_text())
    return value if isinstance(value, dict) else None


def build_holding_context(runtime_input, quote_price):
    holding = runtime_input.get('holding') if isinstance(runtime_input, dict) else None
    source_codes = ['provided_runtime_input'] if isinstance(holding, dict) else ['example_holding']
    shares = parse_numberish((holding or {}).get('shares')) if isinstance(holding, dict) else 12.0
    average_price = parse_numberish((holding or {}).get('averagePrice')) if isinstance(holding, dict) else 185.0
    evaluation_amount = parse_numberish((holding or {}).get('evaluationAmount')) if isinstance(holding, dict) else None
    if evaluation_amount is None and shares is not None and quote_price is not None:
        evaluation_amount = round(float(quote_price) * shares, 2)
    return {
        'shares': shares,
        'averagePrice': average_price,
        'evaluationAmount': evaluation_amount,
        'reasonCodes': source_codes if isinstance(holding, dict) else source_codes + ['derived_from_example_defaults'],
        'inputProvided': isinstance(holding, dict),
    }


def make_member_base(name, axis, instrument):
    return {'member': name, 'axis': axis, 'instrument': instrument, 'issues': []}


def main():
    args = parse_args()
    tickers = args.tickers or ['NVDA']
    runtime_input = load_runtime_input(args.runtime_input_file)
    stamp = now_stamp()
    root = pathlib.Path('.omx/context') / f'llm-deepscan-us-dump-contract-{stamp}'
    for ticker in tickers:
        ticker_dir = root / ticker
        raw_dir = ticker_dir / 'raw'
        proc_dir = ticker_dir / 'processed'
        paths = {
            'quotes': f'/api/source/krx-polygon-fmp/market/quotes/current?tickers={ticker}',
            'slim': f'/api/major/wisereport-global/us/companies/{ticker}/slim/v1.1',
            'financials': f'/api/source/fmp-polygon-finnhub-wisereport-global/us/stocks/{ticker}/financials',
            'consensus': f'/api/source/fmp-finnhub-wisereport-global/us/stocks/{ticker}/consensus',
            'news': f'/api/source/polygon-finnhub-wisereport-global/us/stocks/{ticker}/news?limit=3',
            'market': '/api/source/polygon-yahoo/us/market/indicators',
            'report': f'/api/source/fmp-polygon-finnhub-sec-edgar-yahoo-wisereport-global/us/stocks/{ticker}/report?newsLimit=3&filingsLimit=2',
            'ownership': f'/api/source/sec-edgar/us/stocks/{ticker}/ownership-flow?limit=6&recentDays=180',
            'ohlc': f'/api/source/fmp/us/stocks/{ticker}/ohlc?limit=60',
        }
        raw = {key: fetch_json(path) for key, path in paths.items()}
        for key, value in raw.items():
            write_json(raw_dir / f'{key}.json', value)

        slim = raw['slim']
        quotes = raw['quotes']['data']
        cons = raw['consensus']['data']
        consensus_obj = cons.get('consensus') or {}
        news = raw['news']['data']
        market = raw['market']['data']
        report = raw['report']['data']
        ownership = raw['ownership']['data']
        ohlc = raw['ohlc']['data']
        fs_rows = slim['pages']['snap']['financialSummary']['rows']
        metrics = slim['pages']['analysis']['metrics'][0]
        returns = slim['pages']['analysis']['returns'][0]
        obs = slim['pages']['consensus']['observations'][-1]
        price_row = slim['pages']['snap']['priceVolume']['rows'][-1]
        quote_item = quotes['items'][0]
        ownership_summary = ownership.get('summary') or {}
        ownership_counts = ownership_summary.get('counts') if isinstance(ownership_summary.get('counts'), dict) else {}
        ownership_total_direct_events = ownership_counts.get('totalDirectEvents', 0)
        ownership_recent_filings = ownership.get('recentFilings') or []
        ohlc_series = ohlc.get('series') or []
        per_value = metrics.get('per') if isinstance(metrics, dict) else None
        per_quality = None if per_value is not None else quality('missing', reason_codes=['missing_metric_per'], severity='medium', actionability='caution')
        labels = ['시가총액','자산총계','자본총계','매출액','영업이익','당기순이익','영업활동현금흐름','CAPEX','Free Cash Flow','매출총이익률','영업이익률','순이익률','ROA','BPS']
        rowmap = {label: row_index(fs_rows, label) for label in labels}

        def mk(alias, selector, value, q=None, issues=None, notes=None, note=None):
            return debug_fact(
                value,
                debug_source(alias, f'raw/{alias}.json' if alias != 'runtime-input' else 'raw/runtime-input.json', paths.get(alias, '__runtime_input__'), selector, note=note),
                q,
                issues,
                notes,
            )

        holding_input = build_holding_context(runtime_input, quote_item.get('price'))
        holding_context = {
            'shares': mk('runtime-input', {'kind': 'runtime_input', 'path': '$.holding.shares'}, holding_input['shares'], quality('present' if holding_input['shares'] is not None else 'missing', input_origin='runtime_input', reason_codes=holding_input['reasonCodes'])),
            'averagePrice': mk('runtime-input', {'kind': 'runtime_input', 'path': '$.holding.averagePrice'}, holding_input['averagePrice'], quality('present' if holding_input['averagePrice'] is not None else 'missing', input_origin='runtime_input', reason_codes=holding_input['reasonCodes'])),
            'evaluationAmount': mk('runtime-input', {'kind': 'derived', 'note': 'quote price * runtime shares'} if holding_input['inputProvided'] is False else {'kind': 'runtime_input', 'path': '$.holding.evaluationAmount'}, holding_input['evaluationAmount'], quality('present' if holding_input['evaluationAmount'] is not None else 'missing', derivation_kind='derived' if holding_input['inputProvided'] is False else None, input_origin='runtime_input', reason_codes=['derived_from_runtime_holding'] if holding_input['inputProvided'] is False else holding_input['reasonCodes'])),
        }

        instrument = {
            'name': mk('slim', {'kind': 'field', 'path': '$.company.name'}, slim['company']['name']),
            'ticker': mk('slim', {'kind': 'field', 'path': '$.company.ticker'}, slim['company']['ticker']),
            'market': mk('slim', {'kind': 'field', 'path': '$.company.market'}, slim['company']['market']),
            'currency': mk('slim', {'kind': 'field', 'path': '$.company.currency'}, slim['company']['currency']),
        }

        shared_debug = {
            'instrument': instrument,
            'holdingContext': holding_context,
            'marketContext': {
                'quotesCurrent': mk('quotes', {'kind': 'field', 'path': '$.data.items[0]'}, {k:v for k,v in {**quote_item, 'provider': quote_item.get('source')}.items() if k != 'source'}),
                'marketIndicatorsSummary': mk('market', {'kind': 'field', 'path': '$.data.summary'}, market['summary']),
                'consensusSummary': mk('consensus', {'kind': 'field', 'path': '$.data.consensus'}, consensus_obj),
                'slimPages': mk('slim', {'kind': 'field', 'path': '$.pages'}, list(slim['pages'].keys()), quality('present')),
                'reportSections': mk('report', {'kind': 'field', 'path': '$.data'}, list(report.keys()), quality('present')),
            },
            'notes': ['Live-fetched upstream values included.'],
        }

        member = {}
        member['valuation'] = {**make_member_base('valuation', 'business-quality', instrument), 'facts': {
            'currentPrice': mk('quotes', {'kind': 'field', 'path': '$.data.items[0].price'}, {'amount': quote_item['price'], 'currency': quote_item.get('currency'), 'asOf': quote_item.get('asOf'), 'kind': 'market_quote'}),
            'marketCapSeries': mk('slim', {'kind': 'series_map', 'path': f"$.pages.snap.financialSummary.rows[{rowmap['시가총액'][0]}].cells"}, map_cell_record_to_series(rowmap['시가총액'][1]['cells'])),
            'per': mk('slim', {'kind': 'field', 'path': '$.pages.analysis.metrics[0].per'}, per_value, per_quality),
            'pbr': mk('slim', {'kind': 'field', 'path': '$.pages.analysis.metrics[0].pbr'}, metrics['pbr']),
            'eps': mk('slim', {'kind': 'field', 'path': '$.pages.analysis.metrics[0].eps'}, metrics['eps']),
            'bpsSeries': mk('slim', {'kind': 'series_map', 'path': f"$.pages.snap.financialSummary.rows[{rowmap['BPS'][0]}].cells"}, map_cell_record_to_series(rowmap['BPS'][1]['cells'])),
            'targetConsensus': mk('consensus', {'kind': 'field', 'path': '$.data.consensus.targetConsensus'}, consensus_obj.get('targetConsensus'), quality('present') if consensus_obj.get('targetConsensus') is not None else quality('missing', reason_codes=['no_target_consensus'])),
        }}
        member['growth'] = {**make_member_base('growth', 'business-quality', instrument), 'facts': {
            'revenueSeries': mk('slim', {'kind': 'series_map', 'path': f"$.pages.snap.financialSummary.rows[{rowmap['매출액'][0]}].cells"}, map_cell_record_to_series(rowmap['매출액'][1]['cells'])),
            'operatingIncomeSeries': mk('slim', {'kind': 'series_map', 'path': f"$.pages.snap.financialSummary.rows[{rowmap['영업이익'][0]}].cells"}, map_cell_record_to_series(rowmap['영업이익'][1]['cells'])),
            'netIncomeSeries': mk('slim', {'kind': 'series_map', 'path': f"$.pages.snap.financialSummary.rows[{rowmap['당기순이익'][0]}].cells"}, map_cell_record_to_series(rowmap['당기순이익'][1]['cells'])),
            'epsGrowth': mk('slim', {'kind': 'field', 'path': '$.pages.analysis.metrics[0].epsGw'}, metrics['epsGw']),
        }}
        member['profitability-quality'] = {**make_member_base('profitability-quality', 'business-quality', instrument), 'facts': {
            'grossMarginSeries': mk('slim', {'kind': 'series_map', 'path': f"$.pages.snap.financialSummary.rows[{rowmap['매출총이익률'][0]}].cells"}, map_cell_record_to_series(rowmap['매출총이익률'][1]['cells'])),
            'operatingMarginSeries': mk('slim', {'kind': 'series_map', 'path': f"$.pages.snap.financialSummary.rows[{rowmap['영업이익률'][0]}].cells"}, map_cell_record_to_series(rowmap['영업이익률'][1]['cells'])),
            'netMarginSeries': mk('slim', {'kind': 'series_map', 'path': f"$.pages.snap.financialSummary.rows[{rowmap['순이익률'][0]}].cells"}, map_cell_record_to_series(rowmap['순이익률'][1]['cells'])),
            'roe': mk('slim', {'kind': 'field', 'path': '$.pages.analysis.metrics[0].roe'}, metrics['roe']),
        }}
        member['momentum'] = {**make_member_base('momentum', 'market-timing', instrument), 'facts': {
            'currentPrice': mk('quotes', {'kind': 'field', 'path': '$.data.items[0].price'}, {'amount': quote_item['price'], 'currency': quote_item.get('currency'), 'asOf': quote_item.get('asOf'), 'kind': 'market_quote'}),
            'latestCloseFromSlim': mk('slim', {'kind': 'field', 'path': '$.pages.snap.priceVolume.rows[-1].close'}, price_row['close'], quality('present', derivation_kind='proxy', reason_codes=['latest_close_proxy'])),
            'returns1w': mk('slim', {'kind': 'field', 'path': '$.pages.analysis.returns[0].1w'}, returns['1w']),
            'returns3m': mk('slim', {'kind': 'field', 'path': '$.pages.analysis.returns[0].3m'}, returns['3m']),
            'returns1y': mk('slim', {'kind': 'field', 'path': '$.pages.analysis.returns[0].1y'}, returns['1y']),
            'nasdaqChangePct': mk('market', {'kind': 'field', 'path': '$.data.summary.nasdaqChangePct'}, market['summary']['nasdaqChangePct']),
            'sp500Above200Sma': mk('market', {'kind': 'field', 'path': '$.data.summary.sp500Above200Sma'}, market['summary']['sp500Above200Sma']),
            'ohlcSeries': mk(
                'ohlc',
                {'kind': 'slice', 'path': '$.data.series', 'start': 0, 'end': min(len(ohlc_series), 60)},
                ohlc_series if len(ohlc_series) > 0 else None,
                quality('present', derivation_kind='direct', reason_codes=['fmp_primary_ohlc'], severity='low', actionability='usable') if len(ohlc_series) > 0 else quality('missing', reason_codes=['no_ohlc_series'], severity='medium', actionability='caution'),
                notes=['FMP primary OHLC series'] if len(ohlc_series) > 0 else None,
            ),
        }, 'issues': [x for x in [
            issue('facts.ohlcSeries', 'missing', reason_codes=['no_ohlc_series'], severity='medium', actionability='caution') if len(ohlc_series) == 0 else None,
        ] if x]}
        member['estimate-revision'] = {**make_member_base('estimate-revision', 'market-timing', instrument), 'facts': {
            'spotPriceConsensus': mk('slim', {'kind': 'field', 'path': '$.pages.consensus.observations[-1].metrics.val1'}, {'amount': obs['metrics']['val1'], 'currency': slim['company']['currency'], 'kind': 'consensus_spot'}, quality('present', derivation_kind='decoded_alias', reason_codes=['decoded_val_alias']), notes=['decoded by current val1..val9 adapter']),
            'spotPriceMarket': mk('quotes', {'kind': 'field', 'path': '$.data.items[0].price'}, {'amount': quote_item['price'], 'currency': quote_item.get('currency'), 'asOf': quote_item.get('asOf'), 'kind': 'market_quote'}),
            'forecastRevenue': mk('slim', {'kind': 'field', 'path': '$.pages.consensus.observations[-1].metrics.val2'}, obs['metrics']['val2'], quality('present', derivation_kind='decoded_alias', reason_codes=['decoded_val_alias']), notes=['decoded by current val1..val9 adapter']),
            'forecastRevenueRevisionPct': mk('slim', {'kind': 'field', 'path': '$.pages.consensus.observations[-1].metrics.val3'}, obs['metrics']['val3'], quality('present', derivation_kind='decoded_alias', reason_codes=['decoded_val_alias']), notes=['decoded by current val1..val9 adapter']),
            'forecastEps': mk('slim', {'kind': 'field', 'path': '$.pages.consensus.observations[-1].metrics.val4'}, obs['metrics']['val4'], quality('present', derivation_kind='decoded_alias', reason_codes=['decoded_val_alias']), notes=['decoded by current val1..val9 adapter']),
            'forecastEpsRevisionPct': mk('slim', {'kind': 'field', 'path': '$.pages.consensus.observations[-1].metrics.val5'}, obs['metrics']['val5'], quality('present', derivation_kind='decoded_alias', reason_codes=['decoded_val_alias']), notes=['decoded by current val1..val9 adapter']),
            'forwardPer': mk('slim', {'kind': 'field', 'path': '$.pages.consensus.observations[-1].metrics.val6'}, obs['metrics']['val6'], quality('present', derivation_kind='decoded_alias', reason_codes=['decoded_val_alias']), notes=['decoded by current val1..val9 adapter']),
            'forecastBps': mk('slim', {'kind': 'field', 'path': '$.pages.consensus.observations[-1].metrics.val7'}, obs['metrics']['val7'], quality('present', derivation_kind='decoded_alias', reason_codes=['decoded_val_alias']), notes=['decoded by current val1..val9 adapter']),
            'forecastBpsRevisionPct': mk('slim', {'kind': 'field', 'path': '$.pages.consensus.observations[-1].metrics.val8'}, obs['metrics']['val8'], quality('present', derivation_kind='decoded_alias', reason_codes=['decoded_val_alias']), notes=['decoded by current val1..val9 adapter']),
            'forwardPbr': mk('slim', {'kind': 'field', 'path': '$.pages.consensus.observations[-1].metrics.val9'}, obs['metrics']['val9'], quality('present', derivation_kind='decoded_alias', reason_codes=['decoded_val_alias']), notes=['decoded by current val1..val9 adapter']),
        }}
        member['event-risk'] = {**make_member_base('event-risk', 'market-timing', instrument), 'facts': {
            'recentNewsCount': mk('news', {'kind': 'derived', 'note': 'count of fetched news items'}, len(news['news']), quality('present', derivation_kind='derived', reason_codes=['derived_count'])),
            'newsItems': mk('news', {'kind': 'slice', 'path': '$.data.news', 'start': 0, 'end': 3}, [{'publisher': item.get('source'), 'title': item.get('title'), 'summary': item.get('summary'), 'publishedAt': item.get('publishedAt'), 'tickers': item.get('tickers')} for item in news['news']]),
            'targetConsensus': mk('consensus', {'kind': 'field', 'path': '$.data.consensus.targetConsensus'}, consensus_obj.get('targetConsensus'), quality('present') if consensus_obj.get('targetConsensus') is not None else quality('missing', reason_codes=['null_from_source'], severity='medium', actionability='caution')),
            'targetHigh': mk('consensus', {'kind': 'field', 'path': '$.data.consensus.targetHigh'}, consensus_obj.get('targetHigh'), quality('present') if consensus_obj.get('targetHigh') is not None else quality('missing', reason_codes=['null_from_source'], severity='medium', actionability='caution')),
            'targetLow': mk('consensus', {'kind': 'field', 'path': '$.data.consensus.targetLow'}, consensus_obj.get('targetLow'), quality('present') if consensus_obj.get('targetLow') is not None else quality('missing', reason_codes=['null_from_source'], severity='medium', actionability='caution')),
            'earnings': mk('consensus', {'kind': 'field', 'path': '$.data.earnings'}, cons.get('earnings'), quality('present') if cons.get('earnings') is not None else quality('missing', reason_codes=['null_from_source'], severity='medium', actionability='caution')),
            'recommendations': mk('consensus', {'kind': 'field', 'path': '$.data.recommendations'}, cons.get('recommendations'), quality('present') if cons.get('recommendations') is not None else quality('missing', reason_codes=['null_from_source'], severity='medium', actionability='caution')),
            'rating': mk('consensus', {'kind': 'field', 'path': '$.data.rating'}, cons.get('rating'), quality('present') if cons.get('rating') is not None else quality('missing', reason_codes=['null_from_source'], severity='medium', actionability='caution')),
        }, 'issues': [x for x in [
            issue('facts.earnings', 'missing', reason_codes=['null_from_source']) if cons.get('earnings') is None else None,
            issue('facts.recommendations', 'missing', reason_codes=['null_from_source'], severity='low') if cons.get('recommendations') is None else None,
            issue('facts.rating', 'missing', reason_codes=['null_from_source'], severity='low') if cons.get('rating') is None else None,
        ] if x]}
        member['financial-safety'] = {**make_member_base('financial-safety', 'position-fit', instrument), 'facts': {
            'totalAssetsSeries': mk('slim', {'kind': 'series_map', 'path': f"$.pages.snap.financialSummary.rows[{row_index(fs_rows,'자산총계')[0]}].cells"}, map_cell_record_to_series(row_index(fs_rows,'자산총계')[1]['cells'])),
            'totalEquitySeries': mk('slim', {'kind': 'series_map', 'path': f"$.pages.snap.financialSummary.rows[{row_index(fs_rows,'자본총계')[0]}].cells"}, map_cell_record_to_series(row_index(fs_rows,'자본총계')[1]['cells'])),
            'operatingCashFlowSeries': mk('slim', {'kind': 'series_map', 'path': f"$.pages.snap.financialSummary.rows[{row_index(fs_rows,'영업활동현금흐름')[0]}].cells"}, map_cell_record_to_series(row_index(fs_rows,'영업활동현금흐름')[1]['cells'])),
            'capexSeries': mk('slim', {'kind': 'series_map', 'path': f"$.pages.snap.financialSummary.rows[{row_index(fs_rows,'CAPEX')[0]}].cells"}, map_cell_record_to_series(row_index(fs_rows,'CAPEX')[1]['cells'])),
            'freeCashFlowSeries': mk('slim', {'kind': 'series_map', 'path': f"$.pages.snap.financialSummary.rows[{row_index(fs_rows,'Free Cash Flow')[0]}].cells"}, map_cell_record_to_series(row_index(fs_rows,'Free Cash Flow')[1]['cells'])),
            'roe': mk('slim', {'kind': 'field', 'path': '$.pages.analysis.metrics[0].roe'}, metrics['roe']),
        }}
        member['ownership-flow'] = {**make_member_base('ownership-flow', 'position-fit', instrument), 'facts': {
            'directOwnershipFlow': mk(
                'ownership',
                {'kind': 'field', 'path': '$.data.summary'},
                {
                    'source': ownership_summary.get('source') or ownership.get('source'),
                    'recentDays': ownership_summary.get('recentDays') or ownership.get('recentDays'),
                    'signal': ownership_summary.get('signal'),
                    'counts': ownership_summary.get('counts'),
                    'latestDates': ownership_summary.get('latestDates'),
                    'filings': ownership_recent_filings[:4],
                } if ownership_total_direct_events > 0 else None,
                quality('present', derivation_kind='direct', reason_codes=['sec_direct_disclosure_summary'], severity='medium', actionability='caution') if ownership_total_direct_events > 0 else quality('missing', derivation_kind='direct', reason_codes=['no_recent_direct_ownership_filings'], severity='medium', actionability='caution'),
                notes=['SEC direct filing activity summary'] if ownership_total_direct_events > 0 else None,
            ),
            'proxyPeerContext': mk('slim', {'kind': 'field', 'path': '$.pages.analysis.peerGroup'}, {'memberCount': len((slim['pages']['analysis'].get('peerGroup') or {}).get('members', [])) if isinstance(slim['pages']['analysis'].get('peerGroup'), dict) else None, 'availabilityStatus': ((slim['pages']['analysis'].get('peerGroup') or {}).get('availability') or {}).get('status') if isinstance(slim['pages']['analysis'].get('peerGroup'), dict) else None}, quality('present', derivation_kind='proxy', reason_codes=['peer_context_only'])),
            'peerMembers': mk('slim', {'kind': 'field', 'path': '$.pages.analysis.peers'}, slim['pages']['analysis'].get('peers'), quality('present', derivation_kind='proxy', reason_codes=['peer_context_only'])),
        }, 'issues': [x for x in [
            issue('facts.directOwnershipFlow', 'missing', reason_codes=['no_recent_direct_ownership_filings'], derivation_kind='direct', severity='medium', actionability='caution') if ownership_total_direct_events == 0 else None,
        ] if x]}
        member['portfolio-fit'] = {**make_member_base('portfolio-fit', 'position-fit', instrument), 'holdingContext': holding_context, 'facts': {
            'currentPrice': mk('quotes', {'kind': 'field', 'path': '$.data.items[0].price'}, {'amount': quote_item['price'], 'currency': quote_item.get('currency'), 'asOf': quote_item.get('asOf'), 'kind': 'market_quote'}),
            'marketCapSeries': mk('slim', {'kind': 'series_map', 'path': f"$.pages.snap.financialSummary.rows[{row_index(fs_rows,'시가총액')[0]}].cells"}, map_cell_record_to_series(row_index(fs_rows,'시가총액')[1]['cells'])),
            'returns3m': mk('slim', {'kind': 'field', 'path': '$.pages.analysis.returns[0].3m'}, returns['3m']),
        }, 'issues': []}

        axis = {
            'business-quality': {'axis': 'business-quality', 'members': ['valuation', 'growth', 'profitability-quality'], 'issues': [], 'memberContexts': [member['valuation'], member['growth'], member['profitability-quality']]},
            'market-timing': {'axis': 'market-timing', 'members': ['momentum', 'estimate-revision', 'event-risk'], 'issues': [], 'memberContexts': [member['momentum'], member['estimate-revision'], member['event-risk']]},
            'position-fit': {'axis': 'position-fit', 'members': ['financial-safety', 'ownership-flow', 'portfolio-fit'], 'issues': [], 'memberContexts': [member['financial-safety'], member['ownership-flow'], member['portfolio-fit']]},
        }

        shared_runtime = strip_provenance(shared_debug)
        member_runtime = {k: strip_provenance(v) for k, v in member.items()}
        axis_runtime = {k: strip_provenance(v) for k, v in axis.items()}
        write_json(raw_dir / 'runtime-input.json', {'holdingContext': holding_context, 'rawInput': runtime_input or {}})
        runtime_snapshot_path = 'processed/runtime-shape.json'
        runtime_shape = {'shared': shared_runtime, 'members': member_runtime, 'axes': axis_runtime}
        import hashlib
        runtime_shape_hash = hashlib.sha256(canonical_json(runtime_shape).encode('utf-8')).hexdigest()
        manifest = {
            'requestId': f'{ticker.lower()}-{stamp}',
            'generatedAt': stamp,
            'contractVersion': 'v5-candidate',
            'instrument': {
                'name': slim['company']['name'],
                'ticker': slim['company']['ticker'],
                'market': slim['company']['market'],
            },
            'sourceAliases': {**{k: {'rawFile': f'raw/{k}.json', 'requestPath': v} for k, v in paths.items()}, 'runtime-input': {'rawFile': 'raw/runtime-input.json', 'requestPath': '__runtime_input__'}},
            'memberKeys': list(member.keys()),
            'sharedDebugPath': 'processed/shared-context-debug.json',
            'memberDebugPaths': {k: f'processed/member-{k}-debug.json' for k in member},
            'callOrder': list(member.keys()),
            'processedFiles': [
                'processed/shared-context-debug.json',
                'processed/shared-context-runtime.json',
                'processed/runtime-shape.json',
                *[f'processed/member-{k}-debug.json' for k in member],
                *[f'processed/member-{k}-runtime.json' for k in member],
                *[f'processed/axis-{k}-debug.json' for k in axis],
                *[f'processed/axis-{k}-runtime.json' for k in axis],
            ],
            'stripProfileVersion': 'v4-strip',
            'callUnits': [{'member': k, 'sharedFile': 'processed/shared-context-runtime.json', 'memberFile': f'processed/member-{k}-runtime.json'} for k in member],
            'errors': [],
            'runtimeShapeHash': runtime_shape_hash,
            'runtimeSnapshotPath': runtime_snapshot_path,
            'axisDebugPaths': {k: f'processed/axis-{k}-debug.json' for k in axis},
        }
        write_json(ticker_dir / 'manifest.json', manifest)
        for k, v in raw.items():
            write_json(raw_dir / f'{k}.json', v)
        write_json(proc_dir / 'shared-context-debug.json', shared_debug)
        write_json(proc_dir / 'shared-context-runtime.json', shared_runtime)
        write_json(proc_dir / 'runtime-shape.json', runtime_shape)
        for k, v in member.items():
            write_json(proc_dir / f'member-{k}-debug.json', v)
            write_json(proc_dir / f'member-{k}-runtime.json', member_runtime[k])
        for k, v in axis.items():
            write_json(proc_dir / f'axis-{k}-debug.json', v)
            write_json(proc_dir / f'axis-{k}-runtime.json', axis_runtime[k])
    print(root)

if __name__ == '__main__':
    main()
