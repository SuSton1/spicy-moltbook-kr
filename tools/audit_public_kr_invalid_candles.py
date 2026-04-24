#!/usr/bin/env python3

import argparse
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from fill_public_kr_daily import (
    INVALID_CANDLE_AUDIT_DIR,
    build_invalid_candle_symbol_report,
    classify_invalid_candle_row,
    read_symbol_master,
    sanitize_reason_key,
)


def parse_args():
    parser = argparse.ArgumentParser(
        description="Audit existing candle_daily.jsonl for invalid placeholder/impossible candle rows.",
    )
    parser.add_argument("--data-dir", default="data")
    parser.add_argument("--audit-dir", default=INVALID_CANDLE_AUDIT_DIR)
    parser.add_argument("--from", dest="date_from")
    parser.add_argument("--to", dest="date_to")
    return parser.parse_args()


def load_symbol_meta(symbol_master_path):
    _, by_symbol = read_symbol_master(symbol_master_path)
    out = {}
    for symbol, row in by_symbol.items():
        out[str(symbol).strip()] = {
            "name": str(row.get("name") or symbol).strip() or str(symbol).strip(),
            "type": str(row.get("type") or "").strip() or None,
            "isListed": bool(row.get("isListed", True)),
        }
    return out


def load_universe_pairs(universe_path, date_from=None, date_to=None):
    pairs = set()
    if not universe_path.exists():
        return pairs
    with open(universe_path, encoding="utf-8") as fh:
        for line in fh:
            row = json.loads(line)
            symbol = str(row.get("symbol") or "").strip()
            date_key = str(row.get("tradingDateKey") or "").strip()
            if not symbol or not date_key:
                continue
            if date_from and date_key < date_from:
                continue
            if date_to and date_key > date_to:
                continue
            pairs.add((symbol, date_key))
    return pairs


def main():
    args = parse_args()
    root = Path.cwd()
    data_dir = root / args.data_dir
    candle_path = data_dir / "candle_daily.jsonl"
    universe_path = data_dir / "universe_daily.jsonl"
    symbol_master_path = data_dir / "symbol_master.jsonl"
    if not candle_path.exists():
        raise SystemExit(f"missing candle path: {candle_path}")

    symbol_meta = load_symbol_meta(symbol_master_path)
    universe_pairs = load_universe_pairs(universe_path, args.date_from, args.date_to)

    reports_by_symbol = {}
    date_counts = defaultdict(int)
    reason_counts = defaultdict(int)
    invalid_universe_pairs = 0
    invalid_row_count = 0

    with open(candle_path, encoding="utf-8") as fh:
        for line in fh:
            row = json.loads(line)
            symbol = str(row.get("symbol") or "").strip()
            date_key = str(row.get("dateKey") or "").strip()
            if not symbol or not date_key:
                continue
            if args.date_from and date_key < args.date_from:
                continue
            if args.date_to and date_key > args.date_to:
                continue
            reason = classify_invalid_candle_row(row)
            if not reason:
                continue
            invalid_row = {
                "dateKey": date_key,
                "open": row.get("open"),
                "high": row.get("high"),
                "low": row.get("low"),
                "close": row.get("close"),
                "volume": row.get("volume"),
                "reason": reason,
                "matchedUniverseRow": (symbol, date_key) in universe_pairs,
            }
            invalid_row_count += 1
            reason_counts[sanitize_reason_key(reason)] += 1
            date_counts[date_key] += 1
            if invalid_row["matchedUniverseRow"]:
                invalid_universe_pairs += 1
            report = reports_by_symbol.setdefault(
                symbol,
                build_invalid_candle_symbol_report(
                    symbol=symbol,
                    source_name="existing_candle_daily",
                    invalid_rows=[],
                    metadata=symbol_meta.get(symbol) or {},
                ),
            )
            report["rows"].append(invalid_row)
            report["invalidRowCount"] += 1
            report["reasonCounts"][sanitize_reason_key(reason)] = int(
                report["reasonCounts"].get(sanitize_reason_key(reason), 0)
            ) + 1

    generated_at = datetime.now(timezone.utc)
    audit_root = root / args.audit_dir
    audit_root.mkdir(parents=True, exist_ok=True)
    out = {
        "kind": "historical_invalid_candle_audit_v1",
        "generatedAt": generated_at.isoformat(),
        "dataPath": str(candle_path),
        "universePath": str(universe_path),
        "dateRange": {
            "from": args.date_from or None,
            "to": args.date_to or None,
        },
        "invalidSymbolCount": len(reports_by_symbol),
        "invalidRowCount": invalid_row_count,
        "invalidUniversePairCount": invalid_universe_pairs,
        "reasonCounts": {key: int(reason_counts[key]) for key in sorted(reason_counts)},
        "topDates": [
            {"dateKey": date_key, "invalidRowCount": int(count)}
            for date_key, count in sorted(date_counts.items(), key=lambda item: (-item[1], item[0]))[:50]
        ],
        "symbols": sorted(reports_by_symbol.values(), key=lambda row: (row.get("symbol") or "")),
    }
    filename = (
        "historical_invalid_candle_audit_"
        f"{(args.date_from or 'BEGIN').replace('-', '')}_"
        f"{(args.date_to or 'END').replace('-', '')}_"
        f"{generated_at.strftime('%Y%m%d_%H%M%S')}.json"
    )
    out_path = audit_root / filename
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=2)
        fh.write("\n")

    print(
        "AUDIT historical_invalid_candle_audit "
        f"invalid_symbols={len(reports_by_symbol)} invalid_rows={invalid_row_count} "
        f"invalid_universe_pairs={invalid_universe_pairs} audit={out_path}",
        flush=True,
    )


if __name__ == "__main__":
    main()
