#!/usr/bin/env python3

import json
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

THIS_DIR = Path(__file__).resolve().parent
if str(THIS_DIR) not in sys.path:
    sys.path.insert(0, str(THIS_DIR))

from fill_public_kr_daily import (  # noqa: E402
    InvalidCandleRowsError,
    build_nontrading_status_row,
    build_invalid_candle_symbol_report,
    collect_invalid_candle_rows,
    partition_symbol_series_rows,
    should_skip_nontrading_placeholder_symbol,
    validate_symbol_series_rows,
    write_invalid_candle_audit,
    write_nontrading_status_audit,
)


def assert_equal(actual, expected, label):
    if actual != expected:
        raise AssertionError(f"{label}: expected={expected!r} actual={actual!r}")


def main():
    valid_rows = [
        {
            "dateKey": "2026-03-17",
            "open": 1000,
            "high": 1100,
            "low": 990,
            "close": 1070,
            "volume": 123456,
        }
    ]
    assert_equal(collect_invalid_candle_rows(valid_rows), [], "valid rows stay clean")

    invalid_rows = [
        {
            "dateKey": "2026-03-18",
            "open": 0,
            "high": 0,
            "low": 0,
            "close": 4200,
            "volume": 0,
        },
        {
            "dateKey": "2026-03-19",
            "open": 1100,
            "high": 1000,
            "low": 1200,
            "close": 1050,
            "volume": 1,
        },
    ]
    findings = collect_invalid_candle_rows(invalid_rows)
    assert_equal(findings[0]["reason"], "close_only_placeholder", "placeholder reason")
    assert_equal(findings[1]["reason"], "high_below_low", "range reason")

    try:
        validate_symbol_series_rows(invalid_rows, symbol="000300", source_name="naver")
    except InvalidCandleRowsError as exc:
        assert_equal(exc.symbol, "000300", "invalid symbol")
        assert_equal(exc.source_name, "naver", "invalid source")
        assert_equal(len(exc.invalid_rows), 1, "invalid row count")
        assert_equal(exc.invalid_rows[0]["reason"], "high_below_low", "fatal row reason")
    else:
        raise AssertionError("validate_symbol_series_rows should fail on invalid rows")

    partitioned = partition_symbol_series_rows(invalid_rows)
    assert_equal(len(partitioned["validRows"]), 0, "partition valid count")
    assert_equal(len(partitioned["nonTradingRows"]), 1, "partition nontrading count")
    assert_equal(len(partitioned["fatalRows"]), 1, "partition fatal count")

    report = build_invalid_candle_symbol_report(
        symbol="000300",
        source_name="naver",
        invalid_rows=findings,
        metadata={"name": "DH오토넥스", "marketCode": "STK"},
    )
    with TemporaryDirectory() as tmp_dir:
        audit_path = write_invalid_candle_audit(
            Path(tmp_dir),
            audit_dir="audit",
            day_from_key="2026-03-18",
            day_to_key="2026-03-19",
            reports=[report],
        )
        with open(audit_path, encoding="utf-8") as fh:
            audit = json.load(fh)
        assert_equal(audit["kind"], "fill_public_kr_daily_invalid_candle_audit_v1", "audit kind")
        assert_equal(audit["invalidSymbolCount"], 1, "audit symbol count")
        assert_equal(audit["invalidRowCount"], 2, "audit row count")
        assert_equal(audit["reasonCounts"]["close_only_placeholder"], 1, "audit placeholder count")
        assert_equal(audit["reasonCounts"]["high_below_low"], 1, "audit range count")
        assert_equal(audit["symbols"][0]["name"], "DH오토넥스", "audit symbol name")
        nontrading_status = build_nontrading_status_row(
            symbol="000300",
            source_name="naver",
            row=partitioned["nonTradingRows"][0],
            metadata={"name": "DH오토넥스", "marketCode": "STK"},
            generated_at="2026-03-24T12:00:00Z",
        )
        assert_equal(nontrading_status["status"], "nontrading_status", "nontrading status")
        assert_equal(nontrading_status["marketCode"], "STK", "nontrading marketCode")

        nontrading_report = build_invalid_candle_symbol_report(
            symbol="000300",
            source_name="naver",
            invalid_rows=partitioned["nonTradingRows"],
            metadata={"name": "DH오토넥스", "marketCode": "STK"},
        )
        nontrading_audit_path = write_nontrading_status_audit(
            Path(tmp_dir),
            audit_dir="audit",
            day_from_key="2026-03-18",
            day_to_key="2026-03-19",
            reports=[nontrading_report],
        )
        with open(nontrading_audit_path, encoding="utf-8") as fh:
            nontrading_audit = json.load(fh)
        assert_equal(nontrading_audit["kind"], "fill_public_kr_daily_nontrading_status_audit_v1", "nt audit kind")
        assert_equal(nontrading_audit["nonTradingSymbolCount"], 1, "nt audit symbol count")
        assert_equal(nontrading_audit["nonTradingRowCount"], 1, "nt audit row count")

    placeholder_only_rows = [findings[0]]
    assert_equal(
        should_skip_nontrading_placeholder_symbol(
            symbol="000300",
            source_name="naver",
            invalid_rows=placeholder_only_rows,
            existing_symbols={"005930"},
        ),
        True,
        "inactive symbol placeholder rows should skip",
    )
    assert_equal(
        should_skip_nontrading_placeholder_symbol(
            symbol="000300",
            source_name="naver",
            invalid_rows=placeholder_only_rows,
            existing_symbols={"000300"},
        ),
        True,
        "active symbol placeholder rows become nontrading status",
    )
    assert_equal(
        should_skip_nontrading_placeholder_symbol(
            symbol="000300",
            source_name="naver",
            invalid_rows=findings,
            existing_symbols={"005930"},
        ),
        False,
        "mixed invalid reasons stay fatal",
    )

    print("ok smoke_fill_public_kr_daily_invalid_rows")


if __name__ == "__main__":
    main()
