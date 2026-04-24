#!/usr/bin/env python3

import argparse
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from public_kr_historical_common import (
    iter_jsonl,
    load_partition_rows,
    load_stage_qc_summary,
    load_stage_summary,
    write_json,
)


STATUS_PASSED = "passed"
STATUS_FAILED = "failed"


def parse_args():
    parser = argparse.ArgumentParser(
        description=(
            "Validate a staged historical backfill date slice before atomic merge into canonical candle/universe/nontrading."
        )
    )
    parser.add_argument("--stage-root", action="append", required=True)
    parser.add_argument("--from", dest="date_from", required=True)
    parser.add_argument("--to", dest="date_to", required=True)
    parser.add_argument("--data-dir", default="data")
    parser.add_argument("--summary-out", default="")
    parser.add_argument("--min-local-ratio", type=float, default=0.85)
    parser.add_argument("--min-recovery-rate", type=float, default=0.80)
    return parser.parse_args()


def scan_daily_counts(path, *, date_field):
    counts = defaultdict(int)
    input_path = Path(path)
    if not input_path.exists():
        return counts
    for row in iter_jsonl(input_path):
        date_key = str(row.get(date_field) or "").strip()
        if not date_key:
            continue
        counts[date_key] += 1
    return counts


def build_neighbor_maps(sorted_dates, target_dates):
    prev_map = {}
    next_map = {}
    target_set = set(target_dates)
    for idx, date_key in enumerate(sorted_dates):
        if date_key not in target_set:
            continue
        if idx > 0:
            prev_map[date_key] = sorted_dates[idx - 1]
        if idx + 1 < len(sorted_dates):
            next_map[date_key] = sorted_dates[idx + 1]
    return prev_map, next_map


def collect_symbol_sets(path, *, tracked_dates, date_field):
    out = defaultdict(set)
    tracked = set(tracked_dates or [])
    if not tracked:
        return out
    for row in iter_jsonl(path):
        date_key = str(row.get(date_field) or "").strip()
        if date_key not in tracked:
            continue
        symbol = str(row.get("symbol") or "").strip()
        if not symbol:
            continue
        out[date_key].add(symbol)
    return out


def build_stage_sets(rows, *, key_name):
    out = defaultdict(set)
    for row in rows or []:
        date_key = str(row.get(key_name) or "").strip()
        symbol = str(row.get("symbol") or "").strip()
        if not date_key or not symbol:
            continue
        out[date_key].add(symbol)
    return out


def main():
    args = parse_args()
    stage_roots = [Path(path).resolve() for path in args.stage_root]
    for stage_root in stage_roots:
        summary = load_stage_summary(stage_root)
        if str(summary.get("status") or "").strip() != "completed":
            raise SystemExit(f"stage root is not completed: {stage_root}")
        qc_summary = load_stage_qc_summary(stage_root)
        if str(qc_summary.get("status") or "").strip() != "passed":
            raise SystemExit(f"stage root QC is not passed: {stage_root}")

    data_dir = Path(args.data_dir)
    candle_path = data_dir / "candle_daily.jsonl"
    universe_path = data_dir / "universe_daily.jsonl"

    stage_candle_rows = []
    stage_universe_rows = []
    stage_nontrading_rows = []
    for stage_root in stage_roots:
        stage_candle_rows.extend(load_partition_rows(stage_root, "candle", "dateKey", args.date_from, args.date_to))
        stage_universe_rows.extend(
            load_partition_rows(stage_root, "universe", "tradingDateKey", args.date_from, args.date_to)
        )
        stage_nontrading_rows.extend(load_partition_rows(stage_root, "nontrading", "dateKey", args.date_from, args.date_to))

    stage_candle_counts = defaultdict(int)
    stage_universe_counts = defaultdict(int)
    stage_nontrading_counts = defaultdict(int)
    for row in stage_candle_rows:
        stage_candle_counts[str(row.get("dateKey") or "").strip()] += 1
    for row in stage_universe_rows:
        stage_universe_counts[str(row.get("tradingDateKey") or "").strip()] += 1
    for row in stage_nontrading_rows:
        stage_nontrading_counts[str(row.get("dateKey") or "").strip()] += 1

    target_dates = sorted(set(stage_candle_counts))
    if not target_dates:
        raise SystemExit("stage produced no candle rows in requested date range")

    current_candle_counts = scan_daily_counts(candle_path, date_field="dateKey")
    current_universe_counts = scan_daily_counts(universe_path, date_field="tradingDateKey")
    candle_dates = sorted(current_candle_counts)
    prev_map, next_map = build_neighbor_maps(candle_dates, target_dates)

    tracked_dates = set(target_dates) | set(prev_map.values()) | set(next_map.values())
    current_candle_sets = collect_symbol_sets(candle_path, tracked_dates=tracked_dates, date_field="dateKey")
    stage_candle_sets = build_stage_sets(stage_candle_rows, key_name="dateKey")

    failures = []
    per_date = []
    for date_key in target_dates:
        current_rows = int(current_candle_counts.get(date_key) or 0)
        stage_rows = int(stage_candle_counts.get(date_key) or 0)
        current_universe_rows = int(current_universe_counts.get(date_key) or 0)
        stage_universe_rows = int(stage_universe_counts.get(date_key) or 0)
        prev_date = prev_map.get(date_key)
        next_date = next_map.get(date_key)
        prev_rows = int(current_candle_counts.get(prev_date) or 0) if prev_date else 0
        next_rows = int(current_candle_counts.get(next_date) or 0) if next_date else 0
        local_baseline = None
        if prev_rows > 0 and next_rows > 0:
            local_baseline = (prev_rows + next_rows) / 2.0
        elif prev_rows > 0:
            local_baseline = float(prev_rows)
        elif next_rows > 0:
            local_baseline = float(next_rows)
        stage_local_ratio = (stage_rows / local_baseline) if local_baseline else None
        current_local_ratio = (current_rows / local_baseline) if local_baseline else None

        prev_symbols = set(current_candle_sets.get(prev_date) or set()) if prev_date else set()
        current_symbols = set(current_candle_sets.get(date_key) or set())
        staged_symbols = set(stage_candle_sets.get(date_key) or set())
        current_missing = len(prev_symbols - current_symbols)
        staged_missing = len(prev_symbols - staged_symbols)
        recovered = max(0, current_missing - staged_missing)
        recovery_rate = (recovered / current_missing) if current_missing > 0 else 1.0

        if stage_rows <= current_rows:
            failures.append(
                f"date={date_key} stage candle rows did not improve current rows stage={stage_rows} current={current_rows}"
            )
        if stage_universe_rows < current_universe_rows:
            failures.append(
                f"date={date_key} stage universe rows regressed current rows stage={stage_universe_rows} current={current_universe_rows}"
            )
        if stage_universe_rows > stage_rows:
            failures.append(
                f"date={date_key} stage universe rows exceed stage candle rows universe={stage_universe_rows} candle={stage_rows}"
            )
        if local_baseline and stage_local_ratio is not None and stage_local_ratio < args.min_local_ratio:
            failures.append(
                f"date={date_key} stage local coverage ratio too low stage_local_ratio={stage_local_ratio:.4f} "
                f"min_required={args.min_local_ratio:.4f}"
            )
        if current_missing > 0 and recovery_rate < args.min_recovery_rate:
            failures.append(
                f"date={date_key} previous-day symbol recovery too low recovery_rate={recovery_rate:.4f} "
                f"min_required={args.min_recovery_rate:.4f}"
            )

        per_date.append(
            {
                "dateKey": date_key,
                "currentCandleRows": current_rows,
                "stageCandleRows": stage_rows,
                "currentUniverseRows": current_universe_rows,
                "stageUniverseRows": stage_universe_rows,
                "stageNonTradingRows": int(stage_nontrading_counts.get(date_key) or 0),
                "prevDateKey": prev_date,
                "nextDateKey": next_date,
                "prevCandleRows": prev_rows,
                "nextCandleRows": next_rows,
                "currentLocalRatio": current_local_ratio,
                "stageLocalRatio": stage_local_ratio,
                "currentPrevMissingSymbols": current_missing,
                "stagePrevMissingSymbols": staged_missing,
                "recoveredPrevMissingSymbols": recovered,
                "recoveryRate": recovery_rate,
            }
        )

    payload = {
        "kind": "public_kr_targeted_repair_stage_validation_v1",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "status": STATUS_FAILED if failures else STATUS_PASSED,
        "dateRange": {
            "from": args.date_from,
            "to": args.date_to,
        },
        "thresholds": {
            "minLocalRatio": float(args.min_local_ratio),
            "minRecoveryRate": float(args.min_recovery_rate),
        },
        "targetDateCount": len(target_dates),
        "dates": per_date,
        "failures": failures,
        "stageRoots": [str(path) for path in stage_roots],
    }
    if str(args.summary_out or "").strip():
        write_json(args.summary_out, payload)
    if failures:
        raise SystemExit(
            "targeted repair stage validation failed: " + "; ".join(failures[:8])
        )
    print(
        "DONE validate_public_kr_targeted_repair_stage "
        f"dates={len(target_dates)} stage_roots={len(stage_roots)}",
        flush=True,
    )


if __name__ == "__main__":
    main()
