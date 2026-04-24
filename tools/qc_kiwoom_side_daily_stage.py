#!/usr/bin/env python3

import argparse

from kiwoom_side_daily_common import (
    SIDE_DAILY_SOURCE,
    SIDE_DAILY_STAGE_KIND,
    SIDE_DAILY_STAGE_QC_KIND,
    SIDE_DAILY_STAGE_ROWSET_KIND,
    build_side_daily_request_index,
    normalize_raw_row_date_for_dataset,
    resolve_side_daily_dataset_spec,
    stage_row_key,
)
from public_kr_historical_common import (
    STAGE_QC_SUMMARY_BASENAME,
    STAGE_SYMBOL_RESULTS_BASENAME,
    iter_jsonl,
    load_partition_rows,
    load_stage_summary,
    stable_symbol_shard,
    write_json,
)


def parse_args():
    parser = argparse.ArgumentParser(description="QC Kiwoom side-daily stage artifacts against the manifest contract.")
    parser.add_argument("--stage-root", required=True)
    return parser.parse_args()


def main():
    args = parse_args()
    stage_root = args.stage_root
    summary = load_stage_summary(stage_root)
    if summary.get("kind") != SIDE_DAILY_STAGE_KIND:
        raise SystemExit(f"unexpected stage summary kind: {summary.get('kind')}")
    if summary.get("status") != "completed":
        raise SystemExit(f"stage root is not completed: {stage_root}")
    dataset = str(summary.get("dataset") or "").strip()
    spec = resolve_side_daily_dataset_spec(dataset)
    request_index = build_side_daily_request_index(
        summary.get("manifestPath"),
        decision_from=summary.get("decisionFrom"),
        decision_to=summary.get("decisionTo"),
        shard_index=summary.get("symbolShardIndex"),
        shard_count=summary.get("symbolShardCount"),
    )
    rows = load_partition_rows(stage_root, SIDE_DAILY_STAGE_ROWSET_KIND, "dateKey")
    qc_summary = {
        "kind": SIDE_DAILY_STAGE_QC_KIND,
        "dataset": dataset,
        "apiId": spec["apiId"],
        "status": "failed",
        "rowCount": len(rows),
        "requestedPairCount": request_index["requestedPairCount"],
        "duplicateCount": 0,
        "unexpectedPairCount": 0,
        "missingPairCount": 0,
        "datasetMismatchCount": 0,
        "apiIdMismatchCount": 0,
        "sourceMismatchCount": 0,
        "rawRowDateMismatchCount": 0,
        "shardMismatchCount": 0,
        "symbolResultsCount": 0,
        "failureReason": None,
    }
    try:
        seen_pairs = set()
        requested_pairs = set(request_index["requestedPairs"])
        for row in rows:
            pair = stage_row_key(row)
            if pair in seen_pairs:
                qc_summary["duplicateCount"] += 1
            seen_pairs.add(pair)
            if pair not in requested_pairs:
                qc_summary["unexpectedPairCount"] += 1
            if str(row.get("dataset") or "").strip() != dataset:
                qc_summary["datasetMismatchCount"] += 1
            if str(row.get("apiId") or "").strip() != spec["apiId"]:
                qc_summary["apiIdMismatchCount"] += 1
            if str(row.get("source") or "").strip() != SIDE_DAILY_SOURCE:
                qc_summary["sourceMismatchCount"] += 1
            raw_row = row.get("rawRow")
            if not isinstance(raw_row, dict):
                qc_summary["rawRowDateMismatchCount"] += 1
            else:
                raw_row_date = normalize_raw_row_date_for_dataset(dataset, raw_row)
                if raw_row_date != str(row.get("dateKey") or "").strip():
                    qc_summary["rawRowDateMismatchCount"] += 1
            shard_index = summary.get("symbolShardIndex")
            shard_count = summary.get("symbolShardCount")
            if shard_index is not None and shard_count is not None:
                if stable_symbol_shard(pair[0], shard_count) != int(shard_index):
                    qc_summary["shardMismatchCount"] += 1
        missing_pairs = sorted(requested_pairs - seen_pairs)
        qc_summary["missingPairCount"] = len(missing_pairs)
        symbol_results_path = str(summary.get("symbolResultsPath") or "").strip() or f"{stage_root}/{STAGE_SYMBOL_RESULTS_BASENAME}"
        qc_summary["symbolResultsCount"] = sum(1 for _ in iter_jsonl(symbol_results_path))
        if int(summary.get("rowCount") or 0) != len(rows):
            raise SystemExit(
                f"stage summary rowCount mismatch dataset={dataset}: summary={summary.get('rowCount')} actual={len(rows)}"
            )
        if int(summary.get("coveredPairCount") or 0) != len(seen_pairs):
            raise SystemExit(
                "stage summary coveredPairCount mismatch "
                f"dataset={dataset}: summary={summary.get('coveredPairCount')} actual={len(seen_pairs)}"
            )
        fail_count = sum(
            int(qc_summary[key] or 0)
            for key in (
                "duplicateCount",
                "unexpectedPairCount",
                "missingPairCount",
                "datasetMismatchCount",
                "apiIdMismatchCount",
                "sourceMismatchCount",
                "rawRowDateMismatchCount",
                "shardMismatchCount",
            )
        )
        if fail_count > 0:
            qc_summary["failureReason"] = f"side_daily_qc_failures={fail_count}"
            write_json(f"{stage_root}/{STAGE_QC_SUMMARY_BASENAME}", qc_summary)
            raise SystemExit(f"Kiwoom side-daily stage QC failed dataset={dataset} failure_count={fail_count}")
        qc_summary["status"] = "passed"
        write_json(f"{stage_root}/{STAGE_QC_SUMMARY_BASENAME}", qc_summary)
        print(
            "DONE qc_kiwoom_side_daily_stage "
            f"dataset={dataset} row_count={len(rows)} requested_pairs={request_index['requestedPairCount']}",
            flush=True,
        )
    except Exception as exc:
        qc_summary["failureReason"] = f"{type(exc).__name__}:{exc}"
        write_json(f"{stage_root}/{STAGE_QC_SUMMARY_BASENAME}", qc_summary)
        raise


if __name__ == "__main__":
    main()
