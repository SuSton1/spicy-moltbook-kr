#!/usr/bin/env python3

import argparse
import hashlib
import json
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOOLS_DIR = ROOT / "tools"
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from fill_public_kr_daily import parse_day, to_date_key  # noqa: E402
from public_kr_historical_common import (  # noqa: E402
    iter_jsonl,
    load_historical_lifecycle,
    load_historical_share_intervals,
    resolve_share_count,
    write_json,
)


DEFAULT_REQUIRED_DATES = ["2022-05-02", "2023-07-11", "2025-09-19"]


def parse_args():
    parser = argparse.ArgumentParser(
        description="Build a fail-fast data readiness summary for TP12 year2hit research."
    )
    parser.add_argument("--data-dir", default="data")
    parser.add_argument("--from", dest="date_from", default="2016-01-04")
    parser.add_argument("--to", dest="date_to", default="")
    parser.add_argument("--min-latest-common-date", default="")
    parser.add_argument("--required-date", action="append", default=[])
    parser.add_argument("--lifecycle-path", default="data/historical_symbol_lifecycle.jsonl")
    parser.add_argument("--shares-path", default="data/historical_shares_intervals.jsonl")
    parser.add_argument("--local-ratio-threshold", type=float, default=0.80)
    parser.add_argument("--out", required=True)
    parser.add_argument("--skip-file-hash", action="store_true")
    return parser.parse_args()


def iso_now():
    return datetime.now(timezone.utc).isoformat()


def file_fingerprint(path, *, include_hash):
    input_path = Path(path)
    if not input_path.exists():
        return {"path": str(input_path), "exists": False}
    stat = input_path.stat()
    payload = {
        "path": str(input_path),
        "exists": True,
        "sizeBytes": int(stat.st_size),
        "mtime": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
    }
    if include_hash:
        digest = hashlib.sha256()
        with open(input_path, "rb") as fh:
            while True:
                chunk = fh.read(1024 * 1024)
                if not chunk:
                    break
                digest.update(chunk)
        payload["sha256"] = digest.hexdigest()
    return payload


def scan_counts(path, *, date_field, date_from, date_to):
    counts = defaultdict(int)
    symbols_by_date = defaultdict(set)
    for row in iter_jsonl(path):
        date_key = str(row.get(date_field) or "").strip()
        if not date_key:
            continue
        if date_key < date_from:
            continue
        if date_to and date_key > date_to:
            continue
        symbol = str(row.get("symbol") or "").strip()
        counts[date_key] += 1
        if symbol:
            symbols_by_date[date_key].add(symbol)
    return counts, symbols_by_date


def summarize_year_counts(counts):
    out = {}
    for date_key, count in counts.items():
        year = date_key[:4]
        row = out.setdefault(year, {"tradingDateCount": 0, "rowCount": 0, "minRows": None, "maxRows": 0})
        row["tradingDateCount"] += 1
        row["rowCount"] += int(count)
        row["minRows"] = int(count) if row["minRows"] is None else min(int(row["minRows"]), int(count))
        row["maxRows"] = max(int(row["maxRows"]), int(count))
    return {year: out[year] for year in sorted(out)}


def neighbor_ratio(counts, date_key):
    dates = sorted(counts)
    if date_key not in counts:
        return None, None, None
    idx = dates.index(date_key)
    prev_count = counts.get(dates[idx - 1]) if idx > 0 else None
    next_count = counts.get(dates[idx + 1]) if idx + 1 < len(dates) else None
    neighbors = [value for value in (prev_count, next_count) if value is not None and value > 0]
    if not neighbors:
        return None, prev_count, next_count
    baseline = sum(neighbors) / len(neighbors)
    return (counts[date_key] / baseline) if baseline else None, prev_count, next_count


def focus_status(date_key, *, candle_counts, universe_counts, threshold):
    candle_ratio, candle_prev, candle_next = neighbor_ratio(candle_counts, date_key)
    universe_ratio, universe_prev, universe_next = neighbor_ratio(universe_counts, date_key)
    failures = []
    if candle_counts.get(date_key, 0) <= 0:
        failures.append("missing_candle_rows")
    if universe_counts.get(date_key, 0) <= 0:
        failures.append("missing_universe_rows")
    if candle_ratio is not None and candle_ratio < threshold:
        failures.append("candle_local_ratio_below_threshold")
    if universe_ratio is not None and universe_ratio < threshold:
        failures.append("universe_local_ratio_below_threshold")
    return {
        "dateKey": date_key,
        "candleRows": int(candle_counts.get(date_key) or 0),
        "universeRows": int(universe_counts.get(date_key) or 0),
        "candlePrevRows": int(candle_prev or 0),
        "candleNextRows": int(candle_next or 0),
        "universePrevRows": int(universe_prev or 0),
        "universeNextRows": int(universe_next or 0),
        "candleLocalRatio": candle_ratio,
        "universeLocalRatio": universe_ratio,
        "status": "failed" if failures else "passed",
        "failures": failures,
    }


def lifecycle_share_status(date_key, lifecycle_path, shares_path):
    day = parse_day(date_key)
    lifecycle_by_symbol = load_historical_lifecycle(lifecycle_path, day_from=day, day_to=day)
    shares_by_symbol = load_historical_share_intervals(shares_path)
    missing = []
    for symbol in sorted(lifecycle_by_symbol):
        if resolve_share_count(shares_by_symbol, symbol, date_key) is None:
            missing.append(symbol)
    return {
        "dateKey": date_key,
        "lifecycleSymbolCount": len(lifecycle_by_symbol),
        "missingShareSymbolCount": len(missing),
        "missingShareSymbolsSample": missing[:100],
    }


def main():
    args = parse_args()
    date_from = to_date_key(parse_day(args.date_from))
    date_to = to_date_key(parse_day(args.date_to)) if str(args.date_to or "").strip() else ""
    required_dates = args.required_date or DEFAULT_REQUIRED_DATES
    required_dates = [to_date_key(parse_day(value)) for value in required_dates]
    data_dir = Path(args.data_dir)
    candle_path = data_dir / "candle_daily.jsonl"
    universe_path = data_dir / "universe_daily.jsonl"
    nontrading_path = data_dir / "nontrading_symbol_daily.jsonl"
    lifecycle_path = Path(args.lifecycle_path)
    shares_path = Path(args.shares_path)

    for path in (candle_path, universe_path, lifecycle_path, shares_path):
        if not path.exists():
            raise SystemExit(f"missing required data file: {path}")

    candle_counts, _ = scan_counts(candle_path, date_field="dateKey", date_from=date_from, date_to=date_to)
    universe_counts, _ = scan_counts(universe_path, date_field="tradingDateKey", date_from=date_from, date_to=date_to)
    candle_dates = set(candle_counts)
    universe_dates = set(universe_counts)
    common_dates = sorted(candle_dates & universe_dates)
    latest_common = common_dates[-1] if common_dates else None

    failures = []
    if not common_dates:
        failures.append("no_common_candle_universe_dates")
    min_latest = str(args.min_latest_common_date or "").strip()
    if min_latest:
        min_latest = to_date_key(parse_day(min_latest))
        if latest_common is None or latest_common < min_latest:
            failures.append(f"latest_common_date_before_required:{latest_common or 'NONE'}<{min_latest}")

    focus_dates = [
        focus_status(date_key, candle_counts=candle_counts, universe_counts=universe_counts, threshold=float(args.local_ratio_threshold))
        for date_key in required_dates
    ]
    for row in focus_dates:
        if row["status"] != "passed":
            failures.append(f"focus_date_failed:{row['dateKey']}:{','.join(row['failures'])}")

    lifecycle_share = [lifecycle_share_status(date_key, lifecycle_path, shares_path) for date_key in required_dates]
    for row in lifecycle_share:
        if row["missingShareSymbolCount"] > 0:
            failures.append(f"shares_missing_on_required_date:{row['dateKey']}:{row['missingShareSymbolCount']}")

    payload = {
        "kind": "tp12_year2hit_data_readiness_summary_v1",
        "generatedAt": iso_now(),
        "status": "failed" if failures else "passed",
        "dateRange": {"from": date_from, "to": date_to or None},
        "latestCommonDate": latest_common,
        "fileFingerprints": {
            "candleDaily": file_fingerprint(candle_path, include_hash=not args.skip_file_hash),
            "universeDaily": file_fingerprint(universe_path, include_hash=not args.skip_file_hash),
            "nonTradingSymbolDaily": file_fingerprint(nontrading_path, include_hash=not args.skip_file_hash),
            "historicalSymbolLifecycle": file_fingerprint(lifecycle_path, include_hash=not args.skip_file_hash),
            "historicalSharesIntervals": file_fingerprint(shares_path, include_hash=not args.skip_file_hash),
        },
        "counts": {
            "candleDateCount": len(candle_dates),
            "universeDateCount": len(universe_dates),
            "commonDateCount": len(common_dates),
            "candleOnlyDateCount": len(candle_dates - universe_dates),
            "universeOnlyDateCount": len(universe_dates - candle_dates),
        },
        "yearCounts": {
            "candle": summarize_year_counts(candle_counts),
            "universe": summarize_year_counts(universe_counts),
        },
        "requiredDateStatuses": focus_dates,
        "requiredDateLifecycleShareStatuses": lifecycle_share,
        "failures": failures,
    }
    write_json(args.out, payload)
    if failures:
        raise SystemExit("tp12 year2hit data readiness failed: " + "; ".join(failures[:8]))
    print(
        "DONE build_tp12_year2hit_data_readiness_summary "
        f"status=passed latest_common={latest_common} out={args.out}",
        flush=True,
    )


if __name__ == "__main__":
    main()
