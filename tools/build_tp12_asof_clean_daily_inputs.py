#!/usr/bin/env python3

import argparse
import json
from bisect import bisect_right
from collections import defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path
from tempfile import NamedTemporaryFile
import shutil


def parse_args():
    parser = argparse.ArgumentParser(
        description="Build explicit TP12 as-of-clean candle/universe inputs from canonical candles, lifecycle, and shares."
    )
    parser.add_argument("--candle-path", default="data/candle_daily.jsonl")
    parser.add_argument("--lifecycle-path", default="data/historical_symbol_lifecycle.jsonl")
    parser.add_argument("--shares-path", default="data/historical_shares_intervals.jsonl")
    parser.add_argument("--from", dest="date_from", default="2016-01-04")
    parser.add_argument("--to", dest="date_to", default="")
    parser.add_argument("--min-latest-common-date", default="")
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--summary-out", default="")
    return parser.parse_args()


def iso_now():
    return datetime.now(timezone.utc).isoformat()


def compact_json(row):
    return json.dumps(row, ensure_ascii=False, separators=(",", ":"))


def iter_jsonl(path):
    with open(path, encoding="utf-8") as fh:
        for line_number, line in enumerate(fh, 1):
            text = line.strip()
            if not text:
                continue
            try:
                yield json.loads(text), line_number
            except json.JSONDecodeError as exc:
                raise SystemExit(f"malformed JSONL at {path}:{line_number}: {exc}") from exc


def write_json(path, payload):
    output_path = Path(path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile("w", encoding="utf-8", delete=False, dir=str(output_path.parent)) as tmp:
        json.dump(payload, tmp, ensure_ascii=False, indent=2)
        tmp.write("\n")
        temp_path = Path(tmp.name)
    shutil.move(str(temp_path), str(output_path))


def valid_date_key(value):
    text = str(value or "").strip()
    return len(text) == 10 and text[4] == "-" and text[7] == "-"


def normalize_symbol(value):
    return str(value or "").strip().upper()


def normalize_open_end(value):
    text = str(value or "").strip()
    return text or None


def load_lifecycle(path):
    by_symbol = defaultdict(list)
    for row, line_number in iter_jsonl(path):
        symbol = normalize_symbol(row.get("symbol"))
        if not symbol:
            raise SystemExit(f"missing lifecycle symbol at {path}:{line_number}")
        by_symbol[symbol].append(row)
    return dict(by_symbol)


def lifecycle_active_on(rows, date_key):
    for row in rows or []:
        listed_from = normalize_open_end(row.get("listedFrom") or row.get("effectiveFrom"))
        effective_from = normalize_open_end(row.get("effectiveFrom") or row.get("listedFrom"))
        starts = sorted(value for value in (listed_from, effective_from) if value)
        start = starts[-1] if starts else None
        delisted_on = normalize_open_end(row.get("delistedOn"))
        effective_to = normalize_open_end(row.get("effectiveTo"))
        if start and date_key < start:
            continue
        if effective_to and date_key > effective_to:
            continue
        if delisted_on and date_key >= delisted_on:
            continue
        return True
    return False


def load_shares(path):
    by_symbol = defaultdict(list)
    for row, line_number in iter_jsonl(path):
        symbol = normalize_symbol(row.get("symbol"))
        start = str(row.get("effectiveFrom") or "").strip()
        end = str(row.get("effectiveTo") or "").strip()
        shares = row.get("sharesOutstanding")
        if not symbol or not valid_date_key(start) or not valid_date_key(end):
            raise SystemExit(f"invalid shares interval at {path}:{line_number}")
        try:
            shares = int(shares)
        except Exception as exc:
            raise SystemExit(f"invalid sharesOutstanding at {path}:{line_number}: {shares}") from exc
        if shares <= 0:
            raise SystemExit(f"non-positive sharesOutstanding at {path}:{line_number}: {shares}")
        by_symbol[symbol].append((start, end, shares))
    out = {}
    for symbol, rows in by_symbol.items():
        rows.sort(key=lambda item: (item[0], item[1]))
        out[symbol] = {
            "starts": [row[0] for row in rows],
            "rows": rows,
        }
    return out


def resolve_shares(shares_by_symbol, symbol, date_key):
    entry = shares_by_symbol.get(symbol)
    if not entry:
        return None
    index = bisect_right(entry["starts"], date_key) - 1
    if index < 0:
        return None
    start, end, shares = entry["rows"][index]
    if start <= date_key <= end:
        return shares
    return None


def normalize_candle_row(row, path, line_number):
    symbol = normalize_symbol(row.get("symbol"))
    date_key = str(row.get("dateKey") or row.get("tradingDateKey") or "").strip()
    if not symbol:
        raise SystemExit(f"missing candle symbol at {path}:{line_number}")
    if not valid_date_key(date_key):
        raise SystemExit(f"invalid candle dateKey at {path}:{line_number}: {date_key}")
    try:
        open_ = float(row.get("open"))
        high = float(row.get("high"))
        low = float(row.get("low"))
        close = float(row.get("close"))
        volume = int(row.get("volume") or 0)
    except Exception as exc:
        raise SystemExit(f"invalid candle numeric fields at {path}:{line_number}") from exc
    if open_ <= 0 or high <= 0 or low <= 0 or close <= 0 or volume < 0:
        raise SystemExit(f"invalid candle OHLCV at {path}:{line_number}")
    if high < low or high < max(open_, close) or low > min(open_, close):
        raise SystemExit(f"invalid candle envelope at {path}:{line_number}")
    return {
        "symbol": symbol,
        "dateKey": date_key,
        "open": row.get("open"),
        "high": row.get("high"),
        "low": row.get("low"),
        "close": row.get("close"),
        "volume": volume,
        "_closeFloat": close,
    }


def main():
    args = parse_args()
    candle_path = Path(args.candle_path)
    lifecycle_path = Path(args.lifecycle_path)
    shares_path = Path(args.shares_path)
    out_dir = Path(args.out_dir)
    if not candle_path.exists():
        raise SystemExit(f"missing candle path: {candle_path}")
    if not lifecycle_path.exists():
        raise SystemExit(f"missing lifecycle path: {lifecycle_path}")
    if not shares_path.exists():
        raise SystemExit(f"missing shares path: {shares_path}")
    date_from = str(args.date_from or "").strip()
    date_to = str(args.date_to or "").strip()
    min_latest = str(args.min_latest_common_date or "").strip()
    if not valid_date_key(date_from):
        raise SystemExit(f"invalid --from: {date_from}")
    if date_to and not valid_date_key(date_to):
        raise SystemExit(f"invalid --to: {date_to}")
    if min_latest and not valid_date_key(min_latest):
        raise SystemExit(f"invalid --min-latest-common-date: {min_latest}")
    if date_to and date_from > date_to:
        raise SystemExit(f"invalid date range: {date_from}..{date_to}")

    out_dir.mkdir(parents=True, exist_ok=True)
    out_candle = out_dir / "candle_daily.jsonl"
    out_universe = out_dir / "universe_daily.jsonl"
    summary_out = Path(args.summary_out) if str(args.summary_out or "").strip() else out_dir / "asof_clean_daily_inputs_summary.json"

    lifecycle_by_symbol = load_lifecycle(lifecycle_path)
    shares_by_symbol = load_shares(shares_path)

    input_rows = 0
    date_filtered_rows = 0
    kept_rows = 0
    dropped_missing_lifecycle = 0
    dropped_inactive_lifecycle = 0
    dropped_missing_shares = 0
    duplicate_pair_count = 0
    unsorted_inputAccepted = True
    non_monotonic_symbol_count = 0
    seen_pairs = set()
    clean_rows_by_symbol = defaultdict(list)
    dropped_symbol_counts = defaultdict(int)
    kept_symbol_count = set()
    kept_dates = set()

    for raw, line_number in iter_jsonl(candle_path):
        input_rows += 1
        row = normalize_candle_row(raw, candle_path, line_number)
        symbol = row["symbol"]
        date_key = row["dateKey"]
        if date_key < date_from:
            continue
        if date_to and date_key > date_to:
            continue
        date_filtered_rows += 1
        pair = (symbol, date_key)
        if pair in seen_pairs:
            duplicate_pair_count += 1
            continue
        seen_pairs.add(pair)
        lifecycle_rows = lifecycle_by_symbol.get(symbol) or []
        if not lifecycle_rows:
            dropped_missing_lifecycle += 1
            dropped_symbol_counts[symbol] += 1
            continue
        if not lifecycle_active_on(lifecycle_rows, date_key):
            dropped_inactive_lifecycle += 1
            dropped_symbol_counts[symbol] += 1
            continue
        shares = resolve_shares(shares_by_symbol, symbol, date_key)
        if shares is None:
            dropped_missing_shares += 1
            dropped_symbol_counts[symbol] += 1
            continue
        clean_rows_by_symbol[symbol].append(
            {
                "symbol": symbol,
                "dateKey": date_key,
                "open": row["open"],
                "high": row["high"],
                "low": row["low"],
                "close": row["close"],
                "volume": row["volume"],
                "_closeFloat": row["_closeFloat"],
                "_shares": shares,
            }
        )
        kept_symbol_count.add(symbol)
        kept_dates.add(date_key)

    with NamedTemporaryFile("w", encoding="utf-8", delete=False, dir=str(out_dir)) as candle_tmp, NamedTemporaryFile(
        "w", encoding="utf-8", delete=False, dir=str(out_dir)
    ) as universe_tmp:
        candle_tmp_path = Path(candle_tmp.name)
        universe_tmp_path = Path(universe_tmp.name)
        for symbol in sorted(clean_rows_by_symbol):
            rolling_values = deque(maxlen=20)
            for row in sorted(clean_rows_by_symbol[symbol], key=lambda item: item["dateKey"]):
                trading_value = int(row["_closeFloat"] * row["volume"])
                rolling_values.append(trading_value)
                avg20 = int(sum(rolling_values) / len(rolling_values))
                market_cap = int(row["_closeFloat"] * row["_shares"])
                candle_row = {key: row[key] for key in ("symbol", "dateKey", "open", "high", "low", "close", "volume")}
                universe_row = {
                    "symbol": symbol,
                    "tradingDateKey": row["dateKey"],
                    "avgTradingValue20d": avg20,
                    "marketCapKrw": market_cap,
                }
                candle_tmp.write(compact_json(candle_row))
                candle_tmp.write("\n")
                universe_tmp.write(compact_json(universe_row))
                universe_tmp.write("\n")
                kept_rows += 1

    shutil.move(str(candle_tmp_path), str(out_candle))
    shutil.move(str(universe_tmp_path), str(out_universe))

    latest_common = max(kept_dates) if kept_dates else None
    failures = []
    if kept_rows < 1:
        failures.append("zero_clean_rows")
    if min_latest and (latest_common is None or latest_common < min_latest):
        failures.append(f"latest_common_date_before_required:{latest_common or 'NONE'}<{min_latest}")
    if duplicate_pair_count > 0:
        failures.append(f"duplicate_candle_pairs:{duplicate_pair_count}")

    summary = {
        "kind": "tp12_asof_clean_daily_inputs_summary_v1",
        "generatedAt": iso_now(),
        "status": "failed" if failures else "passed",
        "inputPaths": {
            "candlePath": str(candle_path),
            "lifecyclePath": str(lifecycle_path),
            "sharesPath": str(shares_path),
        },
        "outputPaths": {
            "candlePath": str(out_candle),
            "universePath": str(out_universe),
        },
        "dateRange": {"from": date_from, "to": date_to or None},
        "inputRowCount": input_rows,
        "dateFilteredRowCount": date_filtered_rows,
        "keptRowCount": kept_rows,
        "keptSymbolCount": len(kept_symbol_count),
        "keptDateCount": len(kept_dates),
        "latestCommonDate": latest_common,
        "droppedMissingLifecycleRowCount": dropped_missing_lifecycle,
        "droppedInactiveLifecycleRowCount": dropped_inactive_lifecycle,
        "droppedMissingSharesRowCount": dropped_missing_shares,
        "duplicatePairCount": duplicate_pair_count,
        "unsortedInputAccepted": unsorted_inputAccepted,
        "nonMonotonicSymbolRowCount": non_monotonic_symbol_count,
        "topDroppedSymbols": [
            {"symbol": symbol, "rowCount": count}
            for symbol, count in sorted(dropped_symbol_counts.items(), key=lambda item: (-item[1], item[0]))[:100]
        ],
        "failures": failures,
    }
    write_json(summary_out, summary)
    print(
        "DONE build_tp12_asof_clean_daily_inputs "
        f"status={summary['status']} kept_rows={kept_rows} latest_common={latest_common} out_dir={out_dir}",
        flush=True,
    )
    if failures:
        raise SystemExit("tp12 as-of clean input build failed: " + "; ".join(failures))


if __name__ == "__main__":
    main()
