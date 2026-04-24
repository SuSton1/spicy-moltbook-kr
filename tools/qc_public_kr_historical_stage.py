#!/usr/bin/env python3

import argparse
from collections import defaultdict
from pathlib import Path

from fill_public_kr_daily import classify_invalid_candle_row, iso_now_utc
from public_kr_historical_common import (
    STAGE_QC_SUMMARY_BASENAME,
    STAGE_SYMBOL_RESULTS_BASENAME,
    iter_jsonl,
    load_partition_rows,
    load_stage_summary,
    sort_rows,
    write_json,
)


QC_STATUS_PASSED = "passed"
QC_STATUS_FAILED = "failed"
QC_SUMMARY_KIND = "public_kr_historical_stage_qc_summary_v1"


def parse_args():
    parser = argparse.ArgumentParser(description="QC staged historical KR backfill artifacts before canonical merge.")
    parser.add_argument("--stage-root", required=True)
    parser.add_argument("--summary-out", default="")
    return parser.parse_args()


def write_summary(stage_root, summary, summary_out):
    write_json(Path(stage_root) / STAGE_QC_SUMMARY_BASENAME, summary)
    if str(summary_out or "").strip():
        write_json(summary_out, summary)


def main():
    args = parse_args()
    stage_root = Path(args.stage_root)
    summary = load_stage_summary(stage_root)
    failures = []

    if summary.get("status") != "completed":
        failures.append(f"stage status must be completed before QC, got={summary.get('status')}")

    symbol_results_path = stage_root / STAGE_SYMBOL_RESULTS_BASENAME
    symbol_results = list(iter_jsonl(symbol_results_path))
    expected_symbol_count = int(summary.get("expectedSymbolCount") or 0)
    if expected_symbol_count != len(symbol_results):
        failures.append(
            f"symbol result count mismatch expected={expected_symbol_count} actual={len(symbol_results)}"
        )
    for row in symbol_results:
        if str(row.get("status") or "").strip() != "completed":
            failures.append(f"symbol result not completed symbol={row.get('symbol')} status={row.get('status')}")

    candle_rows = load_partition_rows(stage_root, "candle", "dateKey")
    universe_rows = load_partition_rows(stage_root, "universe", "tradingDateKey")
    nontrading_rows = load_partition_rows(stage_root, "nontrading", "dateKey")

    seen_candle = set()
    seen_universe = set()
    seen_nontrading = set()
    invalid_candles = []

    for row in candle_rows:
        key = (str(row.get("symbol") or "").strip(), str(row.get("dateKey") or "").strip())
        if key in seen_candle:
            failures.append(f"duplicate candle row symbol={key[0]} dateKey={key[1]}")
            continue
        seen_candle.add(key)
        reason = classify_invalid_candle_row(row)
        if reason:
            invalid_candles.append({"symbol": key[0], "dateKey": key[1], "reason": reason})

    for row in universe_rows:
        key = (str(row.get("symbol") or "").strip(), str(row.get("tradingDateKey") or "").strip())
        if key in seen_universe:
            failures.append(f"duplicate universe row symbol={key[0]} dateKey={key[1]}")
            continue
        seen_universe.add(key)
        if key not in seen_candle:
            failures.append(f"universe row without candle symbol={key[0]} dateKey={key[1]}")

    for row in nontrading_rows:
        key = (str(row.get("symbol") or "").strip(), str(row.get("dateKey") or "").strip())
        if key in seen_nontrading:
            failures.append(f"duplicate nontrading row symbol={key[0]} dateKey={key[1]}")
            continue
        seen_nontrading.add(key)

    candle_nontrading_overlap = sorted(seen_candle & seen_nontrading)
    universe_nontrading_overlap = sorted(seen_universe & seen_nontrading)
    if candle_nontrading_overlap:
        failures.append(
            f"candle/nontrading overlap detected pairs={len(candle_nontrading_overlap)}"
        )
    if universe_nontrading_overlap:
        failures.append(
            f"universe/nontrading overlap detected pairs={len(universe_nontrading_overlap)}"
        )
    if invalid_candles:
        failures.append(f"invalid candle rows detected count={len(invalid_candles)}")

    expected_candles = int(summary.get("candleRowCount") or 0)
    expected_universe = int(summary.get("universeRowCount") or 0)
    expected_nontrading = int(summary.get("nonTradingRowCount") or 0)
    if expected_candles != len(candle_rows):
        failures.append(f"candle row count mismatch expected={expected_candles} actual={len(candle_rows)}")
    if expected_universe != len(universe_rows):
        failures.append(f"universe row count mismatch expected={expected_universe} actual={len(universe_rows)}")
    if expected_nontrading != len(nontrading_rows):
        failures.append(
            f"nontrading row count mismatch expected={expected_nontrading} actual={len(nontrading_rows)}"
        )

    qc_summary = {
        "kind": QC_SUMMARY_KIND,
        "generatedAt": iso_now_utc(),
        "stageRoot": str(stage_root.resolve()),
        "status": QC_STATUS_FAILED if failures else QC_STATUS_PASSED,
        "candleRowCount": len(candle_rows),
        "universeRowCount": len(universe_rows),
        "nonTradingRowCount": len(nontrading_rows),
        "duplicateCounts": {
            "candle": max(0, len(candle_rows) - len(seen_candle)),
            "universe": max(0, len(universe_rows) - len(seen_universe)),
            "nontrading": max(0, len(nontrading_rows) - len(seen_nontrading)),
        },
        "overlapCounts": {
            "candleNontrading": len(candle_nontrading_overlap),
            "universeNontrading": len(universe_nontrading_overlap),
        },
        "invalidCandleCount": len(invalid_candles),
        "failures": failures,
        "invalidCandleSamples": sort_rows(invalid_candles[:100], "dateKey"),
    }
    write_summary(stage_root, qc_summary, args.summary_out)
    if failures:
        raise SystemExit(1)
    print(
        "DONE qc_public_kr_historical_stage "
        f"stage_root={stage_root} candle_rows={len(candle_rows)} "
        f"universe_rows={len(universe_rows)} nontrading_rows={len(nontrading_rows)}",
        flush=True,
    )


if __name__ == "__main__":
    main()
