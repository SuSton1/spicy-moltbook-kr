#!/usr/bin/env python3

import argparse
import fcntl
import json
import os
from datetime import datetime, timezone
from pathlib import Path

from fill_public_kr_daily import (
    iso_now_utc,
    read_symbol_master,
    rewrite_jsonl_with_append,
    write_symbol_master,
)
from public_kr_historical_common import (
    load_historical_lifecycle,
    load_partition_rows,
    load_stage_qc_summary,
    load_stage_summary,
    sort_rows,
    write_json,
)


MERGE_JOURNAL_KIND = "public_kr_historical_stage_merge_journal_v1"


def parse_args():
    parser = argparse.ArgumentParser(description="Merge QC-passed historical stage artifacts into canonical data/*.jsonl.")
    parser.add_argument("--stage-root", action="append", required=True)
    parser.add_argument("--from", dest="date_from", required=True)
    parser.add_argument("--to", dest="date_to", required=True)
    parser.add_argument("--data-dir", default="data")
    parser.add_argument("--lifecycle-path", default="")
    parser.add_argument("--backup-root", default="artifacts/backups")
    parser.add_argument("--lock-path", default="artifacts/backfill/public_kr_historical/merge.lock")
    parser.add_argument("--merge-journal", default="artifacts/backfill/public_kr_historical/merge_journal.jsonl")
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


def load_rows(stage_roots, kind, key_name, date_from_key, date_to_key):
    rows = []
    for stage_root in stage_roots:
        rows.extend(load_partition_rows(stage_root, kind, key_name, date_from_key, date_to_key))
    return sort_rows(rows, key_name)


def ensure_unique(rows, key_name, label):
    seen = set()
    for row in rows:
        key = (str(row.get("symbol") or "").strip(), str(row.get(key_name) or "").strip())
        if key in seen:
            raise SystemExit(f"duplicate {label} row across stage roots symbol={key[0]} dateKey={key[1]}")
        seen.add(key)
    return seen


def append_journal(path, payload):
    output_path = Path(path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
        fh.write("\n")


def merge_historical_symbol_master(symbol_master_path, lifecycle_meta):
    rows, by_symbol = read_symbol_master(symbol_master_path)
    today_key = datetime.now(timezone.utc).date().isoformat()
    for symbol, meta in sorted((lifecycle_meta or {}).items()):
        existing = by_symbol.get(symbol)
        is_listed = not str(meta.get("delistedOn") or "").strip() or str(meta.get("delistedOn")) >= today_key
        if existing is None:
            row = {
                "symbol": symbol,
                "name": str(meta.get("name") or symbol).strip() or symbol,
                "marketCode": str(meta.get("marketCode") or "").strip() or None,
                "type": str(meta.get("type") or "COMMON").strip() or "COMMON",
                "isListed": bool(is_listed),
                "listedFrom": str(meta.get("listedFrom") or "").strip() or None,
                "delistedOn": str(meta.get("delistedOn") or "").strip() or None,
            }
            rows.append(row)
            by_symbol[symbol] = row
            continue
        existing["name"] = str(meta.get("name") or existing.get("name") or symbol).strip() or symbol
        existing["marketCode"] = str(meta.get("marketCode") or existing.get("marketCode") or "").strip() or None
        existing["type"] = str(meta.get("type") or existing.get("type") or "COMMON").strip() or "COMMON"
        existing["isListed"] = bool(is_listed)
        existing["listedFrom"] = str(meta.get("listedFrom") or existing.get("listedFrom") or "").strip() or None
        existing["delistedOn"] = str(meta.get("delistedOn") or existing.get("delistedOn") or "").strip() or None
    write_symbol_master(symbol_master_path, rows)


def main():
    args = parse_args()
    stage_roots = [Path(path).resolve() for path in args.stage_root]
    date_from_key = str(args.date_from or "").strip()
    date_to_key = str(args.date_to or "").strip()
    if not stage_roots:
        raise SystemExit("missing --stage-root")

    lifecycle_path = str(args.lifecycle_path or "").strip()
    if not lifecycle_path:
        first_summary = load_stage_summary(stage_roots[0])
        lifecycle_path = str(first_summary.get("lifecyclePath") or "").strip()
    lifecycle_meta = load_historical_lifecycle(
        lifecycle_path,
        day_from=datetime.strptime(date_from_key, "%Y-%m-%d").date(),
        day_to=datetime.strptime(date_to_key, "%Y-%m-%d").date(),
        shard_index=None,
        shard_count=None,
        security_type="COMMON",
    )

    for stage_root in stage_roots:
        summary = load_stage_summary(stage_root)
        if summary.get("status") != "completed":
            raise SystemExit(f"stage root is not completed: {stage_root}")
        qc_summary = load_stage_qc_summary(stage_root)
        if qc_summary.get("status") != "passed":
            raise SystemExit(f"stage root QC is not passed: {stage_root}")

    candle_rows = load_rows(stage_roots, "candle", "dateKey", date_from_key, date_to_key)
    universe_rows = load_rows(stage_roots, "universe", "tradingDateKey", date_from_key, date_to_key)
    nontrading_rows = load_rows(stage_roots, "nontrading", "dateKey", date_from_key, date_to_key)

    seen_candle = ensure_unique(candle_rows, "dateKey", "candle")
    seen_universe = ensure_unique(universe_rows, "tradingDateKey", "universe")
    seen_nontrading = ensure_unique(nontrading_rows, "dateKey", "nontrading")
    overlap_candle_nontrading = seen_candle & seen_nontrading
    overlap_universe_nontrading = seen_universe & seen_nontrading
    if overlap_candle_nontrading:
        raise SystemExit(f"candle/nontrading overlap detected count={len(overlap_candle_nontrading)}")
    if overlap_universe_nontrading:
        raise SystemExit(f"universe/nontrading overlap detected count={len(overlap_universe_nontrading)}")
    for pair in seen_universe:
        if pair not in seen_candle:
            raise SystemExit(f"universe row without candle symbol={pair[0]} dateKey={pair[1]}")

    data_dir = Path(args.data_dir)
    candle_path = data_dir / "candle_daily.jsonl"
    universe_path = data_dir / "universe_daily.jsonl"
    nontrading_path = data_dir / "nontrading_symbol_daily.jsonl"
    symbol_master_path = data_dir / "symbol_master.jsonl"

    lock_path = Path(args.lock_path)
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with open(lock_path, "w", encoding="utf-8") as lock_fh:
        fcntl.flock(lock_fh.fileno(), fcntl.LOCK_EX)

        ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S_%f")
        backup_dir = Path(args.backup_root) / f"historical_merge_{date_from_key}_{date_to_key}_{ts}"
        hardlink_snapshot_if_exists(candle_path, backup_dir)
        hardlink_snapshot_if_exists(universe_path, backup_dir)
        hardlink_snapshot_if_exists(nontrading_path, backup_dir)
        hardlink_snapshot_if_exists(symbol_master_path, backup_dir)

        rewrite_jsonl_with_append(
            candle_path,
            key_name="dateKey",
            date_from_key=date_from_key,
            date_to_key=date_to_key,
            new_rows=candle_rows,
        )
        rewrite_jsonl_with_append(
            universe_path,
            key_name="tradingDateKey",
            date_from_key=date_from_key,
            date_to_key=date_to_key,
            new_rows=universe_rows,
        )
        rewrite_jsonl_with_append(
            nontrading_path,
            key_name="dateKey",
            date_from_key=date_from_key,
            date_to_key=date_to_key,
            new_rows=nontrading_rows,
        )
        merge_historical_symbol_master(symbol_master_path, lifecycle_meta)
        journal_row = {
            "kind": MERGE_JOURNAL_KIND,
            "generatedAt": iso_now_utc(),
            "from": date_from_key,
            "to": date_to_key,
            "stageRoots": [str(path) for path in stage_roots],
            "backupDir": str(backup_dir.resolve()),
            "candleRowCount": len(candle_rows),
            "universeRowCount": len(universe_rows),
            "nonTradingRowCount": len(nontrading_rows),
        }
        append_journal(args.merge_journal, journal_row)
        write_json(backup_dir / "merge_manifest.json", journal_row)
        print(
            "DONE merge_public_kr_historical_stage "
            f"from={date_from_key} to={date_to_key} candle_rows={len(candle_rows)} "
            f"universe_rows={len(universe_rows)} nontrading_rows={len(nontrading_rows)} "
            f"backup_dir={backup_dir}",
            flush=True,
        )


if __name__ == "__main__":
    main()
