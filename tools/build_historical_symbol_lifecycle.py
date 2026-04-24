#!/usr/bin/env python3

import argparse

from fill_public_kr_daily import parse_day
from public_kr_historical_inputs_common import (
    LIFECYCLE_SUMMARY_KIND,
    build_summary,
    iso_now_utc,
    load_fdr_delisting_rows,
    load_kind_current_list_rows,
    load_krx_finder_maps,
    log,
    normalize_kind_market_code,
    normalize_kind_symbol,
    parse_date_text,
    sort_rows,
    to_date_key,
    write_json,
    write_jsonl,
    write_summary,
)


def parse_args():
    parser = argparse.ArgumentParser(description="Build historical symbol lifecycle artifact for KR common stock backfill.")
    parser.add_argument("--from", dest="date_from", required=True)
    parser.add_argument("--to", dest="date_to", required=True)
    parser.add_argument("--output", default="data/historical_symbol_lifecycle.jsonl")
    parser.add_argument("--summary-out", default="")
    parser.add_argument("--audit-dir", default="artifacts/backfill/public_kr_historical_inputs")
    parser.add_argument("--retries", type=int, default=4)
    parser.add_argument("--sleep-ms", type=int, default=250)
    return parser.parse_args()


def row_intersects_range(*, listed_from, delisted_on, day_from, day_to):
    if listed_from is None:
        return False
    if listed_from > day_to:
        return False
    if delisted_on is not None and delisted_on < day_from:
        return False
    return True


def merge_lifecycle_row(by_symbol, row):
    symbol = row["symbol"]
    existing = by_symbol.get(symbol)
    if existing is None:
        by_symbol[symbol] = dict(row)
        return
    if row["listedFrom"] < existing["listedFrom"]:
        existing["listedFrom"] = row["listedFrom"]
    existing_delisted = str(existing.get("delistedOn") or "").strip()
    row_delisted = str(row.get("delistedOn") or "").strip()
    if row_delisted and (not existing_delisted or row_delisted > existing_delisted):
        existing["delistedOn"] = row_delisted
    if not str(existing.get("name") or "").strip() and str(row.get("name") or "").strip():
        existing["name"] = row["name"]
    existing_market = str(existing.get("marketCode") or "").strip()
    row_market = str(row.get("marketCode") or "").strip()
    if existing_market and row_market and existing_market != row_market:
        existing["marketCode"] = "ALL"
    elif not existing_market and row_market:
        existing["marketCode"] = row_market
    existing_full_code = str(existing.get("fullCode") or "").strip()
    row_full_code = str(row.get("fullCode") or "").strip()
    if existing_full_code and row_full_code and existing_full_code != row_full_code:
        existing["fullCode"] = "__CONFLICT__"
    elif not existing_full_code and row_full_code:
        existing["fullCode"] = row_full_code
    existing_sources = [part for part in str(existing.get("source") or "").split("|") if part]
    if row["source"] not in existing_sources:
        existing_sources.append(row["source"])
    existing["source"] = "|".join(existing_sources)


def build_current_rows(kind_rows, *, day_from, day_to, listed_finder_map):
    rows = []
    skipped = []
    for raw in kind_rows:
        symbol = normalize_kind_symbol(raw.get("종목코드"))
        market_code = normalize_kind_market_code(raw.get("시장구분"))
        listed_from = parse_date_text(raw.get("상장일"))
        if symbol is None:
            skipped.append({"reason": "invalid_symbol", "symbol": raw.get("종목코드"), "name": raw.get("회사명")})
            continue
        if market_code is None:
            skipped.append({"reason": "unsupported_market", "symbol": symbol, "name": raw.get("회사명")})
            continue
        if not row_intersects_range(listed_from=listed_from, delisted_on=None, day_from=day_from, day_to=day_to):
            continue
        rows.append(
            {
                "symbol": symbol,
                "name": str(raw.get("회사명") or "").strip() or symbol,
                "marketCode": market_code,
                "fullCode": ((listed_finder_map.get(symbol) or {}).get("fullCode")),
                "type": "COMMON",
                "listedFrom": to_date_key(listed_from),
                "delistedOn": None,
                "source": "kind_current_list",
            }
        )
    return rows, skipped


def build_delisted_rows(fdr_rows, *, day_from, day_to, source_name, delisted_finder_map):
    rows = []
    skipped = []
    for raw in fdr_rows:
        symbol = normalize_kind_symbol(raw.get("Symbol"))
        market_code = normalize_kind_market_code(raw.get("Market"))
        listed_from = parse_date_text(raw.get("ListingDate"))
        delisted_on = parse_date_text(raw.get("DelistingDate"))
        secu_group = str(raw.get("SecuGroup") or "").strip()
        if symbol is None:
            skipped.append({"reason": "invalid_symbol", "symbol": raw.get("Symbol"), "name": raw.get("Name")})
            continue
        if market_code is None:
            skipped.append({"reason": "unsupported_market", "symbol": symbol, "name": raw.get("Name")})
            continue
        if secu_group and "주권" not in secu_group:
            skipped.append({"reason": "unsupported_security_group", "symbol": symbol, "name": raw.get("Name")})
            continue
        full_code = str(((delisted_finder_map.get(symbol) or {}).get("fullCode")) or "").strip()
        if not full_code:
            skipped.append({"reason": "missing_krx_delisted_full_code", "symbol": symbol, "name": raw.get("Name")})
            continue
        if not row_intersects_range(
            listed_from=listed_from,
            delisted_on=delisted_on,
            day_from=day_from,
            day_to=day_to,
        ):
            continue
        rows.append(
            {
                "symbol": symbol,
                "name": str(raw.get("Name") or "").strip() or symbol,
                "marketCode": market_code,
                "fullCode": full_code,
                "type": "COMMON",
                "listedFrom": to_date_key(listed_from),
                "delistedOn": to_date_key(delisted_on),
                "source": source_name,
            }
        )
    return rows, skipped


def main():
    args = parse_args()
    day_from = parse_day(args.date_from)
    day_to = parse_day(args.date_to)
    if day_from > day_to:
        raise SystemExit(f"invalid date range: from={args.date_from} to={args.date_to}")

    log(
        "START build_historical_symbol_lifecycle "
        f"from={to_date_key(day_from)} to={to_date_key(day_to)}"
    )

    kind_rows = load_kind_current_list_rows(retries=args.retries, sleep_ms=args.sleep_ms)
    delisting_rows, delisting_meta = load_fdr_delisting_rows(retries=args.retries, sleep_ms=args.sleep_ms)
    finder_maps = load_krx_finder_maps(retries=args.retries, sleep_ms=args.sleep_ms)

    current_rows, skipped_current = build_current_rows(
        kind_rows,
        day_from=day_from,
        day_to=day_to,
        listed_finder_map=finder_maps["listed"],
    )
    delisted_rows, skipped_delisted = build_delisted_rows(
        delisting_rows,
        day_from=day_from,
        day_to=day_to,
        source_name=f"fdr_delisting_cache:{delisting_meta['name']}",
        delisted_finder_map=finder_maps["delisted"],
    )

    by_symbol = {}
    for row in current_rows:
        merge_lifecycle_row(by_symbol, row)
    for row in delisted_rows:
        merge_lifecycle_row(by_symbol, row)

    rows = sort_rows(by_symbol.values(), ("symbol",))
    audit_paths = {}
    skipped_path = write_json(
        f"{args.audit_dir.rstrip('/')}/historical_symbol_lifecycle_skipped_rows.json",
        {
            "kind": "public_kr_historical_lifecycle_skipped_rows_v1",
            "generatedAt": iso_now_utc(),
            "from": args.date_from,
            "to": args.date_to,
            "currentSkippedCount": len(skipped_current),
            "delistedSkippedCount": len(skipped_delisted),
            "currentSkipped": sort_rows(skipped_current, ("symbol", "reason")),
            "delistedSkipped": sort_rows(skipped_delisted, ("symbol", "reason")),
            "delistingSource": delisting_meta,
        },
    )
    audit_paths["skippedRows"] = str(skipped_path)

    if not rows:
        summary = build_summary(
            LIFECYCLE_SUMMARY_KIND,
            args=args,
            row_count=0,
            symbol_count=0,
            audit_paths=audit_paths,
            failure_reason="zero lifecycle symbols resolved",
            extra={"delistingSource": delisting_meta},
        )
        write_summary(args, summary)
        raise SystemExit("historical lifecycle build failed: zero lifecycle symbols resolved")
    if not delisted_rows:
        summary = build_summary(
            LIFECYCLE_SUMMARY_KIND,
            args=args,
            row_count=0,
            symbol_count=len(rows),
            audit_paths=audit_paths,
            failure_reason="zero delisted lifecycle symbols resolved",
            extra={"delistingSource": delisting_meta},
        )
        write_summary(args, summary)
        raise SystemExit("historical lifecycle build failed: zero delisted lifecycle symbols resolved")

    invalid_ranges = [
        row for row in rows if str(row.get("delistedOn") or "").strip() and row["listedFrom"] > row["delistedOn"]
    ]
    conflicting_full_codes = [row for row in rows if str(row.get("fullCode") or "").strip() == "__CONFLICT__"]
    if invalid_ranges:
        invalid_path = write_json(
            f"{args.audit_dir.rstrip('/')}/historical_symbol_lifecycle_invalid_ranges.json",
            {
                "kind": "public_kr_historical_lifecycle_invalid_ranges_v1",
                "generatedAt": iso_now_utc(),
                "symbolCount": len(invalid_ranges),
                "symbols": invalid_ranges,
            },
        )
        audit_paths["invalidRanges"] = str(invalid_path)
        summary = build_summary(
            LIFECYCLE_SUMMARY_KIND,
            args=args,
            row_count=0,
            symbol_count=len(rows),
            audit_paths=audit_paths,
            failure_reason="invalid lifecycle ranges",
            extra={"delistingSource": delisting_meta},
        )
        write_summary(args, summary)
        raise SystemExit("historical lifecycle build failed: invalid lifecycle ranges")
    if conflicting_full_codes:
        conflict_path = write_json(
            f"{args.audit_dir.rstrip('/')}/historical_symbol_lifecycle_conflicting_full_codes.json",
            {
                "kind": "public_kr_historical_lifecycle_conflicting_full_codes_v1",
                "generatedAt": iso_now_utc(),
                "symbolCount": len(conflicting_full_codes),
                "symbols": conflicting_full_codes,
            },
        )
        audit_paths["conflictingFullCodes"] = str(conflict_path)
        summary = build_summary(
            LIFECYCLE_SUMMARY_KIND,
            args=args,
            row_count=0,
            symbol_count=len(rows),
            audit_paths=audit_paths,
            failure_reason="conflicting lifecycle full codes",
            extra={"delistingSource": delisting_meta},
        )
        write_summary(args, summary)
        raise SystemExit("historical lifecycle build failed: conflicting lifecycle full codes")

    write_jsonl(args.output, rows)
    summary = build_summary(
        LIFECYCLE_SUMMARY_KIND,
        args=args,
        row_count=len(rows),
        symbol_count=len(rows),
        audit_paths=audit_paths,
        extra={
            "currentSymbolCount": len(current_rows),
            "delistedSymbolCount": len(delisted_rows),
            "currentSkippedCount": len(skipped_current),
            "delistedSkippedCount": len(skipped_delisted),
            "delistingSource": delisting_meta,
        },
    )
    write_summary(args, summary)
    log(
        "DONE build_historical_symbol_lifecycle "
        f"output={args.output} symbols={len(rows)} current={len(current_rows)} delisted={len(delisted_rows)}"
    )


if __name__ == "__main__":
    main()
