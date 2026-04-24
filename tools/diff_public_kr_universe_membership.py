#!/usr/bin/env python3

import argparse
import json
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOOLS_DIR = ROOT / "tools"
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from fill_public_kr_daily import load_filters, parse_day, parse_int, to_date_key, universe_reject_reason  # noqa: E402
from public_kr_historical_common import (  # noqa: E402
    iter_jsonl,
    load_historical_lifecycle,
    load_historical_share_intervals,
    load_partition_rows,
    load_stage_summary,
    resolve_share_count,
    write_json,
)


def parse_args():
    parser = argparse.ArgumentParser(
        description="Diff canonical vs staged public-KR universe membership for one date."
    )
    parser.add_argument("--date", dest="date_key", required=True, help="YYYY-MM-DD")
    parser.add_argument("--stage-root", action="append", required=True)
    parser.add_argument("--data-dir", default="data")
    parser.add_argument("--config", default="config/lab.config.server.lite.json")
    parser.add_argument("--lifecycle-path", default="data/historical_symbol_lifecycle.jsonl")
    parser.add_argument("--shares-path", default="data/historical_shares_intervals.jsonl")
    parser.add_argument("--out", required=True)
    parser.add_argument("--max-symbols", type=int, default=200)
    parser.add_argument("--require-stage-nonregression", action="store_true")
    return parser.parse_args()


def iso_now():
    return datetime.now(timezone.utc).isoformat()


def symbol_set_from_jsonl(path, *, date_field, date_key):
    symbols = set()
    rows_by_symbol = {}
    for row in iter_jsonl(path):
        if str(row.get(date_field) or "").strip() != date_key:
            continue
        symbol = str(row.get("symbol") or "").strip()
        if not symbol:
            continue
        symbols.add(symbol)
        rows_by_symbol[symbol] = row
    return symbols, rows_by_symbol


def symbol_set_from_rows(rows):
    symbols = set()
    rows_by_symbol = {}
    for row in rows or []:
        symbol = str(row.get("symbol") or "").strip()
        if not symbol:
            continue
        symbols.add(symbol)
        rows_by_symbol[symbol] = row
    return symbols, rows_by_symbol


def counter_payload(counter):
    return {key: int(counter[key]) for key in sorted(counter)}


def metadata_for_symbol(symbol, *, lifecycle_by_symbol, shares_by_symbol, date_key, nontrading_symbols):
    lifecycle = lifecycle_by_symbol.get(symbol) or {}
    share_count = resolve_share_count(shares_by_symbol, symbol, date_key)
    return {
        "symbol": symbol,
        "name": str(lifecycle.get("name") or "").strip() or None,
        "marketCode": str(lifecycle.get("marketCode") or "").strip() or None,
        "listedFrom": str(lifecycle.get("listedFrom") or "").strip() or None,
        "delistedOn": str(lifecycle.get("delistedOn") or "").strip() or None,
        "lifecycleSource": str(lifecycle.get("source") or "").strip() or None,
        "hasLifecycle": bool(lifecycle),
        "hasShareCount": share_count is not None,
        "shareCount": int(share_count) if share_count is not None else None,
        "isNonTrading": symbol in nontrading_symbols,
    }


def summarize_symbols(symbols, *, lifecycle_by_symbol, shares_by_symbol, date_key, nontrading_symbols, max_symbols):
    market_counts = Counter()
    lifecycle_source_counts = Counter()
    share_state_counts = Counter()
    sample = []
    for symbol in sorted(symbols):
        metadata = metadata_for_symbol(
            symbol,
            lifecycle_by_symbol=lifecycle_by_symbol,
            shares_by_symbol=shares_by_symbol,
            date_key=date_key,
            nontrading_symbols=nontrading_symbols,
        )
        market_counts[metadata["marketCode"] or "UNKNOWN"] += 1
        lifecycle_source_counts[metadata["lifecycleSource"] or "UNKNOWN"] += 1
        share_state_counts["has_share_count" if metadata["hasShareCount"] else "missing_share_count"] += 1
        if len(sample) < max_symbols:
            sample.append(metadata)
    return {
        "symbolCount": len(symbols),
        "marketCounts": counter_payload(market_counts),
        "lifecycleSourceCounts": counter_payload(lifecycle_source_counts),
        "shareStateCounts": counter_payload(share_state_counts),
        "sampleSymbols": sample,
    }


def infer_stage_candle_rejects(
    symbols,
    *,
    stage_candle_by_symbol,
    shares_by_symbol,
    filters_cfg,
    universe_mode,
    date_key,
):
    counts = Counter()
    sample = []
    for symbol in sorted(symbols):
        row = stage_candle_by_symbol.get(symbol) or {}
        close_price = parse_int(row.get("close"))
        volume = parse_int(row.get("volume"))
        share_count = resolve_share_count(shares_by_symbol, symbol, date_key)
        if close_price is None or volume is None:
            reason = "missing_stage_candle_price_or_volume"
            market_cap = None
            trading_value = None
        elif share_count is None:
            reason = "missing_share_count"
            market_cap = None
            trading_value = int(close_price * volume)
        else:
            market_cap = int(close_price * share_count)
            trading_value = int(close_price * volume)
            reason = universe_reject_reason(universe_mode, market_cap, trading_value, filters_cfg) or "would_pass_approx"
        counts[reason] += 1
        if len(sample) < 100:
            sample.append(
                {
                    "symbol": symbol,
                    "close": close_price,
                    "volume": volume,
                    "shareCount": int(share_count) if share_count is not None else None,
                    "approxMarketCapKrw": market_cap,
                    "approxTradingValue": trading_value,
                    "approxRejectReason": reason,
                }
            )
    return {
        "basis": "approximate_one_day_trading_value_for_target_date",
        "reasonCounts": counter_payload(counts),
        "sampleSymbols": sample,
    }


def main():
    args = parse_args()
    date_key = to_date_key(parse_day(args.date_key))
    data_dir = Path(args.data_dir)
    stage_roots = [Path(path) for path in args.stage_root]
    filters_cfg = load_filters(args.config)
    stage_summaries = [load_stage_summary(stage_root) for stage_root in stage_roots]
    universe_modes = sorted({str(summary.get("universeMode") or "").strip() for summary in stage_summaries if str(summary.get("universeMode") or "").strip()})
    if len(universe_modes) > 1:
        raise SystemExit(f"stage roots disagree on universeMode: {universe_modes}")
    universe_mode = universe_modes[0] if universe_modes else "core_threshold"

    current_candle_symbols, current_candle_by_symbol = symbol_set_from_jsonl(
        data_dir / "candle_daily.jsonl",
        date_field="dateKey",
        date_key=date_key,
    )
    current_universe_symbols, current_universe_by_symbol = symbol_set_from_jsonl(
        data_dir / "universe_daily.jsonl",
        date_field="tradingDateKey",
        date_key=date_key,
    )
    current_nontrading_symbols, _ = symbol_set_from_jsonl(
        data_dir / "nontrading_symbol_daily.jsonl",
        date_field="dateKey",
        date_key=date_key,
    )

    stage_candle_rows = []
    stage_universe_rows = []
    stage_nontrading_rows = []
    for stage_root in stage_roots:
        stage_candle_rows.extend(load_partition_rows(stage_root, "candle", "dateKey", date_key, date_key))
        stage_universe_rows.extend(load_partition_rows(stage_root, "universe", "tradingDateKey", date_key, date_key))
        stage_nontrading_rows.extend(load_partition_rows(stage_root, "nontrading", "dateKey", date_key, date_key))

    stage_candle_symbols, stage_candle_by_symbol = symbol_set_from_rows(stage_candle_rows)
    stage_universe_symbols, stage_universe_by_symbol = symbol_set_from_rows(stage_universe_rows)
    stage_nontrading_symbols, _ = symbol_set_from_rows(stage_nontrading_rows)
    nontrading_symbols = current_nontrading_symbols | stage_nontrading_symbols

    day = parse_day(date_key)
    lifecycle_by_symbol = load_historical_lifecycle(args.lifecycle_path, day_from=day, day_to=day)
    shares_by_symbol = load_historical_share_intervals(args.shares_path)

    current_only_universe = current_universe_symbols - stage_universe_symbols
    stage_only_universe = stage_universe_symbols - current_universe_symbols
    stage_candle_missing_universe = stage_candle_symbols - stage_universe_symbols
    current_universe_without_stage_candle = current_universe_symbols - stage_candle_symbols
    stage_candle_without_current_candle = stage_candle_symbols - current_candle_symbols

    failures = []
    if len(stage_universe_symbols) < len(current_universe_symbols):
        failures.append(
            "stage universe unique symbol count regressed current "
            f"stage={len(stage_universe_symbols)} current={len(current_universe_symbols)}"
        )
    if stage_universe_symbols - stage_candle_symbols:
        failures.append(
            "stage universe contains symbols absent from stage candle "
            f"count={len(stage_universe_symbols - stage_candle_symbols)}"
        )

    payload = {
        "kind": "public_kr_universe_membership_diff_v1",
        "generatedAt": iso_now(),
        "status": "failed" if failures else "passed",
        "dateKey": date_key,
        "universeMode": universe_mode,
        "thresholds": {
            "minMarketCapKrw": int(filters_cfg["min_market_cap"]),
            "minAvgTradingValue20dKrw": int(filters_cfg["min_liquidity"]),
        },
        "stageRoots": [str(path) for path in stage_roots],
        "stageSummaries": stage_summaries,
        "counts": {
            "currentCandleUniqueSymbols": len(current_candle_symbols),
            "currentUniverseUniqueSymbols": len(current_universe_symbols),
            "currentNonTradingUniqueSymbols": len(current_nontrading_symbols),
            "stageCandleUniqueSymbols": len(stage_candle_symbols),
            "stageUniverseUniqueSymbols": len(stage_universe_symbols),
            "stageNonTradingUniqueSymbols": len(stage_nontrading_symbols),
            "currentOnlyUniverseSymbols": len(current_only_universe),
            "stageOnlyUniverseSymbols": len(stage_only_universe),
            "stageCandleMissingUniverseSymbols": len(stage_candle_missing_universe),
            "currentUniverseWithoutStageCandleSymbols": len(current_universe_without_stage_candle),
            "stageCandleWithoutCurrentCandleSymbols": len(stage_candle_without_current_candle),
        },
        "sets": {
            "currentOnlyUniverse": summarize_symbols(
                current_only_universe,
                lifecycle_by_symbol=lifecycle_by_symbol,
                shares_by_symbol=shares_by_symbol,
                date_key=date_key,
                nontrading_symbols=nontrading_symbols,
                max_symbols=max(0, int(args.max_symbols)),
            ),
            "stageOnlyUniverse": summarize_symbols(
                stage_only_universe,
                lifecycle_by_symbol=lifecycle_by_symbol,
                shares_by_symbol=shares_by_symbol,
                date_key=date_key,
                nontrading_symbols=nontrading_symbols,
                max_symbols=max(0, int(args.max_symbols)),
            ),
            "stageCandleMissingUniverse": summarize_symbols(
                stage_candle_missing_universe,
                lifecycle_by_symbol=lifecycle_by_symbol,
                shares_by_symbol=shares_by_symbol,
                date_key=date_key,
                nontrading_symbols=nontrading_symbols,
                max_symbols=max(0, int(args.max_symbols)),
            ),
            "currentUniverseWithoutStageCandle": summarize_symbols(
                current_universe_without_stage_candle,
                lifecycle_by_symbol=lifecycle_by_symbol,
                shares_by_symbol=shares_by_symbol,
                date_key=date_key,
                nontrading_symbols=nontrading_symbols,
                max_symbols=max(0, int(args.max_symbols)),
            ),
        },
        "stageCandleMissingUniverseApproxRejects": infer_stage_candle_rejects(
            stage_candle_missing_universe,
            stage_candle_by_symbol=stage_candle_by_symbol,
            shares_by_symbol=shares_by_symbol,
            filters_cfg=filters_cfg,
            universe_mode=universe_mode,
            date_key=date_key,
        ),
        "failures": failures,
    }
    write_json(args.out, payload)
    if failures and args.require_stage_nonregression:
        raise SystemExit("; ".join(failures))
    print(
        "DONE diff_public_kr_universe_membership "
        f"date={date_key} status={payload['status']} "
        f"current_universe={len(current_universe_symbols)} stage_universe={len(stage_universe_symbols)} "
        f"out={args.out}",
        flush=True,
    )


if __name__ == "__main__":
    main()
