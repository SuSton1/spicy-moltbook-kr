#!/usr/bin/env python3

import argparse
import json
import shutil
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from tempfile import NamedTemporaryFile

from fill_public_kr_daily import (
    INVALID_CANDLE_AUDIT_DIR,
    classify_invalid_candle_row,
    sanitize_reason_key,
)


def parse_args():
    parser = argparse.ArgumentParser(
        description=(
            "Explicitly scrub existing invalid candle rows from candle_daily.jsonl and "
            "matching universe_daily.jsonl rows. Dry-run by default."
        ),
    )
    parser.add_argument("--data-dir", default="data")
    parser.add_argument("--audit-dir", default=INVALID_CANDLE_AUDIT_DIR)
    parser.add_argument("--backup-root", default="artifacts/backups")
    parser.add_argument("--from", dest="date_from")
    parser.add_argument("--to", dest="date_to")
    parser.add_argument("--apply", action="store_true")
    return parser.parse_args()


def copy_backup(path, backup_dir):
    if not path.exists():
        return None
    backup_dir.mkdir(parents=True, exist_ok=True)
    target = backup_dir / path.name
    shutil.copy2(path, target)
    return target


def rewrite_jsonl_excluding(path, *, key_name, pairs_to_remove):
    removed = 0
    with NamedTemporaryFile("w", encoding="utf-8", delete=False, dir=str(path.parent)) as tmp:
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                row = json.loads(line)
                pair = (str(row.get("symbol") or "").strip(), str(row.get(key_name) or "").strip())
                if pair in pairs_to_remove:
                    removed += 1
                    continue
                tmp.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")))
                tmp.write("\n")
        temp_path = Path(tmp.name)
    shutil.move(str(temp_path), str(path))
    return removed


def main():
    args = parse_args()
    root = Path.cwd()
    data_dir = root / args.data_dir
    candle_path = data_dir / "candle_daily.jsonl"
    universe_path = data_dir / "universe_daily.jsonl"
    if not candle_path.exists():
        raise SystemExit(f"missing candle path: {candle_path}")
    if not universe_path.exists():
        raise SystemExit(f"missing universe path: {universe_path}")

    invalid_pairs = set()
    invalid_rows = []
    reason_counts = defaultdict(int)
    with open(candle_path, encoding="utf-8") as fh:
        for line in fh:
            row = json.loads(line)
            symbol = str(row.get("symbol") or "").strip()
            date_key = str(row.get("dateKey") or "").strip()
            if not symbol or not date_key:
                continue
            if args.date_from and date_key < args.date_from:
                continue
            if args.date_to and date_key > args.date_to:
                continue
            reason = classify_invalid_candle_row(row)
            if not reason:
                continue
            invalid_pairs.add((symbol, date_key))
            reason_counts[sanitize_reason_key(reason)] += 1
            invalid_rows.append(
                {
                    "symbol": symbol,
                    "dateKey": date_key,
                    "open": row.get("open"),
                    "high": row.get("high"),
                    "low": row.get("low"),
                    "close": row.get("close"),
                    "volume": row.get("volume"),
                    "reason": reason,
                }
            )

    generated_at = datetime.now(timezone.utc)
    audit_root = root / args.audit_dir
    audit_root.mkdir(parents=True, exist_ok=True)
    summary = {
        "kind": "historical_invalid_candle_scrub_plan_v1",
        "generatedAt": generated_at.isoformat(),
        "dataPath": str(candle_path),
        "universePath": str(universe_path),
        "dateRange": {
            "from": args.date_from or None,
            "to": args.date_to or None,
        },
        "applyRequested": bool(args.apply),
        "invalidPairCount": len(invalid_pairs),
        "invalidRowCount": len(invalid_rows),
        "reasonCounts": {key: int(reason_counts[key]) for key in sorted(reason_counts)},
        "rows": invalid_rows,
    }
    summary_path = audit_root / (
        "historical_invalid_candle_scrub_plan_"
        f"{(args.date_from or 'BEGIN').replace('-', '')}_"
        f"{(args.date_to or 'END').replace('-', '')}_"
        f"{generated_at.strftime('%Y%m%d_%H%M%S')}.json"
    )
    with open(summary_path, "w", encoding="utf-8") as fh:
        json.dump(summary, fh, ensure_ascii=False, indent=2)
        fh.write("\n")

    if not invalid_pairs:
        print(f"NOOP scrub_public_kr_invalid_candles invalid_pairs=0 audit={summary_path}", flush=True)
        return

    if not args.apply:
        print(
            "DRYRUN scrub_public_kr_invalid_candles "
            f"invalid_pairs={len(invalid_pairs)} invalid_rows={len(invalid_rows)} audit={summary_path}",
            flush=True,
        )
        return

    backup_dir = root / args.backup_root / f"invalid_candle_scrub_{generated_at.strftime('%Y%m%d_%H%M%S')}"
    candle_backup = copy_backup(candle_path, backup_dir)
    universe_backup = copy_backup(universe_path, backup_dir)
    removed_candle_rows = rewrite_jsonl_excluding(candle_path, key_name="dateKey", pairs_to_remove=invalid_pairs)
    removed_universe_rows = rewrite_jsonl_excluding(
        universe_path,
        key_name="tradingDateKey",
        pairs_to_remove=invalid_pairs,
    )
    result = {
        "kind": "historical_invalid_candle_scrub_result_v1",
        "generatedAt": generated_at.isoformat(),
        "invalidPairCount": len(invalid_pairs),
        "removedCandleRows": removed_candle_rows,
        "removedUniverseRows": removed_universe_rows,
        "backupDir": str(backup_dir),
        "candleBackupPath": str(candle_backup) if candle_backup else None,
        "universeBackupPath": str(universe_backup) if universe_backup else None,
        "planPath": str(summary_path),
        "postScrubReminder": (
            "If filtered predictive or legacy apply depends on candle_daily.jsonl-derived sidecars, "
            "rebuild the affected sidecars after this scrub."
        ),
    }
    result_path = audit_root / (
        "historical_invalid_candle_scrub_result_"
        f"{generated_at.strftime('%Y%m%d_%H%M%S')}.json"
    )
    with open(result_path, "w", encoding="utf-8") as fh:
        json.dump(result, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    print(
        "DONE scrub_public_kr_invalid_candles "
        f"invalid_pairs={len(invalid_pairs)} removed_candle_rows={removed_candle_rows} "
        f"removed_universe_rows={removed_universe_rows} backup_dir={backup_dir} result={result_path}",
        flush=True,
    )


if __name__ == "__main__":
    main()
