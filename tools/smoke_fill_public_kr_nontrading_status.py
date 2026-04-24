#!/usr/bin/env python3

import sys
from pathlib import Path

THIS_DIR = Path(__file__).resolve().parent
if str(THIS_DIR) not in sys.path:
    sys.path.insert(0, str(THIS_DIR))

from fill_public_kr_daily import (  # noqa: E402
    build_nontrading_status_row,
    partition_symbol_series_rows,
)


def assert_equal(actual, expected, label):
    if actual != expected:
        raise AssertionError(f"{label}: expected={expected!r} actual={actual!r}")


def main():
    rows = [
        {
            "dateKey": "2026-03-23",
            "open": 1000,
            "high": 1100,
            "low": 990,
            "close": 1080,
            "volume": 120000,
        },
        {
            "dateKey": "2026-03-24",
            "open": 0,
            "high": 0,
            "low": 0,
            "close": 1080,
            "volume": 0,
        },
    ]
    partitioned = partition_symbol_series_rows(rows)
    assert_equal(len(partitioned["validRows"]), 1, "valid row count")
    assert_equal(partitioned["validRows"][0]["dateKey"], "2026-03-23", "valid date")
    assert_equal(len(partitioned["nonTradingRows"]), 1, "nontrading row count")
    assert_equal(partitioned["nonTradingRows"][0]["dateKey"], "2026-03-24", "nontrading date")
    assert_equal(len(partitioned["fatalRows"]), 0, "fatal row count")

    sidecar_row = build_nontrading_status_row(
        symbol="005930",
        source_name="naver",
        row=partitioned["nonTradingRows"][0],
        metadata={"name": "삼성전자", "marketCode": "STK"},
        generated_at="2026-03-24T09:00:00Z",
    )
    assert_equal(sidecar_row["status"], "nontrading_status", "sidecar status")
    assert_equal(sidecar_row["reason"], "close_only_placeholder", "sidecar reason")
    assert_equal(sidecar_row["symbol"], "005930", "sidecar symbol")
    assert_equal(sidecar_row["dateKey"], "2026-03-24", "sidecar date")

    print("ok smoke_fill_public_kr_nontrading_status")


if __name__ == "__main__":
    main()
