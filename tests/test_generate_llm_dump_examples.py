import argparse
import importlib.util
import pathlib
import unittest
from unittest import mock


ROOT = pathlib.Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / 'scripts' / 'generate_llm_dump_examples.py'
SPEC = importlib.util.spec_from_file_location('generate_llm_dump_examples', MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


ALL_ROW_LABELS = [
    '시가총액', '자산총계', '자본총계', '매출액', '영업이익', '당기순이익',
    '영업활동현금흐름', 'CAPEX', 'Free Cash Flow', '매출총이익률', '영업이익률',
    '순이익률', 'ROA', 'BPS',
]


def make_row(label: str, value: str) -> dict:
    return {
        'label': label,
        'cells': {
            'period:202501': value,
            'period:202401': value,
        },
    }


class GenerateLlmDumpExamplesTest(unittest.TestCase):
    def run_main_with_raw(self, raw_by_path):
        writes = {}
        with mock.patch.object(MODULE, 'parse_args', return_value=argparse.Namespace(tickers=['IONQ'], runtime_input_file=None)), \
             mock.patch.object(MODULE, 'now_stamp', return_value='20260421T000000Z'), \
             mock.patch.object(MODULE, 'fetch_json', side_effect=lambda path: raw_by_path[path]), \
             mock.patch.object(MODULE, 'write_json', side_effect=lambda path, data: writes.__setitem__(str(path), data)):
            MODULE.main()
        return writes

    def test_main_treats_missing_per_as_optional_missing_fact(self):
        raw_by_path = {
            '/api/source/krx-polygon-fmp/market/quotes/current?tickers=IONQ': {
                'data': {
                    'items': [
                        {
                            'price': 42.0,
                            'currency': 'USD',
                            'asOf': '2026-04-21T00:00:00Z',
                            'source': 'polygon',
                        }
                    ]
                }
            },
            '/api/major/wisereport-global/us/companies/IONQ/slim/v1.1': {
                'company': {
                    'name': 'IonQ',
                    'ticker': 'IONQ',
                    'market': 'NYSE',
                    'currency': 'USD',
                },
                'pages': {
                    'snap': {
                        'financialSummary': {
                            'rows': [make_row(label, '10') for label in ALL_ROW_LABELS],
                        },
                        'priceVolume': {
                            'rows': [
                                {'close': 41.2},
                            ]
                        },
                    },
                    'analysis': {
                        'metrics': [
                            {
                                'name': 'IonQ',
                                'ticker': 'IONQ',
                                'pbr': 4.1,
                                'eps': -0.21,
                                'epsGw': 12.3,
                                'roe': -1.4,
                            }
                        ],
                        'returns': [
                            {
                                '1w': 1.1,
                                '3m': 2.2,
                                '1y': 3.3,
                            }
                        ],
                        'peerGroup': {
                            'members': [{'ticker': 'RGTI'}],
                            'availability': {'status': 'ok'},
                        },
                        'peers': [{'ticker': 'RGTI'}],
                    },
                    'consensus': {
                        'observations': [
                            {
                                'metrics': {
                                    'val1': 39.0,
                                    'val2': 101.0,
                                    'val3': 1.5,
                                    'val4': 0.2,
                                    'val5': 2.5,
                                    'val6': 80.0,
                                    'val7': 5.1,
                                    'val8': 1.2,
                                    'val9': 6.4,
                                }
                            }
                        ]
                    },
                },
            },
            '/api/source/fmp-polygon-finnhub-wisereport-global/us/stocks/IONQ/financials': {'data': {}},
            '/api/source/fmp-finnhub-wisereport-global/us/stocks/IONQ/consensus': {
                'data': {
                    'consensus': {
                        'targetConsensus': 55.0,
                        'targetHigh': 60.0,
                        'targetLow': 45.0,
                    },
                    'earnings': None,
                    'recommendations': None,
                    'rating': None,
                }
            },
            '/api/source/polygon-finnhub-wisereport-global/us/stocks/IONQ/news?limit=3': {
                'data': {
                    'news': [
                        {
                            'source': 'Reuters',
                            'title': 'IonQ signs a new deal',
                            'summary': 'Partnership update',
                            'publishedAt': '2026-04-20T00:00:00Z',
                            'tickers': ['IONQ'],
                        }
                    ]
                }
            },
            '/api/source/polygon-yahoo/us/market/indicators': {
                'data': {
                    'summary': {
                        'nasdaqChangePct': 1.5,
                        'sp500Above200Sma': 0.75,
                    }
                }
            },
            '/api/source/fmp-polygon-finnhub-sec-edgar-yahoo-wisereport-global/us/stocks/IONQ/report?newsLimit=3&filingsLimit=2': {
                'data': {
                    'hero': {},
                    'axes': {},
                }
            },
            '/api/source/sec-edgar/us/stocks/IONQ/ownership-flow?limit=6&recentDays=180': {
                'data': {
                    'source': 'sec-submissions',
                    'recentDays': 180,
                    'summary': {
                        'source': 'sec-submissions',
                        'recentDays': 180,
                        'signal': {
                            'status': 'quiet',
                            'direction': 'quiet',
                            'summary': '최근 180일 direct ownership/flow 공시 없음',
                        },
                        'counts': {
                            'totalDirectEvents': 0,
                        },
                        'latestDates': {},
                    },
                    'recentFilings': [],
                }
            },
            '/api/source/fmp/us/stocks/IONQ/ohlc?limit=60': {
                'data': {
                    'series': [
                        {'date': '2026-04-20', 'close': 41.2},
                    ]
                }
            },
        }
        writes = self.run_main_with_raw(raw_by_path)

        valuation_runtime = next(
            data for path, data in writes.items() if path.endswith('processed/member-valuation-runtime.json')
        )
        manifest = next(
            data for path, data in writes.items() if path.endswith('manifest.json')
        )

        self.assertIsNone(valuation_runtime['facts']['per']['value'])
        self.assertEqual(valuation_runtime['facts']['per']['quality']['availability'], 'missing')
        self.assertEqual(valuation_runtime['facts']['per']['quality']['reasonCode'], ['missing_metric_per'])
        self.assertEqual(manifest['instrument']['ticker'], 'IONQ')

    def test_main_keeps_existing_per_shape_when_metric_exists(self):
        raw_by_path = {
            '/api/source/krx-polygon-fmp/market/quotes/current?tickers=IONQ': {
                'data': {'items': [{'price': 42.0, 'currency': 'USD', 'asOf': '2026-04-21T00:00:00Z', 'source': 'polygon'}]}
            },
            '/api/major/wisereport-global/us/companies/IONQ/slim/v1.1': {
                'company': {'name': 'IonQ', 'ticker': 'IONQ', 'market': 'NYSE', 'currency': 'USD'},
                'pages': {
                    'snap': {
                        'financialSummary': {'rows': [make_row(label, '10') for label in ALL_ROW_LABELS]},
                        'priceVolume': {'rows': [{'close': 41.2}]},
                    },
                    'analysis': {
                        'metrics': [{'name': 'IonQ', 'ticker': 'IONQ', 'per': 88.4, 'pbr': 4.1, 'eps': -0.21, 'epsGw': 12.3, 'roe': -1.4}],
                        'returns': [{'1w': 1.1, '3m': 2.2, '1y': 3.3}],
                        'peerGroup': {'members': [{'ticker': 'RGTI'}], 'availability': {'status': 'ok'}},
                        'peers': [{'ticker': 'RGTI'}],
                    },
                    'consensus': {'observations': [{'metrics': {'val1': 39.0, 'val2': 101.0, 'val3': 1.5, 'val4': 0.2, 'val5': 2.5, 'val6': 80.0, 'val7': 5.1, 'val8': 1.2, 'val9': 6.4}}]},
                },
            },
            '/api/source/fmp-polygon-finnhub-wisereport-global/us/stocks/IONQ/financials': {'data': {}},
            '/api/source/fmp-finnhub-wisereport-global/us/stocks/IONQ/consensus': {'data': {'consensus': {'targetConsensus': 55.0, 'targetHigh': 60.0, 'targetLow': 45.0}, 'earnings': None, 'recommendations': None, 'rating': None}},
            '/api/source/polygon-finnhub-wisereport-global/us/stocks/IONQ/news?limit=3': {'data': {'news': [{'source': 'Reuters', 'title': 'IonQ signs a new deal', 'summary': 'Partnership update', 'publishedAt': '2026-04-20T00:00:00Z', 'tickers': ['IONQ']}]}},
            '/api/source/polygon-yahoo/us/market/indicators': {'data': {'summary': {'nasdaqChangePct': 1.5, 'sp500Above200Sma': 0.75}}},
            '/api/source/fmp-polygon-finnhub-sec-edgar-yahoo-wisereport-global/us/stocks/IONQ/report?newsLimit=3&filingsLimit=2': {'data': {'hero': {}, 'axes': {}}},
            '/api/source/sec-edgar/us/stocks/IONQ/ownership-flow?limit=6&recentDays=180': {'data': {'source': 'sec-submissions', 'recentDays': 180, 'summary': {'source': 'sec-submissions', 'recentDays': 180, 'signal': {'status': 'quiet', 'direction': 'quiet', 'summary': '최근 180일 direct ownership/flow 공시 없음'}, 'counts': {'totalDirectEvents': 0}, 'latestDates': {}}, 'recentFilings': []}},
            '/api/source/fmp/us/stocks/IONQ/ohlc?limit=60': {'data': {'series': [{'date': '2026-04-20', 'close': 41.2}]}}}
        writes = self.run_main_with_raw(raw_by_path)
        valuation_runtime = next(data for path, data in writes.items() if path.endswith('processed/member-valuation-runtime.json'))

        self.assertEqual(valuation_runtime['facts']['per']['value'], 88.4)
        self.assertNotIn('quality', valuation_runtime['facts']['per'])


if __name__ == '__main__':
    unittest.main()
