#!/usr/bin/env python3

import argparse
import shutil
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from kiwoom_rest_client import KIWOOM_DEFAULT_BASE_URL, KiwoomContractError, KiwoomRestClient
from kiwoom_side_daily_common import (
    SIDE_DAILY_STAGE_KIND,
    SIDE_DAILY_STAGE_ROWSET_KIND,
    build_side_daily_request_index,
    fetch_side_daily_page,
    normalize_stage_row,
    resolve_side_daily_dataset_spec,
    sort_side_daily_rows,
    stage_row_key,
    supported_side_daily_datasets,
)
from public_kr_historical_common import (
    STAGE_SUMMARY_BASENAME,
    STAGE_SYMBOL_RESULTS_BASENAME,
    write_json,
    write_jsonl,
    write_partitioned_rows,
)


_THREAD_STATE = threading.local()


def parse_args():
    parser = argparse.ArgumentParser(description="Backfill Kiwoom side-daily datasets for Step A TP12 manifest windows.")
    parser.add_argument("--dataset", required=True, choices=supported_side_daily_datasets())
    parser.add_argument("--manifest-path", required=True)
    parser.add_argument("--stage-root", required=True)
    parser.add_argument("--summary-out", default="")
    parser.add_argument("--decision-from", default="")
    parser.add_argument("--decision-to", default="")
    parser.add_argument("--symbol-shard-index", type=int, default=None)
    parser.add_argument("--symbol-shard-count", type=int, default=None)
    parser.add_argument("--overwrite-stage", action="store_true")
    parser.add_argument("--run-id", default="")
    parser.add_argument("--worker-id", default="")
    parser.add_argument("--max-workers", type=int, default=1)
    parser.add_argument("--max-pages-per-symbol", type=int, default=4096)
    parser.add_argument("--trace-root", default="")
    parser.add_argument("--base-url", default=KIWOOM_DEFAULT_BASE_URL)
    parser.add_argument("--retries", type=int, default=2)
    parser.add_argument("--sleep-ms", type=int, default=400)
    parser.add_argument("--min-interval-ms", type=int, default=1200)
    parser.add_argument("--cooldown-429-ms", type=int, default=30000)
    return parser.parse_args()


def resolve_summary_out(stage_root, summary_out):
    if str(summary_out or "").strip():
        return Path(summary_out)
    return Path(stage_root) / STAGE_SUMMARY_BASENAME


def fail_stage(summary_path, summary, exc):
    failure_reason = f"{type(exc).__name__}:{exc}"
    summary["status"] = "failed"
    summary["failureReason"] = failure_reason
    write_json(summary_path, summary)
    raise SystemExit(f"backfill_kiwoom_side_daily failed: {failure_reason}") from exc


def build_thread_trace_dir(trace_root):
    text = str(trace_root or "").strip()
    if not text:
        return ""
    return str(Path(text) / f"thread-{threading.get_ident()}")


def get_thread_client(args):
    client = getattr(_THREAD_STATE, "client", None)
    if client is None:
        client = KiwoomRestClient(
            retries=args.retries,
            sleep_ms=args.sleep_ms,
            trace_dir=build_thread_trace_dir(args.trace_root),
            base_url=args.base_url,
            min_interval_ms=args.min_interval_ms,
            cooldown_429_ms=args.cooldown_429_ms,
        )
        _THREAD_STATE.client = client
    return client


def fetch_symbol_rows(args, dataset, symbol, request_meta):
    client = get_thread_client(args)
    requested_date_keys = list(request_meta["requestedDateKeys"])
    requested_date_set = set(requested_date_keys)
    if not requested_date_keys:
        raise KiwoomContractError(f"missing requested dates for symbol={symbol}")
    anchor_date_key = request_meta["latestRequestedDateKey"]
    oldest_requested_date_key = request_meta["oldestRequestedDateKey"]
    page_count = 0
    observed_row_count = 0
    covered_rows_by_date = {}
    cont_yn = None
    next_key = None
    seen_page_tokens = set()
    oldest_observed_date_key = None
    newest_observed_date_key = None
    while True:
        page_count += 1
        result = fetch_side_daily_page(
            client,
            dataset=dataset,
            symbol=symbol,
            anchor_date_key=anchor_date_key,
            cont_yn=cont_yn,
            next_key=next_key,
            trace_step=f"{dataset}_{symbol}_page_{page_count}",
        )
        rows = list(result.get("rows") or [])
        if page_count == 1 and not rows:
            raise KiwoomContractError(f"{dataset} returned zero rows on first page for symbol={symbol}")
        page_date_keys = []
        for raw_row in rows:
            stage_row = normalize_stage_row(dataset, symbol, raw_row)
            date_key = stage_row["dateKey"]
            observed_row_count += 1
            page_date_keys.append(date_key)
            if newest_observed_date_key is None or date_key > newest_observed_date_key:
                newest_observed_date_key = date_key
            if oldest_observed_date_key is None or date_key < oldest_observed_date_key:
                oldest_observed_date_key = date_key
            if date_key in covered_rows_by_date:
                raise KiwoomContractError(f"duplicate {dataset} row for symbol={symbol} dateKey={date_key}")
            if date_key in requested_date_set:
                covered_rows_by_date[date_key] = stage_row
        cont_yn = str(result.get("contYn") or "").strip()
        next_key = str(result.get("nextKey") or "").strip()
        if len(covered_rows_by_date) == len(requested_date_set):
            break
        page_oldest = min(page_date_keys) if page_date_keys else None
        if page_oldest and page_oldest <= oldest_requested_date_key:
            break
        if cont_yn != "Y" or not next_key:
            break
        page_token = (cont_yn, next_key)
        if page_token in seen_page_tokens:
            raise KiwoomContractError(f"continuation token loop detected for symbol={symbol} dataset={dataset}")
        seen_page_tokens.add(page_token)
        if page_count >= int(args.max_pages_per_symbol or 0):
            raise KiwoomContractError(
                f"page limit exceeded for symbol={symbol} dataset={dataset} max_pages={args.max_pages_per_symbol}"
            )
    missing_date_keys = sorted(requested_date_set - set(covered_rows_by_date.keys()))
    if missing_date_keys:
        preview = ",".join(missing_date_keys[:8])
        raise KiwoomContractError(
            f"{dataset} missing requested dates for symbol={symbol} count={len(missing_date_keys)} preview={preview}"
        )
    rows = sort_side_daily_rows(list(covered_rows_by_date.values()))
    return {
        "rows": rows,
        "result": {
            "symbol": symbol,
            "dataset": dataset,
            "status": "completed",
            "requestedDateCount": len(requested_date_keys),
            "coveredDateCount": len(rows),
            "pageCount": page_count,
            "observedRowCount": observed_row_count,
            "oldestRequestedDateKey": oldest_requested_date_key,
            "latestRequestedDateKey": anchor_date_key,
            "oldestObservedDateKey": oldest_observed_date_key,
            "newestObservedDateKey": newest_observed_date_key,
        },
    }


def main():
    args = parse_args()
    stage_root = Path(args.stage_root).resolve()
    summary_path = resolve_summary_out(stage_root, args.summary_out).resolve()
    dataset = str(args.dataset or "").strip()
    dataset_spec = resolve_side_daily_dataset_spec(dataset)

    if stage_root.exists():
        if args.overwrite_stage:
            shutil.rmtree(stage_root)
        else:
            raise SystemExit(f"stage root already exists: {stage_root}. pass --overwrite-stage to replace it")
    stage_root.mkdir(parents=True, exist_ok=True)

    request_index = build_side_daily_request_index(
        args.manifest_path,
        decision_from=args.decision_from,
        decision_to=args.decision_to,
        shard_index=args.symbol_shard_index,
        shard_count=args.symbol_shard_count,
    )
    summary = {
        "kind": SIDE_DAILY_STAGE_KIND,
        "dataset": dataset,
        "apiId": dataset_spec["apiId"],
        "status": "running",
        "manifestPath": request_index["manifestPath"],
        "manifestRowCount": request_index["manifestRowCount"],
        "filteredManifestRowCount": request_index["filteredManifestRowCount"],
        "symbolCount": request_index["symbolCount"],
        "requestedPairCount": request_index["requestedPairCount"],
        "requestedDateFrom": request_index["requestedDateFrom"],
        "requestedDateTo": request_index["requestedDateTo"],
        "decisionFrom": str(args.decision_from or "").strip() or None,
        "decisionTo": str(args.decision_to or "").strip() or None,
        "symbolShardIndex": args.symbol_shard_index,
        "symbolShardCount": args.symbol_shard_count,
        "runId": str(args.run_id or "").strip() or None,
        "workerId": str(args.worker_id or "").strip() or None,
        "stageRoot": str(stage_root),
        "maxWorkers": int(args.max_workers or 1),
        "maxPagesPerSymbol": int(args.max_pages_per_symbol or 0),
        "failureReason": None,
    }
    write_json(summary_path, summary)
    try:
        if request_index["symbolCount"] <= 0 or request_index["requestedPairCount"] <= 0:
            raise SystemExit("side-daily manifest produced zero requested symbol/date pairs")
        rows = []
        symbol_results = []
        futures = {}
        with ThreadPoolExecutor(max_workers=max(1, int(args.max_workers or 1))) as executor:
            for symbol, request_meta in sorted(request_index["bySymbol"].items()):
                futures[executor.submit(fetch_symbol_rows, args, dataset, symbol, request_meta)] = symbol
            for future in as_completed(futures):
                payload = future.result()
                rows.extend(payload["rows"])
                symbol_results.append(payload["result"])
        seen_stage_keys = set()
        for row in rows:
            key = stage_row_key(row)
            if key in seen_stage_keys:
                raise SystemExit(f"duplicate side-daily row across symbol tasks symbol={key[0]} dateKey={key[1]}")
            seen_stage_keys.add(key)
        write_partitioned_rows(stage_root, SIDE_DAILY_STAGE_ROWSET_KIND, rows, "dateKey")
        write_jsonl(stage_root / STAGE_SYMBOL_RESULTS_BASENAME, sorted(symbol_results, key=lambda row: row["symbol"]))
        summary["status"] = "completed"
        summary["rowCount"] = len(rows)
        summary["coveredPairCount"] = len(seen_stage_keys)
        summary["symbolResultsPath"] = str((stage_root / STAGE_SYMBOL_RESULTS_BASENAME).resolve())
        summary["partitionRoot"] = str((stage_root / SIDE_DAILY_STAGE_ROWSET_KIND).resolve())
        write_json(summary_path, summary)
        print(
            "DONE backfill_kiwoom_side_daily "
            f"dataset={dataset} symbols={request_index['symbolCount']} rows={len(rows)} stage_root={stage_root}",
            flush=True,
        )
    except Exception as exc:
        fail_stage(summary_path, summary, exc)


if __name__ == "__main__":
    main()
