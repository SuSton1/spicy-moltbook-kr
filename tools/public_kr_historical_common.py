#!/usr/bin/env python3

import json
import zlib
from datetime import date, timedelta
from pathlib import Path
from tempfile import NamedTemporaryFile
import shutil

from fill_public_kr_daily import parse_day, parse_int, to_date_key


STAGE_SUMMARY_BASENAME = "summary.json"
STAGE_QC_SUMMARY_BASENAME = "qc_summary.json"
STAGE_SYMBOL_RESULTS_BASENAME = "symbol_results.jsonl"
PARTITION_ROWSET_BASENAME = "rows.jsonl"


def ensure_parent_dir(path):
    Path(path).parent.mkdir(parents=True, exist_ok=True)


def write_json(path, payload):
    output_path = Path(path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile("w", encoding="utf-8", delete=False, dir=str(output_path.parent)) as tmp:
        json.dump(payload, tmp, ensure_ascii=False, indent=2)
        tmp.write("\n")
        temp_path = Path(tmp.name)
    shutil.move(str(temp_path), str(output_path))
    return output_path


def iter_jsonl(path):
    input_path = Path(path)
    if not input_path.exists():
        return
    with open(input_path, encoding="utf-8") as fh:
        for line in fh:
            text = line.strip()
            if not text:
                continue
            yield json.loads(text)


def write_jsonl(path, rows):
    output_path = Path(path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile("w", encoding="utf-8", delete=False, dir=str(output_path.parent)) as tmp:
        for row in rows or []:
            tmp.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")))
            tmp.write("\n")
        temp_path = Path(tmp.name)
    shutil.move(str(temp_path), str(output_path))
    return output_path


def quarter_for_day(day):
    return ((int(day.month) - 1) // 3) + 1


def partition_dir_for_date_key(date_key):
    day = parse_day(date_key)
    return f"year={day.year:04d}/quarter=Q{quarter_for_day(day)}"


def partition_file_path(stage_root, kind, date_key):
    return Path(stage_root) / kind / partition_dir_for_date_key(date_key) / PARTITION_ROWSET_BASENAME


def sort_rows(rows, key_name):
    return sorted(
        rows or [],
        key=lambda row: (
            str(row.get(key_name) or ""),
            str(row.get("symbol") or ""),
        ),
    )


def write_partitioned_rows(stage_root, kind, rows, key_name):
    grouped = {}
    for row in rows or []:
        date_key = str(row.get(key_name) or "").strip()
        if not date_key:
            raise ValueError(f"missing {key_name} for partitioned row in kind={kind}")
        output_path = partition_file_path(stage_root, kind, date_key)
        grouped.setdefault(output_path, []).append(dict(row))
    written = []
    for output_path, group_rows in sorted(grouped.items(), key=lambda item: str(item[0])):
        write_jsonl(output_path, sort_rows(group_rows, key_name))
        written.append(str(output_path))
    return written


def iter_partition_files(stage_root, kind):
    base = Path(stage_root) / kind
    if not base.exists():
        return
    for path in sorted(base.rglob(PARTITION_ROWSET_BASENAME)):
        if path.is_file():
            yield path


def load_partition_rows(stage_root, kind, key_name, date_from_key=None, date_to_key=None):
    rows = []
    for path in iter_partition_files(stage_root, kind) or []:
        for row in iter_jsonl(path):
            date_key = str(row.get(key_name) or "").strip()
            if date_from_key and date_key < date_from_key:
                continue
            if date_to_key and date_key > date_to_key:
                continue
            rows.append(row)
    return sort_rows(rows, key_name)


def iter_quarter_ranges(day_from, day_to):
    ranges = []
    cursor = date(int(day_from.year), int(day_from.month), int(day_from.day))
    while cursor <= day_to:
        quarter = quarter_for_day(cursor)
        quarter_start_month = ((quarter - 1) * 3) + 1
        quarter_end_month = quarter_start_month + 2
        if quarter_end_month == 12:
            next_quarter = date(cursor.year + 1, 1, 1)
        else:
            next_quarter = date(cursor.year, quarter_end_month + 1, 1)
        quarter_start = date(cursor.year, quarter_start_month, 1)
        quarter_end = min(day_to, next_quarter.fromordinal(next_quarter.toordinal() - 1))
        effective_start = max(day_from, quarter_start)
        effective_end = quarter_end
        ranges.append(
            {
                "year": int(effective_start.year),
                "quarter": int(quarter_for_day(effective_start)),
                "from": to_date_key(effective_start),
                "to": to_date_key(effective_end),
            }
        )
        cursor = next_quarter
    return ranges


def stable_symbol_shard(symbol, shard_count):
    normalized = str(symbol or "").strip()
    if not normalized.isdigit():
        raise ValueError(f"invalid symbol for shard assignment: {symbol}")
    shard_total = max(1, int(shard_count or 1))
    return zlib.crc32(normalized.encode("ascii")) % shard_total


def normalize_security_type(row):
    candidates = [
        row.get("type"),
        row.get("securityType"),
        row.get("security_type"),
    ]
    for value in candidates:
        text = str(value or "").strip().upper()
        if text:
            return text
    raise ValueError(f"missing security type for symbol={row.get('symbol')}")


def normalize_market_code(row):
    candidates = [
        row.get("marketCode"),
        row.get("market_code"),
    ]
    for value in candidates:
        text = str(value or "").strip().upper()
        if text:
            return text
    raise ValueError(f"missing marketCode for symbol={row.get('symbol')}")


def parse_optional_day(raw):
    text = str(raw or "").strip()
    if not text:
        return None
    return parse_day(text)


def lifecycle_intersects(row, day_from, day_to):
    listed_from = parse_day(row.get("listedFrom"))
    delisted_on = parse_optional_day(row.get("delistedOn"))
    effective_from = max(day_from, listed_from)
    # KRX price endpoints stop at the trading day before `delistedOn`.
    # Treat lifecycle delistedOn as an exclusive upper bound for stageable trading rows.
    last_trading_day = (delisted_on - timedelta(days=1)) if delisted_on else day_to
    effective_to = min(day_to, last_trading_day)
    if effective_from > effective_to:
        return None
    return {
        "listedFrom": to_date_key(listed_from),
        "delistedOn": to_date_key(delisted_on) if delisted_on else None,
        "effectiveFrom": to_date_key(effective_from),
        "effectiveTo": to_date_key(effective_to),
    }


def load_historical_lifecycle(path, *, day_from, day_to, shard_index=None, shard_count=None, security_type="COMMON"):
    lifecycle_path = Path(path)
    if not lifecycle_path.exists():
        raise SystemExit(f"missing lifecycle path: {lifecycle_path}")
    by_symbol = {}
    for row in iter_jsonl(lifecycle_path):
        symbol = str(row.get("symbol") or "").strip()
        if not symbol or not symbol.isdigit() or len(symbol) != 6:
            raise ValueError(f"invalid lifecycle symbol: {symbol or '<empty>'}")
        normalized_type = normalize_security_type(row)
        if str(security_type or "").strip().upper() and normalized_type != str(security_type).strip().upper():
            continue
        intersection = lifecycle_intersects(row, day_from, day_to)
        if intersection is None:
            continue
        if shard_count is not None and shard_index is not None:
            if stable_symbol_shard(symbol, shard_count) != int(shard_index):
                continue
        if symbol in by_symbol:
            raise ValueError(f"duplicate lifecycle symbol in requested range: {symbol}")
        by_symbol[symbol] = {
            "symbol": symbol,
            "name": str(row.get("name") or symbol).strip() or symbol,
            "fullCode": str(row.get("fullCode") or "").strip() or None,
            "marketCode": normalize_market_code(row),
            "type": normalized_type,
            "listedFrom": intersection["listedFrom"],
            "delistedOn": intersection["delistedOn"],
            "effectiveFrom": intersection["effectiveFrom"],
            "effectiveTo": intersection["effectiveTo"],
            "source": str(row.get("source") or "").strip() or None,
        }
    return by_symbol


def load_historical_share_intervals(path, *, symbol_filter=None):
    shares_path = Path(path)
    if not shares_path.exists():
        raise SystemExit(f"missing historical shares path: {shares_path}")
    allowed_symbols = None
    if symbol_filter is not None:
        allowed_symbols = {str(symbol or "").strip() for symbol in symbol_filter if str(symbol or "").strip()}
    by_symbol = {}
    for row in iter_jsonl(shares_path):
        symbol = str(row.get("symbol") or "").strip()
        if not symbol or not symbol.isdigit() or len(symbol) != 6:
            raise ValueError(f"invalid shares symbol: {symbol or '<empty>'}")
        if allowed_symbols is not None and symbol not in allowed_symbols:
            continue
        effective_from = parse_day(row.get("effectiveFrom"))
        effective_to = parse_day(row.get("effectiveTo"))
        if effective_from > effective_to:
            raise ValueError(f"shares interval inverted for symbol={symbol}")
        shares_outstanding = parse_int(row.get("sharesOutstanding"))
        if shares_outstanding is None or shares_outstanding <= 0:
            raise ValueError(f"invalid sharesOutstanding for symbol={symbol}")
        entry = {
            "effectiveFrom": to_date_key(effective_from),
            "effectiveTo": to_date_key(effective_to),
            "sharesOutstanding": int(shares_outstanding),
            "source": str(row.get("source") or "").strip() or None,
        }
        by_symbol.setdefault(symbol, []).append(entry)
    for symbol, rows in by_symbol.items():
        rows.sort(key=lambda row: (row["effectiveFrom"], row["effectiveTo"]))
        prev_to = None
        for row in rows:
            if prev_to is not None and row["effectiveFrom"] <= prev_to:
                raise ValueError(f"overlapping shares intervals for symbol={symbol}")
            prev_to = row["effectiveTo"]
    return by_symbol


def resolve_share_count(intervals_by_symbol, symbol, date_key):
    rows = intervals_by_symbol.get(symbol) or []
    for row in rows:
        if row["effectiveFrom"] <= date_key <= row["effectiveTo"]:
            return int(row["sharesOutstanding"])
    return None


def load_stage_summary(stage_root):
    path = Path(stage_root) / STAGE_SUMMARY_BASENAME
    if not path.exists():
        raise SystemExit(f"missing stage summary: {path}")
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def load_stage_qc_summary(stage_root):
    path = Path(stage_root) / STAGE_QC_SUMMARY_BASENAME
    if not path.exists():
        raise SystemExit(f"missing stage qc summary: {path}")
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)
