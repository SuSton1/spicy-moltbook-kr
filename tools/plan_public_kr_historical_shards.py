#!/usr/bin/env python3

import argparse
from pathlib import Path

from fill_public_kr_daily import iso_now_utc, parse_day
from public_kr_historical_common import load_historical_lifecycle, stable_symbol_shard, write_json
from public_kr_historical_source_manifest import build_source_manifest_row, summarize_source_manifest


def parse_args():
    parser = argparse.ArgumentParser(description="Plan symbol shard assignments for historical KR backfill.")
    parser.add_argument("--from", dest="date_from", required=True)
    parser.add_argument("--to", dest="date_to", required=True)
    parser.add_argument("--lifecycle-path", default="data/historical_symbol_lifecycle.jsonl")
    parser.add_argument("--shard-count", type=int, default=5)
    parser.add_argument("--security-type", default="COMMON")
    parser.add_argument("--active-candle-provider", choices=("yahoo", "krx"), default="yahoo")
    parser.add_argument("--summary-out", default="")
    return parser.parse_args()


def main():
    args = parse_args()
    day_from = parse_day(args.date_from)
    day_to = parse_day(args.date_to)
    rows = load_historical_lifecycle(
        args.lifecycle_path,
        day_from=day_from,
        day_to=day_to,
        shard_index=None,
        shard_count=None,
        security_type=args.security_type,
    )
    shard_counts = {f"shard={idx}": {"symbolCount": 0, "rows": []} for idx in range(max(1, int(args.shard_count or 1)))}
    for symbol, row in rows.items():
        shard_id = f"shard={stable_symbol_shard(symbol, args.shard_count)}"
        shard_counts[shard_id]["symbolCount"] += 1
        shard_counts[shard_id]["rows"].append(
            build_source_manifest_row(row, active_candle_provider=args.active_candle_provider)
        )
    payload = {
        "kind": "public_kr_historical_shard_plan_v1",
        "generatedAt": iso_now_utc(),
        "from": args.date_from,
        "to": args.date_to,
        "lifecyclePath": str(Path(args.lifecycle_path).resolve()),
        "securityType": args.security_type,
        "activeCandleProvider": args.active_candle_provider,
        "shardCount": int(args.shard_count),
        "symbolCount": len(rows),
        "sourceCounts": summarize_source_manifest(
            [build_source_manifest_row(row, active_candle_provider=args.active_candle_provider) for row in rows.values()]
        ),
        "shards": [
            {
                "id": key,
                "symbolCount": shard_counts[key]["symbolCount"],
                "sourceCounts": summarize_source_manifest(shard_counts[key]["rows"]),
            }
            for key in sorted(shard_counts)
        ],
    }
    if str(args.summary_out or "").strip():
        write_json(args.summary_out, payload)
    else:
        print(payload)


if __name__ == "__main__":
    main()
