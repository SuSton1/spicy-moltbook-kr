#!/usr/bin/env python3

import argparse
import shutil
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from kiwoom_intraday_1m_common import (
    INTRADAY_1M_STAGE_BARSET_KIND,
    INTRADAY_1M_STAGE_KIND,
    build_intraday_request_index,
    build_presence_rows_from_bars,
    classify_minute_raw_row,
    iso_now_utc,
    latest_candle_date_key,
    load_symbol_latest_intraday_anchor_date_map,
    normalize_minute_bar,
    sort_intraday_rows,
    sort_presence_rows,
    to_dash_date_key,
    write_intraday_partition_rows,
)
from kiwoom_rest_client import KIWOOM_DEFAULT_BASE_URL, KiwoomContractError, KiwoomRestClient
from public_kr_historical_common import STAGE_SUMMARY_BASENAME, STAGE_SYMBOL_RESULTS_BASENAME, write_json, write_jsonl


_THREAD_STATE = threading.local()


def parse_args():
    parser = argparse.ArgumentParser(description="Backfill Kiwoom 1-minute intraday bars for TP12 Step A manifest windows.")
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
    parser.add_argument("--max-pages-per-symbol", type=int, default=20000)
    parser.add_argument("--trace-root", default="")
    parser.add_argument("--base-url", default=KIWOOM_DEFAULT_BASE_URL)
    parser.add_argument("--retries", type=int, default=2)
    parser.add_argument("--sleep-ms", type=int, default=400)
    parser.add_argument("--min-interval-ms", type=int, default=1200)
    parser.add_argument("--cooldown-429-ms", type=int, default=30000)
    parser.add_argument("--crawl-anchor-date", default="")
    parser.add_argument("--candle-path", default="data/candle_daily.jsonl")
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
    raise SystemExit(f"backfill_kiwoom_intraday_1m failed: {failure_reason}") from exc


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


def checkpoint_path(stage_root, symbol):
    return Path(stage_root) / "checkpoints" / f"{symbol}.json"


def write_checkpoint(stage_root, symbol, payload):
    write_json(checkpoint_path(stage_root, symbol), payload)


def process_symbol(args, stage_root, symbol, request_meta, crawl_anchor_date_key):
    client = get_thread_client(args)
    requested_date_keys = list(request_meta["requestedDateKeys"])
    requested_date_set = set(requested_date_keys)
    oldest_requested_floor_ts = f"{request_meta['oldestRequestedDateKey']}T09:00:00+09:00"
    before_rate_limit_hits = client.get_rate_limit_hit_count()
    checkpoint = {
        "symbol": symbol,
        "status": "running",
        "requestedDateCount": len(requested_date_keys),
        "oldestRequestedDateKey": request_meta["oldestRequestedDateKey"],
        "latestRequestedDateKey": request_meta["latestRequestedDateKey"],
        "crawlAnchorDateKey": crawl_anchor_date_key,
        "pagesFetched": 0,
        "rowsWritten": 0,
        "oldestFetchedTs": None,
        "newestFetchedTs": None,
        "completedFloorDate": None,
        "nextKey": None,
        "coveredRequestedDateCount": 0,
        "coveredRequestedDatePreview": [],
        "rateLimitHitCount": 0,
        "placeholderRowCount": 0,
        "outOfSessionRowCount": 0,
        "failureReason": None,
        "generatedAt": iso_now_utc(),
    }
    try:
        page_count = 0
        cont_yn = None
        next_key = None
        kept_rows = {}
        seen_page_tokens = set()
        oldest_fetched_ts = None
        newest_fetched_ts = None
        covered_requested_dates = set()
        exhausted_continuation_before_floor = False
        while True:
            page_count += 1
            result = client.fetch_minute_chart(
                symbol=symbol,
                base_date=crawl_anchor_date_key,
                cont_yn=cont_yn,
                next_key=next_key,
                trace_step=f"ka10080_{symbol}_page_{page_count}",
            )
            raw_rows = list(result.get("rows") or [])
            if page_count == 1 and not raw_rows:
                raise KiwoomContractError(f"ka10080 returned zero rows on first page for symbol={symbol}")
            usable_row_count = 0
            for raw_row in raw_rows:
                row_class = classify_minute_raw_row(raw_row)
                if row_class == "placeholder":
                    checkpoint["placeholderRowCount"] += 1
                    continue
                if row_class == "out_of_session":
                    checkpoint["outOfSessionRowCount"] += 1
                    continue
                usable_row_count += 1
                bar = normalize_minute_bar(symbol, raw_row)
                if newest_fetched_ts is None or bar["tsKst"] > newest_fetched_ts:
                    newest_fetched_ts = bar["tsKst"]
                if oldest_fetched_ts is None or bar["tsKst"] < oldest_fetched_ts:
                    oldest_fetched_ts = bar["tsKst"]
                if bar["tradingDateKey"] in requested_date_set:
                    key = (bar["symbol"], bar["tsKst"])
                    if key in kept_rows:
                        raise KiwoomContractError(f"duplicate minute row for symbol={symbol} tsKst={bar['tsKst']}")
                    kept_rows[key] = bar
                    covered_requested_dates.add(bar["tradingDateKey"])
            if page_count == 1 and usable_row_count <= 0:
                raise KiwoomContractError(
                    f"ka10080 returned zero usable rows on first page for symbol={symbol} "
                    f"placeholderRows={checkpoint['placeholderRowCount']} "
                    f"outOfSessionRows={checkpoint['outOfSessionRowCount']}"
                )
            checkpoint["pagesFetched"] = page_count
            checkpoint["nextKey"] = str(result.get("nextKey") or "").strip() or None
            checkpoint["oldestFetchedTs"] = oldest_fetched_ts
            checkpoint["newestFetchedTs"] = newest_fetched_ts
            checkpoint["coveredRequestedDateCount"] = len(covered_requested_dates)
            checkpoint["coveredRequestedDatePreview"] = sorted(covered_requested_dates)[:8]
            checkpoint["rateLimitHitCount"] = client.get_rate_limit_hit_count() - before_rate_limit_hits
            checkpoint["generatedAt"] = iso_now_utc()
            write_checkpoint(stage_root, symbol, checkpoint)
            if oldest_fetched_ts is not None and oldest_fetched_ts <= oldest_requested_floor_ts:
                break
            cont_yn = str(result.get("contYn") or "").strip()
            next_key = str(result.get("nextKey") or "").strip()
            if cont_yn != "Y" or not next_key:
                exhausted_continuation_before_floor = oldest_fetched_ts is None or oldest_fetched_ts > oldest_requested_floor_ts
                break
            token = (cont_yn, next_key)
            if token in seen_page_tokens:
                raise KiwoomContractError(f"continuation token loop detected for symbol={symbol}")
            seen_page_tokens.add(token)
            if page_count >= int(args.max_pages_per_symbol or 0):
                raise KiwoomContractError(
                    f"page limit exceeded for symbol={symbol} max_pages={args.max_pages_per_symbol}"
                )
        covered_dates = {row["tradingDateKey"] for row in kept_rows.values()}
        missing_dates = sorted(requested_date_set - covered_dates)
        if missing_dates and exhausted_continuation_before_floor:
            preview = ",".join(missing_dates[:8])
            observed_oldest = oldest_fetched_ts or "<none>"
            raise KiwoomContractError(
                f"minute history depth exhausted before oldest requested floor for symbol={symbol} "
                f"observedOldestTs={observed_oldest} requestedFloorTs={oldest_requested_floor_ts} "
                f"missingCount={len(missing_dates)} preview={preview}"
            )
        if missing_dates:
            preview = ",".join(missing_dates[:8])
            raise KiwoomContractError(
                f"minute collector missing requested dates within reached history for symbol={symbol} "
                f"count={len(missing_dates)} preview={preview} observedOldestTs={oldest_fetched_ts or '<none>'}"
            )
        rows = sort_intraday_rows(list(kept_rows.values()))
        presence_rows = build_presence_rows_from_bars(rows)
        checkpoint["status"] = "completed"
        checkpoint["rowsWritten"] = len(rows)
        checkpoint["oldestFetchedTs"] = oldest_fetched_ts
        checkpoint["newestFetchedTs"] = newest_fetched_ts
        checkpoint["completedFloorDate"] = request_meta["oldestRequestedDateKey"]
        checkpoint["coveredRequestedDateCount"] = len(covered_requested_dates)
        checkpoint["coveredRequestedDatePreview"] = sorted(covered_requested_dates)[:8]
        checkpoint["rateLimitHitCount"] = client.get_rate_limit_hit_count() - before_rate_limit_hits
        checkpoint["generatedAt"] = iso_now_utc()
        write_checkpoint(stage_root, symbol, checkpoint)
        return {
            "rows": rows,
            "presenceRows": presence_rows,
            "result": {
                "symbol": symbol,
                "status": "completed",
                "requestedDateCount": len(requested_date_keys),
                "coveredDateCount": len(presence_rows),
                "pagesFetched": page_count,
                "rowsWritten": len(rows),
                "oldestFetchedTs": oldest_fetched_ts,
                "newestFetchedTs": newest_fetched_ts,
                "rateLimitHitCount": checkpoint["rateLimitHitCount"],
                "placeholderRowCount": checkpoint["placeholderRowCount"],
                "outOfSessionRowCount": checkpoint["outOfSessionRowCount"],
            },
        }
    except Exception as exc:
        checkpoint["status"] = "failed"
        checkpoint["oldestFetchedTs"] = oldest_fetched_ts
        checkpoint["newestFetchedTs"] = newest_fetched_ts
        checkpoint["coveredRequestedDateCount"] = len(covered_requested_dates)
        checkpoint["coveredRequestedDatePreview"] = sorted(covered_requested_dates)[:8]
        checkpoint["failureReason"] = f"{type(exc).__name__}:{exc}"
        checkpoint["rateLimitHitCount"] = client.get_rate_limit_hit_count() - before_rate_limit_hits
        checkpoint["generatedAt"] = iso_now_utc()
        write_checkpoint(stage_root, symbol, checkpoint)
        raise


def main():
    args = parse_args()
    stage_root = Path(args.stage_root).resolve()
    summary_path = resolve_summary_out(stage_root, args.summary_out).resolve()
    if stage_root.exists():
        if args.overwrite_stage:
            shutil.rmtree(stage_root)
        else:
            raise SystemExit(f"stage root already exists: {stage_root}. pass --overwrite-stage to replace it")
    stage_root.mkdir(parents=True, exist_ok=True)
    request_index = build_intraday_request_index(
        args.manifest_path,
        decision_from=args.decision_from,
        decision_to=args.decision_to,
        shard_index=args.symbol_shard_index,
        shard_count=args.symbol_shard_count,
    )
    if str(args.crawl_anchor_date or "").strip():
        crawl_anchor_mode = "explicit"
        explicit_anchor_date_key = to_dash_date_key(args.crawl_anchor_date)
        crawl_anchor_date_key = explicit_anchor_date_key
        crawl_anchor_by_symbol = {
            symbol: explicit_anchor_date_key
            for symbol in request_index["bySymbol"].keys()
        }
    else:
        crawl_anchor_mode = "symbol_latest_positive_volume_daily"
        crawl_anchor_date_key = str(latest_candle_date_key(args.candle_path))
        crawl_anchor_by_symbol = load_symbol_latest_intraday_anchor_date_map(
            args.candle_path,
            request_index["bySymbol"].keys(),
        )
        for symbol, request_meta in request_index["bySymbol"].items():
            symbol_anchor = str(crawl_anchor_by_symbol.get(symbol) or "").strip()
            latest_requested_date_key = str(request_meta["latestRequestedDateKey"] or "").strip()
            if not symbol_anchor:
                raise SystemExit(f"missing crawl anchor for symbol={symbol}")
            if symbol_anchor < latest_requested_date_key:
                raise SystemExit(
                    f"symbol-local crawl anchor precedes latest requested date symbol={symbol} "
                    f"anchor={symbol_anchor} latestRequested={latest_requested_date_key}"
                )
    summary = {
        "kind": INTRADAY_1M_STAGE_KIND,
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
        "crawlAnchorDateKey": crawl_anchor_date_key,
        "crawlAnchorMode": crawl_anchor_mode,
        "candlePath": str(Path(args.candle_path).resolve()),
        "failureReason": None,
    }
    write_json(summary_path, summary)
    try:
        if request_index["symbolCount"] <= 0:
            raise SystemExit("minute manifest produced zero symbols")
        rows = []
        presence_rows = []
        symbol_results = []
        futures = {}
        with ThreadPoolExecutor(max_workers=max(1, int(args.max_workers or 1))) as executor:
            for symbol, request_meta in sorted(request_index["bySymbol"].items()):
                futures[
                    executor.submit(
                        process_symbol,
                        args,
                        stage_root,
                        symbol,
                        request_meta,
                        crawl_anchor_by_symbol[symbol],
                    )
                ] = symbol
            for future in as_completed(futures):
                payload = future.result()
                rows.extend(payload["rows"])
                presence_rows.extend(payload["presenceRows"])
                symbol_results.append(payload["result"])
        write_intraday_partition_rows(stage_root, INTRADAY_1M_STAGE_BARSET_KIND, rows)
        write_jsonl(stage_root / "presence.jsonl", sort_presence_rows(presence_rows))
        write_jsonl(stage_root / STAGE_SYMBOL_RESULTS_BASENAME, sorted(symbol_results, key=lambda row: row["symbol"]))
        summary["status"] = "completed"
        summary["rowCount"] = len(rows)
        summary["presenceRowCount"] = len(presence_rows)
        summary["partitionRoot"] = str((stage_root / INTRADAY_1M_STAGE_BARSET_KIND).resolve())
        summary["presencePath"] = str((stage_root / "presence.jsonl").resolve())
        summary["checkpointDir"] = str((stage_root / "checkpoints").resolve())
        summary["symbolResultsPath"] = str((stage_root / STAGE_SYMBOL_RESULTS_BASENAME).resolve())
        write_json(summary_path, summary)
        print(
            "DONE backfill_kiwoom_intraday_1m "
            f"symbols={request_index['symbolCount']} rows={len(rows)} presence_rows={len(presence_rows)} "
            f"stage_root={stage_root}",
            flush=True,
        )
    except Exception as exc:
        fail_stage(summary_path, summary, exc)


if __name__ == "__main__":
    main()
