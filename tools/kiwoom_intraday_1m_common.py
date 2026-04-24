#!/usr/bin/env python3

from datetime import datetime, time, timedelta, timezone
from pathlib import Path

from fill_public_kr_daily import parse_int
from kiwoom_rest_client import normalize_date_key
from public_kr_historical_common import iter_jsonl, write_jsonl


KST = timezone(timedelta(hours=9))

INTRADAY_1M_STAGE_KIND = "kiwoom_intraday_1m_stage_v1"
INTRADAY_1M_STAGE_QC_KIND = "kiwoom_intraday_1m_stage_qc_v1"
INTRADAY_1M_STAGE_MERGE_KIND = "kiwoom_intraday_1m_stage_merge_journal_v1"
INTRADAY_1M_STAGE_BARSET_KIND = "bars"
INTRADAY_1M_SOURCE = "KIWOOM"
INTRADAY_1M_API_ID = "ka10080"
INTRADAY_1M_PART_BASENAME = "part-000.jsonl"
INTRADAY_1M_REGULAR_SESSION_START = time(9, 0, 0)
INTRADAY_1M_REGULAR_SESSION_END = time(15, 30, 0)


def to_dash_date_key(raw):
    compact = normalize_date_key(raw)
    if not compact:
        raise ValueError(f"missing or invalid date key: {raw!r}")
    return f"{compact[:4]}-{compact[4:6]}-{compact[6:8]}"


def normalize_minute_timestamp(raw):
    text = str(raw or "").strip()
    if not text:
        raise ValueError("missing minute timestamp")
    for fmt in ("%Y%m%d%H%M%S", "%Y%m%d%H%M"):
        try:
            parsed = datetime.strptime(text, fmt)
            if fmt == "%Y%m%d%H%M":
                parsed = parsed.replace(second=0)
            # Kiwoom minute chart `cntr_tm` is already expressed in KST-local clock time.
            parsed = parsed.replace(tzinfo=KST)
            iso = parsed.isoformat(timespec="seconds")
            return {
                "tradingDateKey": parsed.date().isoformat(),
                "tsKst": iso,
            }
        except ValueError:
            continue
    raise ValueError(f"invalid minute timestamp: {raw!r}")


def parse_ts_kst(raw):
    text = str(raw or "").strip()
    if not text:
        raise ValueError("missing tsKst")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError as exc:
        raise ValueError(f"invalid tsKst: {raw!r}") from exc
    if parsed.tzinfo is None:
        raise ValueError(f"tsKst missing timezone offset: {raw!r}")
    return parsed.astimezone(KST)


def raw_minute_timestamp_text(raw_row):
    return str((raw_row or {}).get("cntr_tm") or "").strip()


def is_placeholder_minute_raw_row(raw_row):
    fields = ("cntr_tm", "open_pric", "high_pric", "low_pric", "cur_prc", "trde_qty")
    return all(not str((raw_row or {}).get(field) or "").strip() for field in fields)


def is_regular_session_ts_kst(raw):
    parsed = parse_ts_kst(raw)
    clock = parsed.time()
    return INTRADAY_1M_REGULAR_SESSION_START <= clock <= INTRADAY_1M_REGULAR_SESSION_END


def classify_minute_raw_row(raw_row):
    if is_placeholder_minute_raw_row(raw_row):
        return "placeholder"
    timestamp_text = raw_minute_timestamp_text(raw_row)
    if not timestamp_text:
        raise ValueError("minute row missing timestamp")
    timestamp = normalize_minute_timestamp(timestamp_text)
    if not is_regular_session_ts_kst(timestamp["tsKst"]):
        return "out_of_session"
    return "regular"


def assert_regular_session_ts_kst(raw, *, symbol="", trading_date_key=""):
    if is_regular_session_ts_kst(raw):
        return
    context = []
    if str(symbol or "").strip():
        context.append(f"symbol={symbol}")
    if str(trading_date_key or "").strip():
        context.append(f"date={trading_date_key}")
    context_text = f" {' '.join(context)}" if context else ""
    raise ValueError(f"minute timestamp outside regular session:{context_text} tsKst={raw}")


def normalize_minute_value_krw(raw_row, close_price, volume):
    candidates = [
        (raw_row or {}).get("trde_prica"),
        (raw_row or {}).get("trde_amt"),
        (raw_row or {}).get("acml_tr_pbmn"),
        (raw_row or {}).get("cntr_amt"),
    ]
    for value in candidates:
        parsed = parse_int(value)
        if parsed is not None and parsed >= 0:
            return int(parsed)
    if close_price is None or volume is None:
        return None
    return int(close_price) * int(volume)


def normalize_signed_price(raw):
    parsed = parse_int(raw)
    if parsed is None:
        return None
    return abs(int(parsed))


def normalize_minute_bar(symbol, raw_row):
    timestamp = normalize_minute_timestamp((raw_row or {}).get("cntr_tm"))
    assert_regular_session_ts_kst(
        timestamp["tsKst"],
        symbol=symbol,
        trading_date_key=timestamp["tradingDateKey"],
    )
    open_price = normalize_signed_price((raw_row or {}).get("open_pric"))
    high_price = normalize_signed_price((raw_row or {}).get("high_pric"))
    low_price = normalize_signed_price((raw_row or {}).get("low_pric"))
    close_price = normalize_signed_price((raw_row or {}).get("cur_prc"))
    volume = parse_int((raw_row or {}).get("trde_qty"))
    if None in (open_price, high_price, low_price, close_price, volume):
        raise ValueError(f"minute row missing OHLCV for symbol={symbol} ts={timestamp['tsKst']}")
    if any(value <= 0 for value in (open_price, high_price, low_price, close_price)):
        raise ValueError(f"minute row contains non-positive price for symbol={symbol} ts={timestamp['tsKst']}")
    if volume < 0:
        raise ValueError(f"minute row contains negative volume for symbol={symbol} ts={timestamp['tsKst']}")
    if high_price < low_price:
        raise ValueError(f"minute row inverted range for symbol={symbol} ts={timestamp['tsKst']}")
    if not (low_price <= open_price <= high_price):
        raise ValueError(f"minute row open outside range for symbol={symbol} ts={timestamp['tsKst']}")
    if not (low_price <= close_price <= high_price):
        raise ValueError(f"minute row close outside range for symbol={symbol} ts={timestamp['tsKst']}")
    return {
        "symbol": str(symbol or "").strip(),
        "tradingDateKey": timestamp["tradingDateKey"],
        "tsKst": timestamp["tsKst"],
        "open": int(open_price),
        "high": int(high_price),
        "low": int(low_price),
        "close": int(close_price),
        "volume": int(volume),
        "valueKrw": normalize_minute_value_krw(raw_row, close_price, volume),
        "source": INTRADAY_1M_SOURCE,
        "apiId": INTRADAY_1M_API_ID,
    }


def minute_bar_key(row):
    return (
        str((row or {}).get("symbol") or "").strip(),
        str((row or {}).get("tsKst") or "").strip(),
    )


def presence_key(row):
    return (
        str((row or {}).get("symbol") or "").strip(),
        str((row or {}).get("tradingDateKey") or "").strip(),
    )


def sort_intraday_rows(rows):
    return sorted(
        rows or [],
        key=lambda row: (
            str(row.get("tradingDateKey") or ""),
            str(row.get("symbol") or ""),
            str(row.get("tsKst") or ""),
        ),
    )


def sort_presence_rows(rows):
    return sorted(
        rows or [],
        key=lambda row: (
            str(row.get("tradingDateKey") or ""),
            str(row.get("symbol") or ""),
        ),
    )


def build_intraday_request_index(
    manifest_path,
    *,
    decision_from=None,
    decision_to=None,
    shard_index=None,
    shard_count=None,
):
    from public_kr_historical_common import stable_symbol_shard

    input_path = Path(manifest_path)
    if not input_path.exists():
        raise SystemExit(f"missing manifest path: {input_path}")
    normalized_from = to_dash_date_key(decision_from) if str(decision_from or "").strip() else None
    normalized_to = to_dash_date_key(decision_to) if str(decision_to or "").strip() else None
    by_symbol = {}
    manifest_row_count = 0
    filtered_manifest_row_count = 0
    requested_pairs = set()
    requested_date_keys = set()
    for row in iter_jsonl(input_path):
        manifest_row_count += 1
        symbol = str(row.get("symbol") or "").strip()
        if not symbol or not symbol.isdigit() or len(symbol) != 6:
            raise ValueError(f"invalid manifest symbol: {symbol or '<empty>'}")
        decision_date_key = to_dash_date_key(row.get("decisionDateKey"))
        if normalized_from and decision_date_key < normalized_from:
            continue
        if normalized_to and decision_date_key > normalized_to:
            continue
        if shard_count is not None and shard_index is not None:
            if stable_symbol_shard(symbol, shard_count) != int(shard_index):
                continue
        window_date_keys = sorted({to_dash_date_key(value) for value in list(row.get("windowDateKeys") or [])})
        if not window_date_keys:
            raise ValueError(f"manifest row missing windowDateKeys for symbol={symbol} decision={decision_date_key}")
        filtered_manifest_row_count += 1
        entry = by_symbol.setdefault(
            symbol,
            {
                "requestedDateKeys": set(),
                "decisionDateKeys": set(),
                "requestIds": [],
            },
        )
        entry["requestedDateKeys"].update(window_date_keys)
        entry["decisionDateKeys"].add(decision_date_key)
        request_id = str(row.get("requestId") or "").strip()
        if request_id:
            entry["requestIds"].append(request_id)
        for date_key in window_date_keys:
            requested_pairs.add((symbol, date_key))
            requested_date_keys.add(date_key)
    finalized = {}
    for symbol, meta in sorted(by_symbol.items()):
        sorted_dates = sorted(meta["requestedDateKeys"])
        finalized[symbol] = {
            "requestedDateKeys": sorted_dates,
            "oldestRequestedDateKey": sorted_dates[0],
            "latestRequestedDateKey": sorted_dates[-1],
            "decisionDateKeys": sorted(meta["decisionDateKeys"]),
            "requestIdCount": len(meta["requestIds"]),
            "decisionCount": len(meta["decisionDateKeys"]),
        }
    return {
        "manifestPath": str(input_path.resolve()),
        "manifestRowCount": manifest_row_count,
        "filteredManifestRowCount": filtered_manifest_row_count,
        "symbolCount": len(finalized),
        "requestedPairCount": len(requested_pairs),
        "requestedDateFrom": min(requested_date_keys) if requested_date_keys else None,
        "requestedDateTo": max(requested_date_keys) if requested_date_keys else None,
        "bySymbol": finalized,
        "requestedPairs": requested_pairs,
    }


def build_presence_rows_from_bars(rows):
    grouped = {}
    for row in sort_intraday_rows(rows):
        key = (row["symbol"], row["tradingDateKey"])
        grouped.setdefault(key, []).append(row)
    presence_rows = []
    for (symbol, trading_date_key), group_rows in sorted(grouped.items()):
        first_row = group_rows[0]
        last_row = group_rows[-1]
        presence_rows.append(
            {
                "symbol": symbol,
                "tradingDateKey": trading_date_key,
                "barCount": len(group_rows),
                "firstTsKst": first_row["tsKst"],
                "lastTsKst": last_row["tsKst"],
                "status": "complete",
                "source": INTRADAY_1M_SOURCE,
            }
        )
    return sort_presence_rows(presence_rows)


def intraday_partition_file_path(root_dir, kind, trading_date_key):
    return Path(root_dir) / kind / f"date={to_dash_date_key(trading_date_key)}" / INTRADAY_1M_PART_BASENAME


def write_intraday_partition_rows(root_dir, kind, rows):
    grouped = {}
    for row in rows or []:
        trading_date_key = str(row.get("tradingDateKey") or "").strip()
        if not trading_date_key:
            raise ValueError(f"missing tradingDateKey for {kind} row")
        output_path = intraday_partition_file_path(root_dir, kind, trading_date_key)
        grouped.setdefault(output_path, []).append(dict(row))
    written = []
    for output_path, group_rows in sorted(grouped.items(), key=lambda item: str(item[0])):
        output_path.parent.mkdir(parents=True, exist_ok=True)
        write_jsonl(output_path, sort_intraday_rows(group_rows))
        written.append(str(output_path))
    return written


def iter_intraday_partition_paths(root_dir, kind):
    base = Path(root_dir) / kind
    if not base.exists():
        return
    for path in sorted(base.rglob(INTRADAY_1M_PART_BASENAME)):
        if path.is_file():
            yield path


def load_intraday_partition_rows(root_dir, kind, *, date_from=None, date_to=None):
    rows = []
    for path in iter_intraday_partition_paths(root_dir, kind) or []:
        date_key = str(path.parent.name or "").replace("date=", "", 1)
        if date_from and date_key < str(date_from):
            continue
        if date_to and date_key > str(date_to):
            continue
        rows.extend(iter_jsonl(path))
    return sort_intraday_rows(rows)


def load_intraday_rows_for_date(root_dir, kind, trading_date_key):
    path = intraday_partition_file_path(root_dir, kind, trading_date_key)
    return sort_intraday_rows(list(iter_jsonl(path)))


def canonical_intraday_part_path(data_dir, trading_date_key):
    return Path(data_dir) / "intraday_1m" / f"date={to_dash_date_key(trading_date_key)}" / INTRADAY_1M_PART_BASENAME


def canonical_presence_path(data_dir):
    return Path(data_dir) / "intraday_1m_presence_daily.jsonl"


def latest_candle_date_key(candle_path):
    input_path = Path(candle_path)
    if not input_path.exists():
        raise SystemExit(f"missing candle path: {input_path}")
    latest = None
    for row in iter_jsonl(input_path):
        date_key = str(row.get("dateKey") or row.get("tradingDateKey") or "").strip()
        if date_key and (latest is None or date_key > latest):
            latest = date_key
    if not latest:
        raise SystemExit(f"candle path has no date keys: {input_path}")
    return latest


def load_symbol_latest_intraday_anchor_date_map(candle_path, symbols):
    input_path = Path(candle_path)
    if not input_path.exists():
        raise SystemExit(f"missing candle path: {input_path}")
    requested_symbols = {str(symbol or "").strip() for symbol in (symbols or []) if str(symbol or "").strip()}
    latest_by_symbol = {}
    for row in iter_jsonl(input_path):
        symbol = str(row.get("symbol") or "").strip()
        if symbol not in requested_symbols:
            continue
        date_key = str(row.get("dateKey") or row.get("tradingDateKey") or "").strip()
        if not date_key:
            continue
        try:
            volume = int(row.get("volume") or 0)
        except Exception:
            volume = 0
        if volume > 0:
            previous = latest_by_symbol.get(symbol)
            if previous is None or date_key > previous:
                latest_by_symbol[symbol] = date_key
    missing_symbols = sorted(requested_symbols - set(latest_by_symbol.keys()))
    if missing_symbols:
        preview = ",".join(missing_symbols[:8])
        raise SystemExit(
            f"missing positive-volume daily anchor dates for {len(missing_symbols)} symbols preview={preview}"
        )
    return latest_by_symbol


def load_daily_candle_map(candle_path, requested_pairs):
    input_path = Path(candle_path)
    if not input_path.exists():
        raise SystemExit(f"missing candle path: {input_path}")
    requested = set(requested_pairs or set())
    by_pair = {}
    for row in iter_jsonl(input_path):
        pair = (
            str(row.get("symbol") or "").strip(),
            str(row.get("dateKey") or row.get("tradingDateKey") or "").strip(),
        )
        if pair not in requested:
            continue
        by_pair[pair] = {
            "open": int(row.get("open")),
            "high": int(row.get("high")),
            "low": int(row.get("low")),
            "close": int(row.get("close")),
            "volume": int(row.get("volume")),
        }
    return by_pair


def aggregate_daily_from_intraday_rows(rows):
    ordered = sort_intraday_rows(rows)
    if not ordered:
        raise ValueError("cannot aggregate empty intraday rows")
    return {
        "open": int(ordered[0]["open"]),
        "high": max(int(row["high"]) for row in ordered),
        "low": min(int(row["low"]) for row in ordered),
        "close": int(ordered[-1]["close"]),
        "volume": sum(int(row["volume"]) for row in ordered),
    }


def iso_now_utc():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()
