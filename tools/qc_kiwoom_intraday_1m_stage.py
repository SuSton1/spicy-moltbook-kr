#!/usr/bin/env python3

import argparse
from collections import defaultdict
from pathlib import Path
import json

from kiwoom_intraday_1m_common import (
    INTRADAY_1M_API_ID,
    INTRADAY_1M_SOURCE,
    INTRADAY_1M_STAGE_BARSET_KIND,
    INTRADAY_1M_STAGE_KIND,
    INTRADAY_1M_STAGE_QC_KIND,
    aggregate_daily_from_intraday_rows,
    build_intraday_request_index,
    is_regular_session_ts_kst,
    load_daily_candle_map,
    load_intraday_partition_rows,
    minute_bar_key,
    presence_key,
    sort_intraday_rows,
)
from public_kr_historical_common import STAGE_QC_SUMMARY_BASENAME, iter_jsonl, load_stage_summary, write_json


def parse_args():
    parser = argparse.ArgumentParser(description="QC Kiwoom 1-minute intraday stage artifacts.")
    parser.add_argument("--stage-root", required=True)
    parser.add_argument("--candle-path", default="")
    return parser.parse_args()


def main():
    args = parse_args()
    stage_root = Path(args.stage_root).resolve()
    summary = load_stage_summary(stage_root)
    if summary.get("kind") != INTRADAY_1M_STAGE_KIND:
        raise SystemExit(f"unexpected stage summary kind: {summary.get('kind')}")
    if summary.get("status") != "completed":
        raise SystemExit(f"stage root is not completed: {stage_root}")
    candle_path = str(args.candle_path or "").strip() or str(summary.get("candlePath") or "").strip()
    request_index = build_intraday_request_index(
        summary.get("manifestPath"),
        decision_from=summary.get("decisionFrom"),
        decision_to=summary.get("decisionTo"),
        shard_index=summary.get("symbolShardIndex"),
        shard_count=summary.get("symbolShardCount"),
    )
    rows = load_intraday_partition_rows(stage_root, INTRADAY_1M_STAGE_BARSET_KIND)
    presence_rows = list(iter_jsonl(stage_root / "presence.jsonl"))
    qc_summary = {
        "kind": INTRADAY_1M_STAGE_QC_KIND,
        "status": "failed",
        "rowCount": len(rows),
        "presenceRowCount": len(presence_rows),
        "requestedPairCount": request_index["requestedPairCount"],
        "duplicateBarCount": 0,
        "timestampOrderViolationCount": 0,
        "ohlcIntegrityViolationCount": 0,
        "tradingDateMismatchCount": 0,
        "sessionBoundsViolationCount": 0,
        "unexpectedPresenceCount": 0,
        "missingPresenceCount": 0,
        "presenceDuplicateCount": 0,
        "presenceBarCountMismatchCount": 0,
        "presenceRangeMismatchCount": 0,
        "sourceMismatchCount": 0,
        "apiIdMismatchCount": 0,
        "dailyMismatchCount": 0,
        "checkpointCount": 0,
        "checkpointFailureCount": 0,
        "failureReason": None,
    }
    try:
        seen_bar_keys = set()
        grouped = defaultdict(list)
        for row in sort_intraday_rows(rows):
            key = minute_bar_key(row)
            if key in seen_bar_keys:
                qc_summary["duplicateBarCount"] += 1
            seen_bar_keys.add(key)
            symbol = str(row.get("symbol") or "").strip()
            trading_date_key = str(row.get("tradingDateKey") or "").strip()
            ts_kst = str(row.get("tsKst") or "").strip()
            if ts_kst[:10] != trading_date_key:
                qc_summary["tradingDateMismatchCount"] += 1
            if not is_regular_session_ts_kst(ts_kst):
                qc_summary["sessionBoundsViolationCount"] += 1
            if str(row.get("source") or "").strip() != INTRADAY_1M_SOURCE:
                qc_summary["sourceMismatchCount"] += 1
            if str(row.get("apiId") or "").strip() != INTRADAY_1M_API_ID:
                qc_summary["apiIdMismatchCount"] += 1
            open_price = int(row.get("open"))
            high_price = int(row.get("high"))
            low_price = int(row.get("low"))
            close_price = int(row.get("close"))
            volume = int(row.get("volume"))
            if high_price < low_price or not (low_price <= open_price <= high_price) or not (low_price <= close_price <= high_price) or min(open_price, high_price, low_price, close_price) <= 0 or volume < 0:
                qc_summary["ohlcIntegrityViolationCount"] += 1
            grouped[(symbol, trading_date_key)].append(row)
        for rows_for_pair in grouped.values():
            last_ts = None
            for row in rows_for_pair:
                ts_kst = str(row.get("tsKst") or "").strip()
                if last_ts is not None and ts_kst <= last_ts:
                    qc_summary["timestampOrderViolationCount"] += 1
                last_ts = ts_kst
        presence_by_key = {}
        for row in presence_rows:
            key = presence_key(row)
            if key in presence_by_key:
                qc_summary["presenceDuplicateCount"] += 1
            presence_by_key[key] = row
        requested_pairs = set(request_index["requestedPairs"])
        for key, row in presence_by_key.items():
            if key not in requested_pairs:
                qc_summary["unexpectedPresenceCount"] += 1
                continue
            group_rows = grouped.get(key) or []
            if int(row.get("barCount") or 0) != len(group_rows):
                qc_summary["presenceBarCountMismatchCount"] += 1
            if group_rows:
                expected_first = group_rows[0]["tsKst"]
                expected_last = group_rows[-1]["tsKst"]
                if str(row.get("firstTsKst") or "").strip() != expected_first or str(row.get("lastTsKst") or "").strip() != expected_last:
                    qc_summary["presenceRangeMismatchCount"] += 1
        qc_summary["missingPresenceCount"] = len(requested_pairs - set(presence_by_key.keys()))
        candle_map = load_daily_candle_map(candle_path, requested_pairs)
        for pair in requested_pairs:
            group_rows = grouped.get(pair) or []
            if not group_rows:
                continue
            aggregated = aggregate_daily_from_intraday_rows(group_rows)
            candle = candle_map.get(pair)
            if candle is None or any(int(aggregated[key]) != int(candle[key]) for key in ("open", "high", "low", "close", "volume")):
                qc_summary["dailyMismatchCount"] += 1
        checkpoint_dir = stage_root / "checkpoints"
        checkpoint_paths = sorted(checkpoint_dir.glob("*.json"))
        qc_summary["checkpointCount"] = len(checkpoint_paths)
        for path in checkpoint_paths:
            with open(path, encoding="utf-8") as fh:
                checkpoint = json.load(fh)
            if str(checkpoint.get("status") or "").strip() != "completed":
                qc_summary["checkpointFailureCount"] += 1
        fail_count = sum(
            int(qc_summary[key] or 0)
            for key in (
                "duplicateBarCount",
                "timestampOrderViolationCount",
                "ohlcIntegrityViolationCount",
                "tradingDateMismatchCount",
                "sessionBoundsViolationCount",
                "unexpectedPresenceCount",
                "missingPresenceCount",
                "presenceDuplicateCount",
                "presenceBarCountMismatchCount",
                "presenceRangeMismatchCount",
                "sourceMismatchCount",
                "apiIdMismatchCount",
                "dailyMismatchCount",
                "checkpointFailureCount",
            )
        )
        if fail_count > 0:
            qc_summary["failureReason"] = f"intraday_1m_qc_failures={fail_count}"
            write_json(stage_root / STAGE_QC_SUMMARY_BASENAME, qc_summary)
            raise SystemExit(f"Kiwoom intraday 1m stage QC failed failure_count={fail_count}")
        qc_summary["status"] = "passed"
        write_json(stage_root / STAGE_QC_SUMMARY_BASENAME, qc_summary)
        print(
            "DONE qc_kiwoom_intraday_1m_stage "
            f"row_count={len(rows)} presence_rows={len(presence_rows)} requested_pairs={request_index['requestedPairCount']}",
            flush=True,
        )
    except Exception as exc:
        qc_summary["failureReason"] = f"{type(exc).__name__}:{exc}"
        write_json(stage_root / STAGE_QC_SUMMARY_BASENAME, qc_summary)
        raise


if __name__ == "__main__":
    main()
