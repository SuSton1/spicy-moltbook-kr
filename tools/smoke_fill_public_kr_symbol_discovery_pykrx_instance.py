#!/usr/bin/env python3

import sys
from pathlib import Path
from unittest.mock import patch

THIS_DIR = Path(__file__).resolve().parent
if str(THIS_DIR) not in sys.path:
    sys.path.insert(0, str(THIS_DIR))

import fill_public_kr_daily as fill_mod  # noqa: E402


def assert_equal(actual, expected, label):
    if actual != expected:
        raise AssertionError(f"{label}: expected={expected!r} actual={actual!r}")


class FakeSymbolSearch:
    init_count = 0

    def __init__(self):
        type(self).init_count += 1

    def fetch(self, mktsel="ALL", searchText=""):
        assert_equal(mktsel, "ALL", "mktsel")
        assert_equal(searchText, "", "searchText")
        return FakeFinderRows(
            [
                {
                    "short_code": "000660",
                    "marketCode": "STK",
                    "codeName": "SK하이닉스",
                },
                {
                    "short_code": "005930",
                    "marketCode": "STK",
                    "codeName": "삼성전자",
                },
                {
                    "short_code": "ABCDEF",
                    "marketCode": "STK",
                    "codeName": "INVALID",
                },
                {
                    "short_code": "035420",
                    "marketCode": "ETF",
                    "codeName": "SHOULD_SKIP",
                },
            ]
        )


class FakeFinderRows:
    def __init__(self, rows):
        self._rows = list(rows)

    def iterrows(self):
        for idx, row in enumerate(self._rows):
            yield idx, row


def main():
    FakeSymbolSearch.init_count = 0
    with patch.object(fill_mod, "load_pykrx_symbol_search", return_value=FakeSymbolSearch):
        metadata = fill_mod.finder_symbol_metadata()
    assert_equal(FakeSymbolSearch.init_count, 1, "finder should instantiate pykrx search exactly once")
    assert_equal(sorted(metadata.keys()), ["000660", "005930"], "filtered symbols")
    assert_equal(metadata["000660"]["name"], "SK하이닉스", "symbol name")
    assert_equal(metadata["005930"]["marketCode"], "STK", "market code")
    print("ok smoke_fill_public_kr_symbol_discovery_pykrx_instance")


if __name__ == "__main__":
    main()
