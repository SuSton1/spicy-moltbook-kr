#!/usr/bin/env python3

import argparse
import json
from datetime import timedelta

from fill_public_kr_daily import iso_now_utc, parse_day, to_date_key
from public_kr_historical_common import (
    load_historical_lifecycle,
    load_historical_share_intervals,
    resolve_share_count,
    sort_rows,
    write_json,
)


COVERAGE_SUMMARY_KIND = "public_kr_historical_shares_coverage_summary_v1"


def parse_args():
    parser = argparse.ArgumentParser(
        description=(
            "Fail-fast guard for historical shares coverage. "
            "Ensures every lifecycle symbol intersecting the requested date range has a "
            "shares interval covering each requested trading date before stage workers launch."
        )
    )
    parser.add_argument("--from", dest="date_from", required=True)
    parser.add_argument("--to", dest="date_to", required=True)
    parser.add_argument("--lifecycle-path", default="data/historical_symbol_lifecycle.jsonl")
    parser.add_argument("--shares-path", default="data/historical_shares_intervals.jsonl")
    parser.add_argument("--security-type", default="COMMON")
    parser.add_argument("--summary-out", default="")
    return parser.parse_args()


def iter_date_keys(day_from, day_to):
    cursor = day_from
    while cursor <= day_to:
        yield to_date_key(cursor)
        cursor += timedelta(days=1)


def max_share_effective_to(shares_by_symbol):
    max_key = None
    for rows in shares_by_symbol.values():
        for row in rows:
            effective_to = str(row.get("effectiveTo") or "").strip()
            if effective_to and (max_key is None or effective_to > max_key):
                max_key = effective_to
    return max_key


def build_summary(*, args, status, lifecycle_rows, shares_by_symbol, missing_symbols):
    global_max_to = max_share_effective_to(shares_by_symbol)
    return {
        "kind": COVERAGE_SUMMARY_KIND,
        "generatedAt": iso_now_utc(),
        "status": status,
        "from": str(args.date_from or "").strip(),
        "to": str(args.date_to or "").strip(),
        "lifecyclePath": args.lifecycle_path,
        "sharesPath": args.shares_path,
        "securityType": str(args.security_type or "").strip() or "COMMON",
        "lifecycleSymbolCount": len(lifecycle_rows),
        "sharesSymbolCount": len(shares_by_symbol),
        "globalMaxShareEffectiveTo": global_max_to,
        "missingShareSymbolCount": len(missing_symbols),
        "missingShareSymbols": sort_rows(missing_symbols, ("symbol",)),
        "failureReason": (
            "historical shares artifact does not fully cover requested lifecycle/date range"
            if missing_symbols
            else None
        ),
    }


def main():
    args = parse_args()
    day_from = parse_day(args.date_from)
    day_to = parse_day(args.date_to)
    if day_from > day_to:
        raise SystemExit(f"invalid date range: from={args.date_from} to={args.date_to}")

    lifecycle_rows = load_historical_lifecycle(
        args.lifecycle_path,
        day_from=day_from,
        day_to=day_to,
        security_type=args.security_type,
    )
    shares_by_symbol = load_historical_share_intervals(args.shares_path)

    missing_symbols = []
    for symbol, metadata in sorted(lifecycle_rows.items()):
        effective_from = parse_day(metadata["effectiveFrom"])
        effective_to = parse_day(metadata["effectiveTo"])
        first_missing_date = None
        missing_date_count = 0
        for date_key in iter_date_keys(effective_from, effective_to):
            if resolve_share_count(shares_by_symbol, symbol, date_key) is not None:
                continue
            if first_missing_date is None:
                first_missing_date = date_key
            missing_date_count += 1
        if first_missing_date is None:
            continue
        missing_symbols.append(
            {
                "symbol": symbol,
                "name": metadata["name"],
                "marketCode": metadata["marketCode"],
                "listedFrom": metadata["listedFrom"],
                "delistedOn": metadata["delistedOn"],
                "effectiveFrom": metadata["effectiveFrom"],
                "effectiveTo": metadata["effectiveTo"],
                "firstMissingDate": first_missing_date,
                "missingDateCount": missing_date_count,
            }
        )

    status = "failed" if missing_symbols else "passed"
    summary = build_summary(
        args=args,
        status=status,
        lifecycle_rows=lifecycle_rows,
        shares_by_symbol=shares_by_symbol,
        missing_symbols=missing_symbols,
    )
    if str(args.summary_out or "").strip():
        write_json(args.summary_out, summary)

    if missing_symbols:
        raise SystemExit(
            "historical shares coverage guard failed: "
            f"missingShareSymbolCount={len(missing_symbols)} "
            f"globalMaxShareEffectiveTo={summary.get('globalMaxShareEffectiveTo') or '<none>'}"
        )

    print(
        "ok assert_public_kr_historical_shares_coverage "
        f"symbols={len(lifecycle_rows)} maxEffectiveTo={summary.get('globalMaxShareEffectiveTo') or '<none>'}"
    )


if __name__ == "__main__":
    main()
