#!/usr/bin/env python3

import argparse
import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

from public_kr_historical_common import iter_jsonl, write_json


def parse_args():
    parser = argparse.ArgumentParser(
        description=(
            "Audit canonical candle/universe/nontrading daily files for isolated partial-coverage dates. "
            "This is a date-slice coverage audit, not an invalid-row audit."
        )
    )
    parser.add_argument("--data-dir", default="data")
    parser.add_argument("--audit-dir", default="artifacts/data_quality")
    parser.add_argument("--manifest-path", default="meta/public_kr_partial_coverage_anomaly_manifest.json")
    parser.add_argument("--from", dest="date_from", default="")
    parser.add_argument("--to", dest="date_to", default="")
    parser.add_argument("--prev-ratio-threshold", type=float, default=0.80)
    parser.add_argument("--local-ratio-threshold", type=float, default=0.80)
    parser.add_argument("--summary-out", default="")
    return parser.parse_args()


def load_manifest(path):
    manifest_path = Path(path)
    if not manifest_path.exists():
        return {"kind": "missing_manifest", "anomalyDates": [], "boundaryDates": []}
    with open(manifest_path, encoding="utf-8") as fh:
        return json.load(fh)


def load_symbol_market_codes(path):
    symbol_master_path = Path(path)
    out = {}
    if not symbol_master_path.exists():
        return out
    for row in iter_jsonl(symbol_master_path):
        symbol = str(row.get("symbol") or "").strip()
        if not symbol:
            continue
        market_code = str(row.get("marketCode") or "").strip().upper() or "UNKNOWN"
        out[symbol] = market_code
    return out


def scan_daily_counts(path, *, date_field, date_from="", date_to=""):
    counts = defaultdict(int)
    total_rows = 0
    min_date = None
    max_date = None
    input_path = Path(path)
    if not input_path.exists():
        return {
            "counts": counts,
            "totalRows": 0,
            "minDate": None,
            "maxDate": None,
        }
    for row in iter_jsonl(input_path):
        date_key = str(row.get(date_field) or "").strip()
        if not date_key:
            continue
        if date_from and date_key < date_from:
            continue
        if date_to and date_key > date_to:
            continue
        counts[date_key] += 1
        total_rows += 1
        if min_date is None or date_key < min_date:
            min_date = date_key
        if max_date is None or date_key > max_date:
            max_date = date_key
    return {
        "counts": counts,
        "totalRows": total_rows,
        "minDate": min_date,
        "maxDate": max_date,
    }


def build_severe_anomalies(candle_counts, *, prev_ratio_threshold, local_ratio_threshold):
    dates = sorted(candle_counts)
    anomalies = []
    for idx in range(1, len(dates) - 1):
        prev_date = dates[idx - 1]
        date_key = dates[idx]
        next_date = dates[idx + 1]
        prev_rows = int(candle_counts[prev_date] or 0)
        rows = int(candle_counts[date_key] or 0)
        next_rows = int(candle_counts[next_date] or 0)
        if prev_rows <= 0 or next_rows <= 0:
            continue
        prev_ratio = rows / prev_rows
        local_baseline = (prev_rows + next_rows) / 2.0
        local_ratio = rows / local_baseline if local_baseline > 0 else None
        if prev_ratio < prev_ratio_threshold and local_ratio is not None and local_ratio < local_ratio_threshold:
            anomalies.append(
                {
                    "dateKey": date_key,
                    "prevDateKey": prev_date,
                    "nextDateKey": next_date,
                    "rows": rows,
                    "prevRows": prev_rows,
                    "nextRows": next_rows,
                    "prevRatio": prev_ratio,
                    "localRatio": local_ratio,
                }
            )
    return anomalies


def build_prev_date_map(sorted_dates, target_dates):
    prev_map = {}
    next_map = {}
    if not sorted_dates:
        return prev_map, next_map
    for idx, date_key in enumerate(sorted_dates):
        if date_key not in target_dates:
            continue
        if idx > 0:
            prev_map[date_key] = sorted_dates[idx - 1]
        if idx + 1 < len(sorted_dates):
            next_map[date_key] = sorted_dates[idx + 1]
    return prev_map, next_map


def collect_symbol_sets(path, *, tracked_dates, date_field):
    per_date = defaultdict(set)
    input_path = Path(path)
    if not input_path.exists():
        return per_date
    tracked = set(tracked_dates or [])
    if not tracked:
        return per_date
    for row in iter_jsonl(input_path):
        date_key = str(row.get(date_field) or "").strip()
        if date_key not in tracked:
            continue
        symbol = str(row.get("symbol") or "").strip()
        if not symbol:
            continue
        per_date[date_key].add(symbol)
    return per_date


def summarize_focus_dates(
    *,
    focus_dates,
    anomaly_by_date,
    candle_counts,
    universe_counts,
    nontrading_counts,
    prev_map,
    next_map,
    symbol_sets,
    symbol_markets,
    manifest_rows,
):
    out = []
    for date_key in sorted(focus_dates):
        prev_date = prev_map.get(date_key)
        next_date = next_map.get(date_key)
        current_symbols = set(symbol_sets.get(date_key) or set())
        prev_symbols = set(symbol_sets.get(prev_date) or set()) if prev_date else set()
        missing_symbols = sorted(prev_symbols - current_symbols)
        missing_by_market = Counter(symbol_markets.get(symbol, "UNKNOWN") for symbol in missing_symbols)
        anomaly = anomaly_by_date.get(date_key) or {}
        manifest_row = manifest_rows.get(date_key) or {}
        out.append(
            {
                "dateKey": date_key,
                "currentCandleRows": int(candle_counts.get(date_key) or 0),
                "currentUniverseRows": int(universe_counts.get(date_key) or 0),
                "currentNonTradingRows": int(nontrading_counts.get(date_key) or 0),
                "prevDateKey": prev_date,
                "nextDateKey": next_date,
                "prevCandleRows": int(candle_counts.get(prev_date) or 0) if prev_date else 0,
                "nextCandleRows": int(candle_counts.get(next_date) or 0) if next_date else 0,
                "prevMissingSymbolCount": len(missing_symbols),
                "prevMissingByMarketCode": dict(sorted(missing_by_market.items())),
                "dominantMissingMarketCode": (
                    max(missing_by_market.items(), key=lambda item: (item[1], item[0]))[0]
                    if missing_by_market
                    else None
                ),
                "severeAnomaly": bool(anomaly),
                "prevRatio": anomaly.get("prevRatio"),
                "localRatio": anomaly.get("localRatio"),
                "manifestTagged": bool(manifest_row),
                "manifestSeverity": manifest_row.get("severity"),
                "manifestDefaultUniverseMode": manifest_row.get("defaultUniverseMode"),
                "manifestRepairPriority": manifest_row.get("repairPriority"),
            }
        )
    return out


def main():
    args = parse_args()
    root = Path.cwd()
    data_dir = root / args.data_dir
    candle_path = data_dir / "candle_daily.jsonl"
    universe_path = data_dir / "universe_daily.jsonl"
    nontrading_path = data_dir / "nontrading_symbol_daily.jsonl"
    symbol_master_path = data_dir / "symbol_master.jsonl"
    manifest = load_manifest(root / args.manifest_path)
    manifest_rows = {
        str(row.get("dateKey") or "").strip(): row
        for row in (manifest.get("anomalyDates") or [])
        if str(row.get("dateKey") or "").strip()
    }

    candle_scan = scan_daily_counts(candle_path, date_field="dateKey", date_from=args.date_from, date_to=args.date_to)
    universe_scan = scan_daily_counts(
        universe_path,
        date_field="tradingDateKey",
        date_from=args.date_from,
        date_to=args.date_to,
    )
    nontrading_scan = scan_daily_counts(
        nontrading_path,
        date_field="dateKey",
        date_from=args.date_from,
        date_to=args.date_to,
    )

    candle_counts = candle_scan["counts"]
    universe_counts = universe_scan["counts"]
    nontrading_counts = nontrading_scan["counts"]
    candle_dates = sorted(candle_counts)

    severe_anomalies = build_severe_anomalies(
        candle_counts,
        prev_ratio_threshold=args.prev_ratio_threshold,
        local_ratio_threshold=args.local_ratio_threshold,
    )
    anomaly_by_date = {row["dateKey"]: row for row in severe_anomalies}
    focus_dates = sorted(set(anomaly_by_date) | set(manifest_rows))
    prev_map, next_map = build_prev_date_map(candle_dates, focus_dates)
    tracked_dates = set(focus_dates) | set(prev_map.values()) | set(next_map.values())
    symbol_sets = collect_symbol_sets(candle_path, tracked_dates=tracked_dates, date_field="dateKey")
    symbol_markets = load_symbol_market_codes(symbol_master_path)

    focus_summaries = summarize_focus_dates(
        focus_dates=focus_dates,
        anomaly_by_date=anomaly_by_date,
        candle_counts=candle_counts,
        universe_counts=universe_counts,
        nontrading_counts=nontrading_counts,
        prev_map=prev_map,
        next_map=next_map,
        symbol_sets=symbol_sets,
        symbol_markets=symbol_markets,
        manifest_rows=manifest_rows,
    )

    latest_common_date = None
    common_dates = sorted(set(candle_counts) & set(universe_counts))
    if common_dates:
        latest_common_date = common_dates[-1]

    payload = {
        "kind": "public_kr_partial_coverage_audit_v1",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "dataDir": str(data_dir.resolve()),
        "manifestPath": str((root / args.manifest_path).resolve()),
        "dateRange": {
            "from": args.date_from or None,
            "to": args.date_to or None,
        },
        "thresholds": {
            "prevRatio": float(args.prev_ratio_threshold),
            "localRatio": float(args.local_ratio_threshold),
        },
        "datasets": {
            "candle": {
                "minDate": candle_scan["minDate"],
                "maxDate": candle_scan["maxDate"],
                "rowCount": int(candle_scan["totalRows"]),
                "dateCount": len(candle_counts),
            },
            "universe": {
                "minDate": universe_scan["minDate"],
                "maxDate": universe_scan["maxDate"],
                "rowCount": int(universe_scan["totalRows"]),
                "dateCount": len(universe_counts),
            },
            "nontrading": {
                "minDate": nontrading_scan["minDate"],
                "maxDate": nontrading_scan["maxDate"],
                "rowCount": int(nontrading_scan["totalRows"]),
                "dateCount": len(nontrading_counts),
            },
        },
        "latestCommonDataDate": latest_common_date,
        "manifestTaggedDateCount": len(manifest_rows),
        "severeAnomalyCount": len(severe_anomalies),
        "severeAnomalyDates": focus_summaries,
    }

    if str(args.summary_out or "").strip():
        output_path = Path(args.summary_out)
    else:
        audit_root = root / args.audit_dir
        audit_root.mkdir(parents=True, exist_ok=True)
        ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        output_path = audit_root / f"partial_coverage_audit_{ts}.json"
    write_json(output_path, payload)
    print(
        "AUDIT public_kr_partial_coverage "
        f"severe_anomaly_dates={len(severe_anomalies)} "
        f"latest_common_data_date={latest_common_date or 'NONE'} "
        f"summary={output_path}",
        flush=True,
    )


if __name__ == "__main__":
    main()
