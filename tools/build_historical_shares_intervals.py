#!/usr/bin/env python3

import argparse
from datetime import datetime, timedelta
from pathlib import Path

from fill_public_kr_daily import parse_day, parse_int
from public_kr_historical_inputs_common import (
    SHARES_SUMMARY_KIND,
    build_summary,
    iter_jsonl,
    log,
    log_progress,
    sort_rows,
    to_date_key,
    write_json,
    write_jsonl,
    write_summary,
)
from public_kr_historical_common import lifecycle_intersects
from public_kr_krx_curl_client import KRX_AUTH_MODE_LOGIN_REQUIRED, KrxCurlClient
from public_kr_historical_source_manifest import (
    SHARES_SOURCE_ACTIVE_KRX,
    SHARES_SOURCE_DELISTED_KRX,
    build_source_manifest_row,
)

def parse_args():
    parser = argparse.ArgumentParser(description="Build historical shares interval artifact for KR backfill.")
    parser.add_argument("--from", dest="date_from", required=True)
    parser.add_argument("--to", dest="date_to", required=True)
    parser.add_argument("--lifecycle-path", default="data/historical_symbol_lifecycle.jsonl")
    parser.add_argument("--output", default="data/historical_shares_intervals.jsonl")
    parser.add_argument("--summary-out", default="")
    parser.add_argument("--audit-dir", default="artifacts/backfill/public_kr_historical_inputs")
    parser.add_argument("--max-workers", type=int, default=1)
    parser.add_argument("--krx-max-workers", type=int, default=1)
    parser.add_argument("--krx-auth-mode", default=KRX_AUTH_MODE_LOGIN_REQUIRED)
    parser.add_argument("--retries", type=int, default=4)
    parser.add_argument("--sleep-ms", type=int, default=250)
    parser.add_argument("--krx-min-interval-ms", type=int, default=1000)
    parser.add_argument("--krx-cooldown-ms", type=int, default=60000)
    parser.add_argument("--checkpoint-every", type=int, default=100)
    return parser.parse_args()


def load_symbols(path, day_from, day_to):
    rows = []
    for row in iter_jsonl(path):
        symbol = str(row.get("symbol") or "").strip()
        if not symbol or not symbol.isdigit() or len(symbol) != 6:
            raise ValueError(f"invalid lifecycle symbol: {symbol or '<empty>'}")
        intersection = lifecycle_intersects(row, day_from, day_to)
        if intersection is None:
            continue
        listed_from = parse_day(intersection["listedFrom"])
        delisted_on_raw = str(intersection.get("delistedOn") or "").strip()
        delisted_on = parse_day(delisted_on_raw) if delisted_on_raw else None
        effective_from = parse_day(intersection["effectiveFrom"])
        effective_to = parse_day(intersection["effectiveTo"])
        manifest = build_source_manifest_row(row)
        rows.append(
            {
                "symbol": symbol,
                "name": str(row.get("name") or "").strip() or symbol,
                "fullCode": str(row.get("fullCode") or "").strip() or None,
                "marketCode": str(row.get("marketCode") or "").strip() or None,
                "listedFrom": to_date_key(listed_from),
                "delistedOn": to_date_key(delisted_on) if delisted_on else None,
                "effectiveFrom": to_date_key(effective_from),
                "effectiveTo": to_date_key(effective_to),
                "sharesSource": manifest["sharesSource"],
            }
        )
    return sort_rows(rows, ("symbol",))


def compress_intervals(symbol, *, points, effective_from, effective_to, source_name):
    if not points:
        raise ValueError(f"missing share points symbol={symbol}")
    sorted_points = sorted(points, key=lambda row: row["dateKey"])
    seed_point = None
    future_points = []
    for point in sorted_points:
        point_day = parse_day(point["dateKey"])
        if point_day <= effective_from:
            seed_point = point
            continue
        if point_day <= effective_to:
            future_points.append(point)
    if seed_point is None:
        raise ValueError(
            f"missing pre-range share point symbol={symbol} "
            f"effective_from={to_date_key(effective_from)}"
        )

    intervals = []
    current_from = effective_from
    current_shares = int(seed_point["sharesOutstanding"])
    for point in future_points:
        point_day = parse_day(point["dateKey"])
        interval_to = point_day - timedelta(days=1)
        if current_from <= interval_to:
            intervals.append(
                {
                    "symbol": symbol,
                    "effectiveFrom": to_date_key(current_from),
                    "effectiveTo": to_date_key(interval_to),
                    "sharesOutstanding": current_shares,
                    "source": source_name,
                }
            )
        current_from = point_day
        current_shares = int(point["sharesOutstanding"])
    intervals.append(
        {
            "symbol": symbol,
            "effectiveFrom": to_date_key(current_from),
            "effectiveTo": to_date_key(effective_to),
            "sharesOutstanding": current_shares,
            "source": source_name,
        }
    )
    return intervals


def normalize_krx_date_key(raw):
    text = str(raw or "").strip()
    for fmt in ("%Y/%m/%d", "%Y-%m-%d", "%Y%m%d"):
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    raise ValueError(f"invalid KRX date key: {raw}")


def parse_krx_shares_from_row(row):
    direct = parse_int(row.get("LIST_SHRS") or row.get("Shares"))
    if direct is not None and direct > 0:
        return int(direct)
    market_cap = parse_int(row.get("MKTCAP") or row.get("MarCap"))
    close_price = parse_int(row.get("TDD_CLSPRC") or row.get("Close"))
    if market_cap is None or close_price is None or close_price <= 0:
        raise ValueError("missing LIST_SHRS and cannot derive from MKTCAP/Close")
    if market_cap % close_price != 0:
        raise ValueError(f"MKTCAP/Close not integral market_cap={market_cap} close={close_price}")
    shares = int(market_cap // close_price)
    if shares <= 0:
        raise ValueError(f"invalid derived shares={shares}")
    return shares


def build_krx_share_points(rows):
    points = []
    for row in rows or []:
        points.append(
            {
                "dateKey": normalize_krx_date_key(row.get("TRD_DD") or row.get("Date")),
                "sharesOutstanding": parse_krx_shares_from_row(row),
            }
        )
    if not points:
        raise ValueError("empty_krx_share_points")
    points.sort(key=lambda row: row["dateKey"])
    deduped = {}
    for row in points:
        deduped[row["dateKey"]] = row
    return [deduped[key] for key in sorted(deduped)]


def build_krx_client(*, retries, sleep_ms, auth_mode, min_interval_ms, cooldown_ms):
    return KrxCurlClient(
        retries=retries,
        sleep_ms=sleep_ms,
        trace_dir="",
        auth_mode=auth_mode,
        min_interval_ms=min_interval_ms,
        cooldown_403_ms=cooldown_ms,
    )


def build_missing_symbol_row(row, exc):
    return {
        "symbol": row["symbol"],
        "name": row["name"],
        "marketCode": row["marketCode"],
        "listedFrom": row["listedFrom"],
        "delistedOn": row["delistedOn"],
        "reason": f"{type(exc).__name__}:{exc}",
    }


def has_pre_range_share_point(points, effective_from):
    boundary = to_date_key(effective_from)
    for point in points or []:
        if str(point.get("dateKey") or "").strip() <= boundary:
            return True
    return False


def build_checkpoint_path(output_path):
    return Path(f"{output_path}.checkpoint.jsonl")


def load_checkpoint_rows(path):
    checkpoint_path = Path(path)
    if not checkpoint_path.exists():
        return []
    return list(iter_jsonl(checkpoint_path))


def write_checkpoint_rows(path, rows):
    write_jsonl(str(path), rows)


def process_symbol_rows(
    *,
    rows,
    client,
    fetch_fn,
    progress_prefix,
    progress_every,
    intervals,
    checkpoint_path,
    checkpoint_every,
):
    unresolved = []
    success = 0
    processed = 0
    pending_checkpoint = 0
    total = len(rows)
    for row in rows:
        processed += 1
        try:
            symbol_intervals = fetch_fn(row, client)
        except Exception as exc:
            unresolved.append((row, exc))
            continue
        intervals.extend(symbol_intervals)
        success += 1
        pending_checkpoint += 1
        if pending_checkpoint >= max(1, int(checkpoint_every or 1)):
            write_checkpoint_rows(checkpoint_path, intervals)
            pending_checkpoint = 0
        if processed % max(1, int(progress_every or 1)) == 0 or processed == total:
            log_progress(
                progress_prefix,
                processed=processed,
                total=total,
                extra=f"success={success}",
            )
    if pending_checkpoint > 0:
        write_checkpoint_rows(checkpoint_path, intervals)
    return unresolved, success


def fetch_krx_symbol_with_seed_lookback(row, client, *, fetch_range_fn, source_prefix):
    full_code = str(row.get("fullCode") or "").strip()
    if not full_code:
        raise RuntimeError(f"missing_{source_prefix}_full_code")
    listed_from = parse_day(row["listedFrom"])
    effective_from = parse_day(row["effectiveFrom"])
    effective_to = parse_day(row["effectiveTo"])
    lookback_days = 7
    attempted_fetch_from = set()
    last_exc = None
    while True:
        fetch_from = max(listed_from, effective_from - timedelta(days=lookback_days))
        fetch_from_key = fetch_from.isoformat()
        if fetch_from_key in attempted_fetch_from:
            break
        attempted_fetch_from.add(fetch_from_key)
        try:
            rows = fetch_range_fn(
                full_code=full_code,
                date_from=fetch_from_key,
                date_to=row["effectiveTo"],
            )
            points = build_krx_share_points(rows)
            if has_pre_range_share_point(points, effective_from):
                return compress_intervals(
                    row["symbol"],
                    points=points,
                    effective_from=effective_from,
                    effective_to=effective_to,
                    source_name=f"krx.{source_prefix}:{full_code}",
                )
            last_exc = ValueError(
                f"missing pre-range share point symbol={row['symbol']} "
                f"source={source_prefix} fetch_from={fetch_from_key} effective_from={row['effectiveFrom']}"
            )
        except Exception as exc:
            last_exc = exc
        if fetch_from <= listed_from:
            break
        remaining_days = max(0, (effective_from - listed_from).days)
        next_lookback_days = max(lookback_days * 2, 14)
        if remaining_days > 0:
            next_lookback_days = min(next_lookback_days, remaining_days)
        if next_lookback_days <= lookback_days:
            next_lookback_days = remaining_days
        if next_lookback_days <= lookback_days:
            break
        lookback_days = next_lookback_days
    if last_exc is not None:
        raise last_exc
    raise RuntimeError(
        f"unable to seed KRX share range symbol={row['symbol']} source={source_prefix} full_code={full_code}"
    )


def fetch_active_krx_symbol(row, client):
    return fetch_krx_symbol_with_seed_lookback(
        row,
        client,
        fetch_range_fn=client.fetch_active_price_range,
        source_prefix="active_price",
    )


def fetch_delisted_krx_symbol(row, client):
    return fetch_krx_symbol_with_seed_lookback(
        row,
        client,
        fetch_range_fn=client.fetch_delisted_price_range,
        source_prefix="delisted_price",
    )


def main():
    args = parse_args()
    day_from = parse_day(args.date_from)
    day_to = parse_day(args.date_to)
    if day_from > day_to:
        raise SystemExit(f"invalid date range: from={args.date_from} to={args.date_to}")

    symbols = load_symbols(args.lifecycle_path, day_from, day_to)
    if not symbols:
        raise SystemExit(f"no lifecycle symbols found in range from={args.date_from} to={args.date_to}")
    if max(1, int(args.max_workers or 1)) != 1 or max(1, int(args.krx_max_workers or 1)) != 1:
        raise SystemExit(
            "historical shares build requires single-session KRX execution. "
            "Set --max-workers=1 and --krx-max-workers=1."
        )

    checkpoint_path = build_checkpoint_path(args.output)
    intervals = load_checkpoint_rows(checkpoint_path)
    completed_symbols = {str(row.get("symbol") or "").strip() for row in intervals}

    active_rows_all = [row for row in symbols if row["sharesSource"] == SHARES_SOURCE_ACTIVE_KRX]
    delisted_rows_all = [row for row in symbols if row["sharesSource"] == SHARES_SOURCE_DELISTED_KRX]
    active_rows = [row for row in active_rows_all if row["symbol"] not in completed_symbols]
    delisted_rows = [row for row in delisted_rows_all if row["symbol"] not in completed_symbols]
    completed_active = sum(1 for row in active_rows_all if row["symbol"] in completed_symbols)
    completed_delisted = sum(1 for row in delisted_rows_all if row["symbol"] in completed_symbols)
    client = build_krx_client(
        retries=args.retries,
        sleep_ms=args.sleep_ms,
        auth_mode=args.krx_auth_mode,
        min_interval_ms=args.krx_min_interval_ms,
        cooldown_ms=args.krx_cooldown_ms,
    )

    log(
        "START build_historical_shares_intervals "
        f"from={to_date_key(day_from)} to={to_date_key(day_to)} symbols={len(symbols)} "
        f"active={len(active_rows)} delisted={len(delisted_rows)} "
        f"krx_min_interval_ms={int(args.krx_min_interval_ms or 0)}"
    )
    if completed_symbols:
        log(
            "RESUME build_historical_shares_intervals "
            f"checkpoint={checkpoint_path} completed_symbols={len(completed_symbols)} "
            f"remaining_active={len(active_rows)} remaining_delisted={len(delisted_rows)}"
        )

    success = len(completed_symbols)
    delisted_success = completed_delisted
    failed_active_rows, active_success = process_symbol_rows(
        rows=active_rows,
        client=client,
        fetch_fn=fetch_active_krx_symbol,
        progress_prefix="build_historical_shares_intervals",
        progress_every=100,
        intervals=intervals,
        checkpoint_path=checkpoint_path,
        checkpoint_every=args.checkpoint_every,
    )
    success += active_success

    failed_delisted_rows, delisted_new_success = process_symbol_rows(
        rows=delisted_rows,
        client=client,
        fetch_fn=fetch_delisted_krx_symbol,
        progress_prefix="build_historical_shares_intervals_delisted",
        progress_every=50,
        intervals=intervals,
        checkpoint_path=checkpoint_path,
        checkpoint_every=args.checkpoint_every,
    )
    success += delisted_new_success
    delisted_success += delisted_new_success

    if failed_active_rows or failed_delisted_rows:
        retry_client = build_krx_client(
            retries=args.retries,
            sleep_ms=args.sleep_ms,
            auth_mode=args.krx_auth_mode,
            min_interval_ms=args.krx_min_interval_ms,
            cooldown_ms=args.krx_cooldown_ms,
        )
        if failed_active_rows:
            log(
                "RETRY build_historical_shares_intervals "
                f"active_symbols={len(failed_active_rows)} provider=krx.active_price"
            )
            failed_active_rows, retried_active_success = process_symbol_rows(
                rows=[row for row, _exc in failed_active_rows],
                client=retry_client,
                fetch_fn=fetch_active_krx_symbol,
                progress_prefix="build_historical_shares_intervals_retry_active",
                progress_every=25,
                intervals=intervals,
                checkpoint_path=checkpoint_path,
                checkpoint_every=args.checkpoint_every,
            )
            success += retried_active_success
        if failed_delisted_rows:
            log(
                "RETRY build_historical_shares_intervals_delisted "
                f"symbols={len(failed_delisted_rows)} provider=krx.delisted_price"
            )
            failed_delisted_rows, retried_delisted_success = process_symbol_rows(
                rows=[row for row, _exc in failed_delisted_rows],
                client=retry_client,
                fetch_fn=fetch_delisted_krx_symbol,
                progress_prefix="build_historical_shares_intervals_retry_delisted",
                progress_every=25,
                intervals=intervals,
                checkpoint_path=checkpoint_path,
                checkpoint_every=args.checkpoint_every,
            )
            success += retried_delisted_success
            delisted_success += retried_delisted_success

    missing_symbols = [
        build_missing_symbol_row(row, exc)
        for row, exc in [*failed_active_rows, *failed_delisted_rows]
    ]

    audit_paths = {}
    if missing_symbols:
        audit_path = write_json(
            f"{args.audit_dir.rstrip('/')}/historical_shares_missing_symbols.json",
            {
                "kind": "public_kr_historical_shares_missing_symbols_v1",
                "from": args.date_from,
                "to": args.date_to,
                "symbolCount": len(missing_symbols),
                "symbols": sort_rows(missing_symbols, ("symbol",)),
            },
        )
        audit_paths["missingSymbols"] = str(audit_path)

    if missing_symbols:
        summary = build_summary(
            SHARES_SUMMARY_KIND,
            args=args,
            row_count=0,
            symbol_count=len(symbols),
            audit_paths=audit_paths,
            failure_reason="missing historical share intervals",
            extra={
                "completedSymbolCount": success,
                "activeSymbolCount": len(active_rows),
                "delistedSymbolCount": len(delisted_rows),
                "delistedCompletedSymbolCount": delisted_success,
            },
        )
        write_summary(args, summary)
        raise SystemExit("historical shares build failed: missing source coverage")

    rows = sort_rows(intervals, ("symbol", "effectiveFrom", "effectiveTo"))
    write_jsonl(args.output, rows)
    if checkpoint_path.exists():
        checkpoint_path.unlink()
    summary = build_summary(
        SHARES_SUMMARY_KIND,
        args=args,
        row_count=len(rows),
        symbol_count=len(symbols),
        audit_paths=audit_paths,
        extra={
            "completedSymbolCount": success,
            "activeSymbolCount": len(active_rows),
            "delistedSymbolCount": len(delisted_rows),
            "delistedCompletedSymbolCount": delisted_success,
        },
    )
    write_summary(args, summary)
    log(
        "DONE build_historical_shares_intervals "
        f"output={args.output} intervals={len(rows)} symbols={len(symbols)}"
    )


if __name__ == "__main__":
    main()
