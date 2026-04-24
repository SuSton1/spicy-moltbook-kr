#!/usr/bin/env python3

import argparse
import json
import shutil
from collections import defaultdict, deque
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from threading import local

from fill_public_kr_daily import (
    build_invalid_candle_symbol_report,
    build_nontrading_status_row,
    candidate_yahoo_symbols,
    fetch_chart_payload,
    iso_now_utc,
    load_filters,
    log,
    normalize_chart_rows,
    parse_int,
    parse_day,
    partition_symbol_series_rows,
    to_date_key,
    universe_passes,
    universe_reject_reason,
    write_invalid_candle_audit,
    write_nontrading_status_audit,
)
from public_kr_historical_common import (
    STAGE_SUMMARY_BASENAME,
    STAGE_SYMBOL_RESULTS_BASENAME,
    load_historical_lifecycle,
    load_historical_share_intervals,
    resolve_share_count,
    sort_rows,
    stable_symbol_shard,
    write_json,
    write_jsonl,
    write_partitioned_rows,
)
from public_kr_historical_source_manifest import (
    ACTIVE_CANDLE_PROVIDER_YAHOO,
    CANDLE_SOURCE_ACTIVE_KRX,
    CANDLE_SOURCE_ACTIVE_YAHOO,
    CANDLE_SOURCE_DELISTED_KRX,
    build_source_manifest_row,
)
from public_kr_krx_curl_client import KRX_AUTH_MODE_LOGIN_REQUIRED, KrxCurlClient


STAGE_STATUS_COMPLETED = "completed"
STAGE_STATUS_FAILED = "failed"
STAGE_SUMMARY_KIND = "public_kr_historical_stage_summary_v1"


def parse_args():
    parser = argparse.ArgumentParser(
        description=(
            "Stage historical KR daily candle/universe data using explicit lifecycle/shares artifacts. "
            "This tool is stage-only and must not write canonical data/*.jsonl."
        )
    )
    parser.add_argument("--from", dest="date_from", required=True, help="YYYY-MM-DD")
    parser.add_argument("--to", dest="date_to", required=True, help="YYYY-MM-DD")
    parser.add_argument("--config", default="config/lab.config.server.lite.json")
    parser.add_argument("--lifecycle-path", default="data/historical_symbol_lifecycle.jsonl")
    parser.add_argument("--shares-path", default="data/historical_shares_intervals.jsonl")
    parser.add_argument("--stage-root", required=True)
    parser.add_argument("--historical-candle-provider", choices=("explicit_source_plan",), default="explicit_source_plan")
    parser.add_argument("--active-candle-provider", choices=("yahoo", "krx"), default=ACTIVE_CANDLE_PROVIDER_YAHOO)
    parser.add_argument("--security-type", default="COMMON")
    parser.add_argument("--symbol-shard-index", type=int, default=0)
    parser.add_argument("--symbol-shard-count", type=int, default=1)
    parser.add_argument("--max-workers", type=int, default=3)
    parser.add_argument("--krx-auth-mode", default=KRX_AUTH_MODE_LOGIN_REQUIRED)
    parser.add_argument("--retries", type=int, default=4)
    parser.add_argument("--sleep-ms", type=int, default=250)
    parser.add_argument("--krx-min-interval-ms", type=int, default=1000)
    parser.add_argument("--krx-cooldown-ms", type=int, default=60000)
    parser.add_argument("--summary-out", default="")
    parser.add_argument("--run-id", default="")
    parser.add_argument("--worker-id", default="")
    parser.add_argument("--audit-dir", default="")
    parser.add_argument("--overwrite-stage", action="store_true")
    parser.add_argument(
        "--universe-mode",
        choices=("core_threshold", "all_common"),
        default="all_common",
    )
    return parser.parse_args()


def stage_audit_path(stage_root, audit_dir, basename):
    root = Path(stage_root)
    audit_root = root / (audit_dir or "audit")
    audit_root.mkdir(parents=True, exist_ok=True)
    return audit_root / basename


def write_stage_audit(stage_root, audit_dir, basename, payload):
    path = stage_audit_path(stage_root, audit_dir, basename)
    write_json(path, payload)
    return path


def build_summary(
    *,
    args,
    status,
    expected_symbol_count,
    fetched_symbol_count,
    candle_rows,
    universe_rows,
    nontrading_rows,
    invalid_symbol_count,
    missing_data_symbol_count,
    missing_share_symbol_count,
    unsupported_source_symbol_count,
    audit_paths,
    universe_diagnostics=None,
    failure_reason=None,
):
    active_candle_provider = str(
        getattr(args, "active_candle_provider", ACTIVE_CANDLE_PROVIDER_YAHOO) or ACTIVE_CANDLE_PROVIDER_YAHOO
    ).strip() or ACTIVE_CANDLE_PROVIDER_YAHOO
    return {
        "kind": STAGE_SUMMARY_KIND,
        "generatedAt": iso_now_utc(),
        "status": status,
        "runId": str(args.run_id or "").strip() or None,
        "workerId": str(args.worker_id or "").strip() or None,
        "from": str(args.date_from or "").strip(),
        "to": str(args.date_to or "").strip(),
        "historicalCandleProvider": str(args.historical_candle_provider or "").strip(),
        "activeCandleProvider": active_candle_provider,
        "lifecyclePath": str(Path(args.lifecycle_path).resolve()),
        "sharesPath": str(Path(args.shares_path).resolve()),
        "stageRoot": str(Path(args.stage_root).resolve()),
        "symbolShardIndex": int(args.symbol_shard_index),
        "symbolShardCount": int(args.symbol_shard_count),
        "expectedSymbolCount": int(expected_symbol_count or 0),
        "fetchedSymbolCount": int(fetched_symbol_count or 0),
        "universeMode": str(getattr(args, "universe_mode", "") or "").strip() or None,
        "candleRowCount": int(candle_rows or 0),
        "universeRowCount": int(universe_rows or 0),
        "nonTradingRowCount": int(nontrading_rows or 0),
        "universeDiagnostics": universe_diagnostics or {
            "candidateRowCount": 0,
            "passedRowCount": int(universe_rows or 0),
            "rejectedRowCount": 0,
            "rejectReasonCounts": {},
        },
        "invalidSymbolCount": int(invalid_symbol_count or 0),
        "missingDataSymbolCount": int(missing_data_symbol_count or 0),
        "missingShareSymbolCount": int(missing_share_symbol_count or 0),
        "unsupportedSourceSymbolCount": int(unsupported_source_symbol_count or 0),
        "auditPaths": {
            "fatalInvalid": str((audit_paths or {}).get("fatalInvalid") or "").strip() or None,
            "nonTradingStatus": str((audit_paths or {}).get("nonTradingStatus") or "").strip() or None,
            "missingData": str((audit_paths or {}).get("missingData") or "").strip() or None,
            "missingShares": str((audit_paths or {}).get("missingShares") or "").strip() or None,
            "unsupportedSources": str((audit_paths or {}).get("unsupportedSources") or "").strip() or None,
        },
        "failureReason": str(failure_reason or "").strip() or None,
    }


def write_summary(stage_root, summary, summary_out):
    write_json(Path(stage_root) / STAGE_SUMMARY_BASENAME, summary)
    if str(summary_out or "").strip():
        write_json(summary_out, summary)


def prepare_stage_root(stage_root, overwrite_stage):
    root = Path(stage_root)
    if root.exists():
        existing_files = [path for path in root.rglob("*") if path.is_file()]
        if existing_files and not overwrite_stage:
            raise SystemExit(f"stage root is not empty: {root}. Pass --overwrite-stage to replace it.")
        if overwrite_stage:
            shutil.rmtree(root)
    root.mkdir(parents=True, exist_ok=True)
    return root


def normalize_krx_date_key(raw):
    text = str(raw or "").strip()
    for fmt in ("%Y/%m/%d", "%Y-%m-%d", "%Y%m%d"):
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    raise ValueError(f"invalid KRX date key: {raw}")


def normalize_krx_price_rows(rows):
    out = []
    for row in rows or []:
        open_price = parse_int(row.get("TDD_OPNPRC") or row.get("Open"))
        high_price = parse_int(row.get("TDD_HGPRC") or row.get("High"))
        low_price = parse_int(row.get("TDD_LWPRC") or row.get("Low"))
        close_price = parse_int(row.get("TDD_CLSPRC") or row.get("Close"))
        volume = parse_int(row.get("ACC_TRDVOL") or row.get("Volume"))
        if None in (open_price, high_price, low_price, close_price, volume):
            continue
        out.append(
            {
                "dateKey": normalize_krx_date_key(row.get("TRD_DD") or row.get("Date")),
                "open": open_price,
                "high": high_price,
                "low": low_price,
                "close": close_price,
                "volume": volume,
            }
        )
    out.sort(key=lambda row: row["dateKey"])
    return out


def build_krx_client(*, retries, sleep_ms, auth_mode, min_interval_ms, cooldown_ms):
    return KrxCurlClient(
        retries=retries,
        sleep_ms=sleep_ms,
        trace_dir="",
        auth_mode=auth_mode,
        min_interval_ms=min_interval_ms,
        cooldown_403_ms=cooldown_ms,
    )


def fetch_active_yahoo_rows(symbol, metadata, retries, sleep_ms):
    effective_from = parse_day(metadata["effectiveFrom"])
    effective_to = parse_day(metadata["effectiveTo"])
    last_error = None
    for yahoo_symbol in candidate_yahoo_symbols(symbol, metadata.get("marketCode")):
        try:
            payload = fetch_chart_payload(yahoo_symbol, effective_from, effective_to, retries, sleep_ms)
            if payload is None:
                continue
            rows = normalize_chart_rows(payload, to_date_key(effective_from), to_date_key(effective_to))
            if not rows:
                continue
            partitioned = partition_symbol_series_rows(rows)
            if not partitioned.get("fatalRows"):
                return rows, yahoo_symbol
            last_error = RuntimeError(
                f"symbol={symbol} yahoo candidate={yahoo_symbol} fatal_invalid_rows="
                f"{len(partitioned.get('fatalRows') or [])}"
            )
        except Exception as exc:
            last_error = exc
            continue
    if last_error is not None:
        raise RuntimeError(f"symbol={symbol} historical fetch failed: {last_error}")
    return [], None


def fetch_active_krx_rows(symbol, metadata, client):
    full_code = str(metadata.get("fullCode") or "").strip()
    if not full_code:
        raise RuntimeError("missing_active_full_code")
    rows = client.fetch_active_price_range(
        full_code=full_code,
        date_from=metadata["effectiveFrom"],
        date_to=metadata["effectiveTo"],
    )
    return normalize_krx_price_rows(rows), f"krx.active_price:{full_code}"


def fetch_delisted_krx_rows(symbol, metadata, client):
    full_code = str(metadata.get("fullCode") or "").strip()
    if not full_code:
        raise RuntimeError("missing_delisted_full_code")
    rows = client.fetch_delisted_price_range(
        full_code=full_code,
        date_from=metadata["effectiveFrom"],
        date_to=metadata["effectiveTo"],
    )
    return normalize_krx_price_rows(rows), f"krx.delisted_price:{full_code}"


def record_symbol_fetch_result(
    *,
    symbol,
    metadata,
    rows,
    source_name,
    candle_rows_by_symbol,
    nontrading_status_rows,
    nontrading_symbol_reports,
    invalid_symbol_reports,
    symbol_results,
    missing_data_symbols,
):
    if not rows:
        missing_data_symbols.append(
            {
                "symbol": symbol,
                "name": metadata["name"],
                "marketCode": metadata["marketCode"],
                "listedFrom": metadata["listedFrom"],
                "delistedOn": metadata["delistedOn"],
                "reason": f"empty_history source={source_name or 'unknown'}",
            }
        )
        symbol_results.append(
            {
                "symbol": symbol,
                "status": "error",
                "source": source_name,
                "rowCount": 0,
                "nonTradingRowCount": 0,
                "firstDate": None,
                "lastDate": None,
                "reason": f"empty_history source={source_name or 'unknown'}",
            }
        )
        log(f"WARN historical_public_kr_stage symbol={symbol} reason=empty_history source={source_name}")
        return False

    partitioned = partition_symbol_series_rows(rows)
    valid_rows = list(partitioned.get("validRows") or [])
    nontrading_rows = list(partitioned.get("nonTradingRows") or [])
    fatal_rows = list(partitioned.get("fatalRows") or [])
    if fatal_rows:
        invalid_symbol_reports.append(
            build_invalid_candle_symbol_report(
                symbol=symbol,
                source_name=source_name,
                invalid_rows=fatal_rows,
                metadata=metadata,
            )
        )
        symbol_results.append(
            {
                "symbol": symbol,
                "status": "invalid",
                "source": source_name,
                "rowCount": len(valid_rows),
                "nonTradingRowCount": len(nontrading_rows),
                "firstDate": valid_rows[0]["dateKey"] if valid_rows else None,
                "lastDate": valid_rows[-1]["dateKey"] if valid_rows else None,
                "reason": "fatal_invalid_rows",
            }
        )
        log(
            f"FATAL historical_public_kr_stage symbol={symbol} source={source_name} "
            f"invalid_rows={len(fatal_rows)}"
        )
        return False

    candle_rows_by_symbol[symbol] = valid_rows
    symbol_results.append(
        {
            "symbol": symbol,
            "status": "completed",
            "source": source_name,
            "rowCount": len(valid_rows),
            "nonTradingRowCount": len(nontrading_rows),
            "firstDate": valid_rows[0]["dateKey"] if valid_rows else None,
            "lastDate": valid_rows[-1]["dateKey"] if valid_rows else None,
            "reason": None,
        }
    )
    if nontrading_rows:
        nontrading_symbol_reports.append(
            build_invalid_candle_symbol_report(
                symbol=symbol,
                source_name=source_name,
                invalid_rows=nontrading_rows,
                metadata=metadata,
            )
        )
        generated_at = iso_now_utc()
        for row in nontrading_rows:
            nontrading_status_rows.append(
                build_nontrading_status_row(
                    symbol=symbol,
                    source_name=source_name,
                    row=row,
                    metadata=metadata,
                    generated_at=generated_at,
                )
            )
    return True


def record_symbol_fetch_exception(*, symbol, metadata, exc, symbol_results, missing_data_symbols):
    missing_data_symbols.append(
        {
            "symbol": symbol,
            "name": metadata["name"],
            "marketCode": metadata["marketCode"],
            "listedFrom": metadata["listedFrom"],
            "delistedOn": metadata["delistedOn"],
            "reason": f"{type(exc).__name__}:{exc}",
        }
    )
    symbol_results.append(
        {
            "symbol": symbol,
            "status": "error",
            "source": None,
            "rowCount": 0,
            "nonTradingRowCount": 0,
            "firstDate": None,
            "lastDate": None,
            "reason": f"{type(exc).__name__}:{exc}",
        }
    )
    log(f"WARN historical_public_kr_stage symbol={symbol} err={type(exc).__name__}:{exc}")


def build_thread_local_krx_fetcher(*, retries, sleep_ms, auth_mode, min_interval_ms, cooldown_ms, fetch_fn):
    thread_state = local()

    def _fetch(symbol, metadata):
        client = getattr(thread_state, "client", None)
        if client is None:
            client = build_krx_client(
                retries=retries,
                sleep_ms=sleep_ms,
                auth_mode=auth_mode,
                min_interval_ms=min_interval_ms,
                cooldown_ms=cooldown_ms,
            )
            thread_state.client = client
        return fetch_fn(symbol, metadata, client)

    return _fetch


def process_parallel_symbol_fetch_batch(
    *,
    entries,
    metadata_by_symbol,
    fetch_fn,
    max_workers,
    candle_rows_by_symbol,
    nontrading_status_rows,
    nontrading_symbol_reports,
    invalid_symbol_reports,
    symbol_results,
    missing_data_symbols,
    processed,
    success,
    total_supported,
):
    if not entries:
        return processed, success
    with ThreadPoolExecutor(max_workers=max(1, int(max_workers or 1))) as executor:
        future_map = {
            executor.submit(fetch_fn, symbol, metadata): symbol
            for symbol, metadata in entries
        }
        for future in as_completed(future_map):
            symbol = future_map[future]
            metadata = metadata_by_symbol[symbol]
            processed += 1
            source_name = None
            try:
                rows, source_name = future.result()
            except Exception as exc:
                record_symbol_fetch_exception(
                    symbol=symbol,
                    metadata=metadata,
                    exc=exc,
                    symbol_results=symbol_results,
                    missing_data_symbols=missing_data_symbols,
                )
                continue

            if record_symbol_fetch_result(
                symbol=symbol,
                metadata=metadata,
                rows=rows,
                source_name=source_name,
                candle_rows_by_symbol=candle_rows_by_symbol,
                nontrading_status_rows=nontrading_status_rows,
                nontrading_symbol_reports=nontrading_symbol_reports,
                invalid_symbol_reports=invalid_symbol_reports,
                symbol_results=symbol_results,
                missing_data_symbols=missing_data_symbols,
            ):
                success += 1
            if processed % 50 == 0 or processed == total_supported:
                log(f"PROGRESS historical_public_kr_stage fetched={processed}/{total_supported} success={success}")
    return processed, success


def process_serial_symbol_fetch_batch(
    *,
    entries,
    metadata_by_symbol,
    fetch_fn,
    candle_rows_by_symbol,
    nontrading_status_rows,
    nontrading_symbol_reports,
    invalid_symbol_reports,
    symbol_results,
    missing_data_symbols,
    processed,
    success,
    total_supported,
):
    for symbol, metadata in entries:
        processed += 1
        try:
            rows, source_name = fetch_fn(symbol, metadata)
        except Exception as exc:
            record_symbol_fetch_exception(
                symbol=symbol,
                metadata=metadata,
                exc=exc,
                symbol_results=symbol_results,
                missing_data_symbols=missing_data_symbols,
            )
            continue
        if record_symbol_fetch_result(
            symbol=symbol,
            metadata=metadata,
            rows=rows,
            source_name=source_name,
            candle_rows_by_symbol=candle_rows_by_symbol,
            nontrading_status_rows=nontrading_status_rows,
            nontrading_symbol_reports=nontrading_symbol_reports,
            invalid_symbol_reports=invalid_symbol_reports,
            symbol_results=symbol_results,
            missing_data_symbols=missing_data_symbols,
        ):
            success += 1
        if processed % 50 == 0 or processed == total_supported:
            log(f"PROGRESS historical_public_kr_stage fetched={processed}/{total_supported} success={success}")
    return processed, success


def execute_stage(args):
    day_from = parse_day(args.date_from)
    day_to = parse_day(args.date_to)
    if day_from > day_to:
        raise SystemExit(f"invalid date range: from={args.date_from} to={args.date_to}")
    if args.symbol_shard_index < 0 or args.symbol_shard_index >= max(1, int(args.symbol_shard_count)):
        raise SystemExit(
            f"invalid shard index: index={args.symbol_shard_index} shard_count={args.symbol_shard_count}"
        )
    if args.historical_candle_provider != "explicit_source_plan":
        raise SystemExit("historical backfill requires --historical-candle-provider=explicit_source_plan")
    active_candle_provider = str(
        getattr(args, "active_candle_provider", ACTIVE_CANDLE_PROVIDER_YAHOO) or ACTIVE_CANDLE_PROVIDER_YAHOO
    ).strip() or ACTIVE_CANDLE_PROVIDER_YAHOO

    stage_root = prepare_stage_root(args.stage_root, args.overwrite_stage)
    filters_cfg = load_filters(Path(args.config))
    audit_dir = args.audit_dir or "audit"

    metadata_by_symbol = load_historical_lifecycle(
        args.lifecycle_path,
        day_from=day_from,
        day_to=day_to,
        shard_index=args.symbol_shard_index,
        shard_count=args.symbol_shard_count,
        security_type=args.security_type,
    )
    shares_by_symbol = load_historical_share_intervals(args.shares_path, symbol_filter=metadata_by_symbol.keys())
    expected_symbol_count = len(metadata_by_symbol)
    source_plan_rows = [build_source_manifest_row(row, active_candle_provider=active_candle_provider) for row in metadata_by_symbol.values()]
    active_yahoo_symbols = []
    active_krx_symbols = []
    delisted_symbols = []
    unsupported_source_symbols = []
    for symbol, metadata in sorted(metadata_by_symbol.items()):
        source_plan = build_source_manifest_row(metadata, active_candle_provider=active_candle_provider)
        candle_source = source_plan["candleSource"]
        if candle_source == CANDLE_SOURCE_ACTIVE_YAHOO:
            active_yahoo_symbols.append((symbol, metadata))
            continue
        if candle_source == CANDLE_SOURCE_ACTIVE_KRX:
            active_krx_symbols.append((symbol, metadata))
            continue
        if candle_source == CANDLE_SOURCE_DELISTED_KRX:
            delisted_symbols.append((symbol, metadata))
            continue
        unsupported_source_symbols.append(
            {
                "symbol": symbol,
                "name": metadata["name"],
                "marketCode": metadata["marketCode"],
                "fullCode": metadata.get("fullCode"),
                "reason": f"unsupported_candle_source:{candle_source}",
            }
        )

    log(
        "START historical_public_kr_stage "
        f"from={to_date_key(day_from)} to={to_date_key(day_to)} "
        f"stage_root={stage_root} shard={args.symbol_shard_index}/{args.symbol_shard_count} "
        f"symbols={expected_symbol_count} active_yahoo={len(active_yahoo_symbols)} "
        f"active_krx={len(active_krx_symbols)} delisted={len(delisted_symbols)} "
        f"max_workers={args.max_workers}"
    )

    symbol_results = []
    candle_rows_by_symbol = {}
    nontrading_status_rows = []
    nontrading_symbol_reports = []
    invalid_symbol_reports = []
    missing_data_symbols = []
    processed = 0
    success = 0

    total_supported = len(active_yahoo_symbols) + len(active_krx_symbols) + len(delisted_symbols)
    processed, success = process_parallel_symbol_fetch_batch(
        entries=active_yahoo_symbols,
        metadata_by_symbol=metadata_by_symbol,
        fetch_fn=lambda symbol, metadata: fetch_active_yahoo_rows(symbol, metadata, args.retries, args.sleep_ms),
        max_workers=args.max_workers,
        candle_rows_by_symbol=candle_rows_by_symbol,
        nontrading_status_rows=nontrading_status_rows,
        nontrading_symbol_reports=nontrading_symbol_reports,
        invalid_symbol_reports=invalid_symbol_reports,
        symbol_results=symbol_results,
        missing_data_symbols=missing_data_symbols,
        processed=processed,
        success=success,
        total_supported=total_supported,
    )

    if active_krx_symbols:
        active_krx_fetcher = build_thread_local_krx_fetcher(
            retries=args.retries,
            sleep_ms=args.sleep_ms,
            auth_mode=args.krx_auth_mode,
            min_interval_ms=args.krx_min_interval_ms,
            cooldown_ms=args.krx_cooldown_ms,
            fetch_fn=fetch_active_krx_rows,
        )
        processed, success = process_parallel_symbol_fetch_batch(
            entries=active_krx_symbols,
            metadata_by_symbol=metadata_by_symbol,
            fetch_fn=active_krx_fetcher,
            max_workers=args.max_workers,
            candle_rows_by_symbol=candle_rows_by_symbol,
            nontrading_status_rows=nontrading_status_rows,
            nontrading_symbol_reports=nontrading_symbol_reports,
            invalid_symbol_reports=invalid_symbol_reports,
            symbol_results=symbol_results,
            missing_data_symbols=missing_data_symbols,
            processed=processed,
            success=success,
            total_supported=total_supported,
        )

    if delisted_symbols:
        krx_client = build_krx_client(
            retries=args.retries,
            sleep_ms=args.sleep_ms,
            auth_mode=args.krx_auth_mode,
            min_interval_ms=args.krx_min_interval_ms,
            cooldown_ms=args.krx_cooldown_ms,
        )
        processed, success = process_serial_symbol_fetch_batch(
            entries=delisted_symbols,
            metadata_by_symbol=metadata_by_symbol,
            fetch_fn=lambda symbol, metadata: fetch_delisted_krx_rows(symbol, metadata, krx_client),
            candle_rows_by_symbol=candle_rows_by_symbol,
            nontrading_status_rows=nontrading_status_rows,
            nontrading_symbol_reports=nontrading_symbol_reports,
            invalid_symbol_reports=invalid_symbol_reports,
            symbol_results=symbol_results,
            missing_data_symbols=missing_data_symbols,
            processed=processed,
            success=success,
            total_supported=total_supported,
        )

    audit_paths = {}
    if nontrading_symbol_reports:
        path = write_nontrading_status_audit(
            stage_root,
            audit_dir=audit_dir,
            day_from_key=to_date_key(day_from),
            day_to_key=to_date_key(day_to),
            reports=sort_rows(nontrading_symbol_reports, "symbol"),
        )
        audit_paths["nonTradingStatus"] = str(path)
    if invalid_symbol_reports:
        path = write_invalid_candle_audit(
            stage_root,
            audit_dir=audit_dir,
            day_from_key=to_date_key(day_from),
            day_to_key=to_date_key(day_to),
            reports=sort_rows(invalid_symbol_reports, "symbol"),
        )
        audit_paths["fatalInvalid"] = str(path)
    if missing_data_symbols:
        path = write_stage_audit(
            stage_root,
            audit_dir,
            "missing_data_symbols.json",
            {
                "kind": "public_kr_historical_missing_data_symbols_v1",
                "generatedAt": iso_now_utc(),
                "from": to_date_key(day_from),
                "to": to_date_key(day_to),
                "symbolCount": len(missing_data_symbols),
                "symbols": sort_rows(missing_data_symbols, "symbol"),
            },
        )
        audit_paths["missingData"] = str(path)
    if unsupported_source_symbols:
        path = write_stage_audit(
            stage_root,
            audit_dir,
            "unsupported_candle_source_symbols.json",
            {
                "kind": "public_kr_historical_unsupported_candle_source_symbols_v1",
                "generatedAt": iso_now_utc(),
                "from": to_date_key(day_from),
                "to": to_date_key(day_to),
                "symbolCount": len(unsupported_source_symbols),
                "symbols": sort_rows(unsupported_source_symbols, "symbol"),
            },
        )
        audit_paths["unsupportedSources"] = str(path)

    if invalid_symbol_reports or missing_data_symbols or unsupported_source_symbols:
        summary = build_summary(
            args=args,
            status=STAGE_STATUS_FAILED,
            expected_symbol_count=expected_symbol_count,
            fetched_symbol_count=success,
            candle_rows=0,
            universe_rows=0,
            nontrading_rows=len(nontrading_status_rows),
            invalid_symbol_count=len(invalid_symbol_reports),
            missing_data_symbol_count=len(missing_data_symbols),
            missing_share_symbol_count=0,
            unsupported_source_symbol_count=len(unsupported_source_symbols),
            audit_paths=audit_paths,
            failure_reason="historical stage fetch failed; inspect stage audits",
        )
        write_jsonl(stage_root / STAGE_SYMBOL_RESULTS_BASENAME, sort_rows(symbol_results, "symbol"))
        write_summary(stage_root, summary, args.summary_out)
        return 1

    candle_rows = []
    universe_rows = []
    missing_share_symbols = {}
    universe_candidate_count = 0
    universe_reject_counts = defaultdict(int)
    for symbol, rows in sorted(candle_rows_by_symbol.items()):
        metadata = metadata_by_symbol[symbol]
        trading_window = deque(maxlen=20)
        for row in rows:
            candle_rows.append(
                {
                    "symbol": symbol,
                    "dateKey": row["dateKey"],
                    "open": row["open"],
                    "high": row["high"],
                    "low": row["low"],
                    "close": row["close"],
                    "volume": row["volume"],
                }
            )
            share_count = resolve_share_count(shares_by_symbol, symbol, row["dateKey"])
            if share_count is None:
                current = missing_share_symbols.get(symbol)
                if current is None:
                    missing_share_symbols[symbol] = {
                        "symbol": symbol,
                        "name": metadata["name"],
                        "marketCode": metadata["marketCode"],
                        "firstMissingDate": row["dateKey"],
                        "missingDateCount": 1,
                    }
                else:
                    current["missingDateCount"] += 1
                continue
            trading_value = int(row["close"] * row["volume"])
            trading_window.append(trading_value)
            avg20 = int(sum(trading_window) / len(trading_window)) if trading_window else None
            market_cap = int(row["close"] * share_count)
            universe_candidate_count += 1
            reject_reason = universe_reject_reason(args.universe_mode, market_cap, avg20, filters_cfg)
            if reject_reason is not None:
                universe_reject_counts[reject_reason] += 1
                continue
            universe_rows.append(
                {
                    "symbol": symbol,
                    "tradingDateKey": row["dateKey"],
                    "avgTradingValue20d": avg20,
                    "marketCapKrw": market_cap,
                }
            )

    if missing_share_symbols:
        path = write_stage_audit(
            stage_root,
            audit_dir,
            "missing_share_symbols.json",
            {
                "kind": "public_kr_historical_missing_share_symbols_v1",
                "generatedAt": iso_now_utc(),
                "from": to_date_key(day_from),
                "to": to_date_key(day_to),
                "symbolCount": len(missing_share_symbols),
                "symbols": sort_rows(missing_share_symbols.values(), "symbol"),
            },
        )
        audit_paths["missingShares"] = str(path)
        summary = build_summary(
            args=args,
            status=STAGE_STATUS_FAILED,
            expected_symbol_count=expected_symbol_count,
            fetched_symbol_count=success,
            candle_rows=len(candle_rows),
            universe_rows=0,
            nontrading_rows=len(nontrading_status_rows),
            invalid_symbol_count=0,
            missing_data_symbol_count=0,
            missing_share_symbol_count=len(missing_share_symbols),
            unsupported_source_symbol_count=0,
            audit_paths=audit_paths,
            failure_reason="historical stage shares coverage failed; inspect missingShares audit",
        )
        write_jsonl(stage_root / STAGE_SYMBOL_RESULTS_BASENAME, sort_rows(symbol_results, "symbol"))
        write_summary(stage_root, summary, args.summary_out)
        return 1

    universe_diagnostics = {
        "candidateRowCount": int(universe_candidate_count),
        "passedRowCount": int(len(universe_rows)),
        "rejectedRowCount": int(sum(universe_reject_counts.values())),
        "rejectReasonCounts": {key: int(universe_reject_counts[key]) for key in sorted(universe_reject_counts)},
        "thresholds": {
            "minMarketCapKrw": int(filters_cfg["min_market_cap"]),
            "minAvgTradingValue20dKrw": int(filters_cfg["min_liquidity"]),
        },
    }

    write_partitioned_rows(stage_root, "candle", candle_rows, "dateKey")
    write_partitioned_rows(stage_root, "universe", universe_rows, "tradingDateKey")
    write_partitioned_rows(stage_root, "nontrading", nontrading_status_rows, "dateKey")
    write_jsonl(stage_root / STAGE_SYMBOL_RESULTS_BASENAME, sort_rows(symbol_results, "symbol"))

    summary = build_summary(
        args=args,
        status=STAGE_STATUS_COMPLETED,
        expected_symbol_count=expected_symbol_count,
        fetched_symbol_count=success,
        candle_rows=len(candle_rows),
        universe_rows=len(universe_rows),
        nontrading_rows=len(nontrading_status_rows),
        invalid_symbol_count=0,
        missing_data_symbol_count=0,
        missing_share_symbol_count=0,
        unsupported_source_symbol_count=0,
        audit_paths=audit_paths,
        universe_diagnostics=universe_diagnostics,
        failure_reason=None,
    )
    write_summary(stage_root, summary, args.summary_out)
    log(
        "DONE historical_public_kr_stage "
        f"stage_root={stage_root} candle_rows={len(candle_rows)} "
        f"universe_rows={len(universe_rows)} nontrading_rows={len(nontrading_status_rows)}"
    )
    return 0


def main():
    args = parse_args()
    raise SystemExit(execute_stage(args))


if __name__ == "__main__":
    main()
