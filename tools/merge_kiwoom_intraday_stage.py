#!/usr/bin/env python3

import argparse
import fcntl
import json
import os
from datetime import datetime, timezone
from pathlib import Path

from kiwoom_intraday_1m_common import (
    INTRADAY_1M_STAGE_BARSET_KIND,
    INTRADAY_1M_STAGE_MERGE_KIND,
    canonical_intraday_part_path,
    canonical_presence_path,
    load_intraday_rows_for_date,
    presence_key,
    sort_intraday_rows,
    sort_presence_rows,
)
from public_kr_historical_common import iter_jsonl, load_stage_qc_summary, load_stage_summary, write_json, write_jsonl


def parse_args():
    parser = argparse.ArgumentParser(description="Merge QC-passed Kiwoom 1-minute intraday stage artifacts into canonical data.")
    parser.add_argument("--stage-root", action="append", required=True)
    parser.add_argument("--data-dir", default="data")
    parser.add_argument("--backup-root", default="artifacts/backups")
    parser.add_argument("--lock-path", default="artifacts/backfill/kiwoom_intraday_1m/merge.lock")
    parser.add_argument("--merge-journal", default="artifacts/backfill/kiwoom_intraday_1m/merge_journal.jsonl")
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


def load_stage_presence(stage_root):
    return list(iter_jsonl(Path(stage_root) / "presence.jsonl"))


def merge_intraday_rows(existing_rows, new_rows):
    merged = {}
    for row in existing_rows:
        key = (str(row.get("symbol") or "").strip(), str(row.get("tsKst") or "").strip())
        if key in merged:
            raise SystemExit(f"duplicate canonical intraday row symbol={key[0]} tsKst={key[1]}")
        merged[key] = dict(row)
    for row in new_rows:
        merged[(str(row.get("symbol") or "").strip(), str(row.get("tsKst") or "").strip())] = dict(row)
    return sort_intraday_rows(list(merged.values()))


def merge_presence_rows(existing_rows, new_rows):
    merged = {}
    for row in existing_rows:
        merged[presence_key(row)] = dict(row)
    for row in new_rows:
        merged[presence_key(row)] = dict(row)
    return sort_presence_rows(list(merged.values()))


def main():
    args = parse_args()
    stage_roots = [Path(path).resolve() for path in args.stage_root]
    if not stage_roots:
        raise SystemExit("missing --stage-root")
    for stage_root in stage_roots:
        summary = load_stage_summary(stage_root)
        if summary.get("status") != "completed":
            raise SystemExit(f"stage root is not completed: {stage_root}")
        qc_summary = load_stage_qc_summary(stage_root)
        if qc_summary.get("status") != "passed":
            raise SystemExit(f"stage root QC is not passed: {stage_root}")
    touched_dates = set()
    stage_presence_rows = []
    for stage_root in stage_roots:
        stage_presence_rows.extend(load_stage_presence(stage_root))
        for path in (Path(stage_root) / INTRADAY_1M_STAGE_BARSET_KIND).rglob("part-000.jsonl"):
            if path.is_file():
                touched_dates.add(str(path.parent.name).replace("date=", "", 1))
    presence_path = canonical_presence_path(args.data_dir)
    Path(args.lock_path).parent.mkdir(parents=True, exist_ok=True)
    with open(args.lock_path, "w", encoding="utf-8") as lock_fh:
        fcntl.flock(lock_fh.fileno(), fcntl.LOCK_EX)
        ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S_%f")
        backup_dir = Path(args.backup_root) / f"kiwoom_intraday_1m_merge_{ts}"
        hardlink_snapshot_if_exists(presence_path, backup_dir)
        for date_key in sorted(touched_dates):
            canonical_part = canonical_intraday_part_path(args.data_dir, date_key)
            hardlink_snapshot_if_exists(canonical_part, backup_dir / "intraday_1m" / f"date={date_key}")
            existing_rows = load_intraday_rows_for_date(args.data_dir, "intraday_1m", date_key)
            stage_rows = []
            for stage_root in stage_roots:
                stage_rows.extend(load_intraday_rows_for_date(stage_root, INTRADAY_1M_STAGE_BARSET_KIND, date_key))
            merged_rows = merge_intraday_rows(existing_rows, stage_rows)
            canonical_part.parent.mkdir(parents=True, exist_ok=True)
            write_jsonl(canonical_part, merged_rows)
        existing_presence = list(iter_jsonl(presence_path))
        merged_presence = merge_presence_rows(existing_presence, stage_presence_rows)
        presence_path.parent.mkdir(parents=True, exist_ok=True)
        write_jsonl(presence_path, merged_presence)
        journal_row = {
            "kind": INTRADAY_1M_STAGE_MERGE_KIND,
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "stageRoots": [str(path) for path in stage_roots],
            "backupDir": str(backup_dir.resolve()),
            "touchedDateCount": len(touched_dates),
            "presenceRowCount": len(stage_presence_rows),
            "presenceRowCountAfter": len(merged_presence),
        }
        append_journal(args.merge_journal, journal_row)
        write_json(backup_dir / "merge_manifest.json", journal_row)
        print(
            "DONE merge_kiwoom_intraday_stage "
            f"touched_dates={len(touched_dates)} presence_rows={len(stage_presence_rows)}",
            flush=True,
        )


if __name__ == "__main__":
    main()
