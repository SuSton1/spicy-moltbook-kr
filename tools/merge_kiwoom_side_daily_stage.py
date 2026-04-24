#!/usr/bin/env python3

import argparse
import fcntl
import json
import os
from datetime import datetime, timezone
from pathlib import Path

from kiwoom_side_daily_common import (
    SIDE_DAILY_STAGE_MERGE_KIND,
    SIDE_DAILY_STAGE_ROWSET_KIND,
    canonical_side_daily_path,
    resolve_side_daily_dataset_spec,
    sort_side_daily_rows,
    stage_row_key,
)
from public_kr_historical_common import (
    iter_jsonl,
    load_partition_rows,
    load_stage_qc_summary,
    load_stage_summary,
    write_json,
    write_jsonl,
)


def parse_args():
    parser = argparse.ArgumentParser(description="Merge QC-passed Kiwoom side-daily stage artifacts into canonical files.")
    parser.add_argument("--stage-root", action="append", required=True)
    parser.add_argument("--dataset", default="")
    parser.add_argument("--data-dir", default="data")
    parser.add_argument("--backup-root", default="artifacts/backups")
    parser.add_argument("--lock-path", default="")
    parser.add_argument("--merge-journal", default="")
    return parser.parse_args()


def hardlink_snapshot_if_exists(src, dst_dir):
    src_path = Path(src)
    if src_path.exists():
        dst_dir.mkdir(parents=True, exist_ok=True)
        dst_path = dst_dir / src_path.name
        if dst_path.exists():
            raise SystemExit(f"backup destination already exists: {dst_path}")
        try:
            os.link(src_path, dst_path)
        except OSError as exc:
            raise SystemExit(
                "failed to create hardlink backup snapshot "
                f"src={src_path} dst={dst_path}: {exc}"
            ) from exc


def append_journal(path, payload):
    output_path = Path(path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
        fh.write("\n")


def load_stage_rows(stage_roots):
    rows = []
    for stage_root in stage_roots:
        rows.extend(load_partition_rows(stage_root, SIDE_DAILY_STAGE_ROWSET_KIND, "dateKey"))
    return sort_side_daily_rows(rows)


def ensure_unique(rows):
    seen = set()
    for row in rows:
        key = stage_row_key(row)
        if key in seen:
            raise SystemExit(f"duplicate side-daily row across stage roots symbol={key[0]} dateKey={key[1]}")
        seen.add(key)
    return seen


def merge_sparse_rows(existing_rows, new_rows):
    merged = {}
    for row in existing_rows:
        key = stage_row_key(row)
        if key in merged:
            raise SystemExit(f"duplicate canonical side-daily row symbol={key[0]} dateKey={key[1]}")
        merged[key] = dict(row)
    for row in new_rows:
        merged[stage_row_key(row)] = dict(row)
    return sort_side_daily_rows(list(merged.values()))


def main():
    args = parse_args()
    stage_roots = [Path(path).resolve() for path in args.stage_root]
    if not stage_roots:
        raise SystemExit("missing --stage-root")
    dataset = str(args.dataset or "").strip()
    if not dataset:
        first_summary = load_stage_summary(stage_roots[0])
        dataset = str(first_summary.get("dataset") or "").strip()
    spec = resolve_side_daily_dataset_spec(dataset)
    for stage_root in stage_roots:
        summary = load_stage_summary(stage_root)
        if summary.get("status") != "completed":
            raise SystemExit(f"stage root is not completed: {stage_root}")
        if str(summary.get("dataset") or "").strip() != dataset:
            raise SystemExit(f"dataset mismatch across stage roots: expected={dataset} root={stage_root}")
        qc_summary = load_stage_qc_summary(stage_root)
        if qc_summary.get("status") != "passed":
            raise SystemExit(f"stage root QC is not passed: {stage_root}")

    rows = load_stage_rows(stage_roots)
    ensure_unique(rows)
    canonical_path = canonical_side_daily_path(args.data_dir, dataset)
    canonical_path.parent.mkdir(parents=True, exist_ok=True)
    lock_path = str(args.lock_path or "").strip() or f"artifacts/backfill/kiwoom_side_daily/{dataset}.merge.lock"
    merge_journal = str(args.merge_journal or "").strip() or "artifacts/backfill/kiwoom_side_daily/merge_journal.jsonl"
    Path(lock_path).parent.mkdir(parents=True, exist_ok=True)

    with open(lock_path, "w", encoding="utf-8") as lock_fh:
        fcntl.flock(lock_fh.fileno(), fcntl.LOCK_EX)
        ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S_%f")
        backup_dir = Path(args.backup_root) / f"kiwoom_side_daily_merge_{dataset}_{ts}"
        hardlink_snapshot_if_exists(canonical_path, backup_dir)
        existing_rows = list(iter_jsonl(canonical_path))
        merged_rows = merge_sparse_rows(existing_rows, rows)
        write_jsonl(canonical_path, merged_rows)
        journal_row = {
            "kind": SIDE_DAILY_STAGE_MERGE_KIND,
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "dataset": dataset,
            "apiId": spec["apiId"],
            "stageRoots": [str(path) for path in stage_roots],
            "backupDir": str(backup_dir.resolve()),
            "rowCount": len(rows),
            "canonicalPath": str(canonical_path.resolve()),
            "canonicalRowCountAfter": len(merged_rows),
        }
        append_journal(merge_journal, journal_row)
        write_json(backup_dir / "merge_manifest.json", journal_row)
        print(
            "DONE merge_kiwoom_side_daily_stage "
            f"dataset={dataset} row_count={len(rows)} canonical_path={canonical_path}",
            flush=True,
        )


if __name__ == "__main__":
    main()
