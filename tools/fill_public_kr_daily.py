#!/usr/bin/env python3

import argparse
import re
import json
import shutil
import sys
import time
from collections import defaultdict, deque
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from html import unescape
from pathlib import Path
from tempfile import NamedTemporaryFile

import requests


YAHOO_HEADERS = {"User-Agent": "Mozilla/5.0"}
FINDER_MARKETS = {"STK", "KSQ"}
NAVER_HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Referer": "https://finance.naver.com/",
}
NAVER_MARKET_SOSOK = {"STK": 0, "KSQ": 1}
INVALID_CANDLE_AUDIT_DIR = "artifacts/data_quality"
NONTRADING_STATUS_BASENAME = "nontrading_symbol_daily.jsonl"
FILL_SUMMARY_VERSION = 1
FILL_STATUS_COMPLETED = "completed"
FILL_STATUS_COMPLETED_WITH_NONTRADING_STATUS = "completed_with_nontrading_status"
FILL_STATUS_NOOP_EMPTY_RANGE = "noop_empty_range"
FILL_STATUS_DRY_RUN = "dry_run"
FILL_STATUS_FAILED_FATAL_INVALID = "failed_fatal_invalid"
FILL_STATUS_FAILED_RUNTIME_ERROR = "failed_runtime_error"


class InvalidCandleRowsError(RuntimeError):
    def __init__(self, *, symbol, source_name, invalid_rows):
        self.symbol = str(symbol or "").strip()
        self.source_name = str(source_name or "").strip() or "unknown"
        self.invalid_rows = list(invalid_rows or [])
        invalid_count = len(self.invalid_rows)
        super().__init__(
            f"invalid candle rows detected symbol={self.symbol or 'UNKNOWN'} "
            f"source={self.source_name} invalid_rows={invalid_count}"
        )


def load_pykrx_symbol_search():
    try:
        from pykrx.website.krx.market.core import 상장종목검색
    except ModuleNotFoundError as exc:
        missing = exc.name or "dependency"
        raise SystemExit(
            f"missing python dependency: {missing}. "
            "Install on server first, for example: python3 -m venv --without-pip .venv-datafill && "
            ".venv-datafill/bin/python /tmp/get-pip.py && .venv-datafill/bin/pip install pykrx"
        ) from exc
    return 상장종목검색


def instantiate_pykrx_symbol_search():
    symbol_search_cls = load_pykrx_symbol_search()
    try:
        return symbol_search_cls()
    except TypeError as exc:
        raise SystemExit(
            "invalid pykrx symbol search contract: 상장종목검색 must be instantiable without arguments"
        ) from exc


def parse_args():
    parser = argparse.ArgumentParser(
        description=(
            "Fill KR daily candle/universe data using public-only sources. "
            "This tool uses KRX finder for symbol discovery and public finance pages for daily OHLCV."
        ),
    )
    parser.add_argument("--from", dest="date_from", help="YYYY-MM-DD; default resolves from existing data")
    parser.add_argument("--to", dest="date_to", help="YYYY-MM-DD; default is today")
    parser.add_argument("--data-dir", default="data")
    parser.add_argument("--config", default="config/lab.config.server.lite.json")
    parser.add_argument("--retries", type=int, default=4)
    parser.add_argument("--sleep-ms", type=int, default=250)
    parser.add_argument("--max-workers", type=int, default=12)
    parser.add_argument(
        "--rewind-days",
        type=int,
        default=1,
        help="When --from is omitted, re-fetch the latest N existing days before appending new dates. 0 means start after the latest existing date.",
    )
    parser.add_argument("--refresh-symbol-master", action="store_true")
    parser.add_argument("--update-anchor", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--run-id", default="")
    parser.add_argument("--summary-out", default="")
    parser.add_argument(
        "--invalid-candle-audit-dir",
        default=INVALID_CANDLE_AUDIT_DIR,
        help="Directory for fail-fast invalid candle audits",
    )
    parser.add_argument(
        "--universe-mode",
        choices=("core_threshold", "all_common"),
        default="core_threshold",
        help="core_threshold preserves the historical universe_daily shape more closely",
    )
    return parser.parse_args()


def log(message):
    print(message, flush=True)


def parse_day(raw):
    text = str(raw or "").strip()
    for fmt in ("%Y-%m-%d", "%Y%m%d"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"invalid date: {raw}")


def to_date_key(day):
    return day.strftime("%Y-%m-%d")


def load_filters(config_path):
    with open(config_path, encoding="utf-8") as fh:
        config = json.load(fh)
    filters = config.get("filters") or {}
    return {
        "min_market_cap": int(filters.get("minMarketCapKrw") or 0),
        "min_liquidity": int(filters.get("minAvgTradingValue20dKrw") or 0),
    }


def parse_float(value):
    if value is None:
        return None
    if isinstance(value, str):
        text = value.strip()
        if not text or text in {"N/A", "nan", "NaN", "--"}:
            return None
        text = (
            text.replace(",", "")
            .replace("%", "")
            .replace("−", "-")
            .replace("▲", "")
            .replace("△", "")
            .replace("▼", "-")
            .replace("▽", "-")
        )
    else:
        text = value
    try:
        number = float(text)
    except (TypeError, ValueError):
        return None
    if number != number:
        return None
    return number


def parse_int(value):
    number = parse_float(value)
    if number is None:
        return None
    return int(round(number))


def sanitize_reason_key(value):
    text = re.sub(r"[^a-z0-9]+", "_", str(value or "").strip().lower())
    return text.strip("_") or "unknown"


def summarize_reason_counts(rows):
    counts = defaultdict(int)
    for row in rows or []:
        counts[sanitize_reason_key(row.get("reason"))] += 1
    return {key: int(counts[key]) for key in sorted(counts)}


def iso_now_utc():
    return datetime.now(timezone.utc).isoformat()


def first_text(value):
    text = str(value or "").strip()
    return text or None


def date_to_text(day):
    return to_date_key(day) if day is not None else None


def classify_invalid_candle_row(row):
    open_price = parse_int(row.get("open"))
    high_price = parse_int(row.get("high"))
    low_price = parse_int(row.get("low"))
    close_price = parse_int(row.get("close"))
    volume = parse_int(row.get("volume"))
    if close_price and open_price == 0 and high_price == 0 and low_price == 0:
        return "close_only_placeholder"
    if any(value is not None and value < 0 for value in (open_price, high_price, low_price, close_price, volume)):
        return "negative_price_or_volume"
    if any(value is not None and value == 0 for value in (open_price, high_price, low_price, close_price)):
        return "nonpositive_ohlc"
    if high_price is not None and low_price is not None and high_price < low_price:
        return "high_below_low"
    if (
        open_price is not None
        and low_price is not None
        and high_price is not None
        and not (low_price <= open_price <= high_price)
    ):
        return "open_outside_range"
    if (
        close_price is not None
        and low_price is not None
        and high_price is not None
        and not (low_price <= close_price <= high_price)
    ):
        return "close_outside_range"
    return None


def collect_invalid_candle_rows(rows):
    invalid_rows = []
    for row in rows or []:
        reason = classify_invalid_candle_row(row)
        if not reason:
            continue
        invalid_rows.append(
            {
                "dateKey": str(row.get("dateKey", "")).strip(),
                "open": parse_int(row.get("open")),
                "high": parse_int(row.get("high")),
                "low": parse_int(row.get("low")),
                "close": parse_int(row.get("close")),
                "volume": parse_int(row.get("volume")),
                "reason": reason,
            }
        )
    return invalid_rows


def partition_symbol_series_rows(rows):
    valid_rows = []
    nontrading_rows = []
    fatal_rows = []
    for row in rows or []:
        reason = classify_invalid_candle_row(row)
        if not reason:
            valid_rows.append(dict(row))
            continue
        invalid_row = {
            "dateKey": str(row.get("dateKey", "")).strip(),
            "open": parse_int(row.get("open")),
            "high": parse_int(row.get("high")),
            "low": parse_int(row.get("low")),
            "close": parse_int(row.get("close")),
            "volume": parse_int(row.get("volume")),
            "reason": reason,
        }
        if reason == "close_only_placeholder":
            nontrading_rows.append(invalid_row)
        else:
            fatal_rows.append(invalid_row)
    return {
        "validRows": valid_rows,
        "nonTradingRows": nontrading_rows,
        "fatalRows": fatal_rows,
    }


def build_invalid_candle_symbol_report(*, symbol, source_name, invalid_rows, metadata=None):
    metadata = metadata or {}
    return {
        "symbol": str(symbol or "").strip(),
        "name": str(metadata.get("name") or symbol or "").strip() or None,
        "marketCode": str(metadata.get("marketCode") or "").strip() or None,
        "source": str(source_name or "").strip() or "unknown",
        "invalidRowCount": len(invalid_rows or []),
        "reasonCounts": summarize_reason_counts(invalid_rows),
        "rows": list(invalid_rows or []),
    }


def build_nontrading_status_row(*, symbol, source_name, row, metadata=None, generated_at=None):
    metadata = metadata or {}
    return {
        "symbol": str(symbol or "").strip(),
        "dateKey": str(row.get("dateKey") or "").strip(),
        "status": "nontrading_status",
        "reason": str(row.get("reason") or "").strip() or "unknown",
        "source": str(source_name or "").strip() or "unknown",
        "close": parse_int(row.get("close")),
        "volume": parse_int(row.get("volume")),
        "name": str(metadata.get("name") or symbol or "").strip() or None,
        "marketCode": str(metadata.get("marketCode") or "").strip() or None,
        "generatedAt": str(generated_at or iso_now_utc()),
    }


def should_classify_nontrading_placeholder_rows(*, invalid_rows):
    reasons = {str(row.get("reason") or "").strip() for row in (invalid_rows or [])}
    return bool(reasons) and reasons == {"close_only_placeholder"}


def should_skip_nontrading_placeholder_symbol(*, symbol, source_name, invalid_rows, existing_symbols):
    del symbol, source_name, existing_symbols
    return should_classify_nontrading_placeholder_rows(invalid_rows=invalid_rows)


def write_invalid_candle_audit(root, *, audit_dir, day_from_key, day_to_key, reports):
    audit_root = Path(root) / str(audit_dir or INVALID_CANDLE_AUDIT_DIR)
    audit_root.mkdir(parents=True, exist_ok=True)
    generated_at = datetime.now(timezone.utc)
    reason_counts = defaultdict(int)
    source_counts = defaultdict(int)
    invalid_row_count = 0
    for report in reports or []:
        source_counts[str(report.get("source") or "unknown")] += 1
        invalid_row_count += int(report.get("invalidRowCount") or 0)
        for reason, count in (report.get("reasonCounts") or {}).items():
            reason_counts[sanitize_reason_key(reason)] += int(count or 0)
    out = {
        "kind": "fill_public_kr_daily_invalid_candle_audit_v1",
        "generatedAt": generated_at.isoformat(),
        "dateRange": {
            "from": day_from_key,
            "to": day_to_key,
        },
        "invalidSymbolCount": len(reports or []),
        "invalidRowCount": invalid_row_count,
        "reasonCounts": {key: int(reason_counts[key]) for key in sorted(reason_counts)},
        "sourceCounts": {key: int(source_counts[key]) for key in sorted(source_counts)},
        "symbols": list(reports or []),
    }
    filename = (
        "fill_public_kr_daily_invalid_rows_"
        f"{re.sub(r'[^0-9]+', '', day_from_key)}_"
        f"{re.sub(r'[^0-9]+', '', day_to_key)}_"
        f"{generated_at.strftime('%Y%m%d_%H%M%S')}.json"
    )
    path = audit_root / filename
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    return path


def write_nontrading_placeholder_skip_audit(root, *, audit_dir, day_from_key, day_to_key, reports):
    audit_root = Path(root) / str(audit_dir or INVALID_CANDLE_AUDIT_DIR)
    audit_root.mkdir(parents=True, exist_ok=True)
    generated_at = datetime.now(timezone.utc)
    reason_counts = defaultdict(int)
    source_counts = defaultdict(int)
    skipped_row_count = 0
    for report in reports or []:
        source_counts[str(report.get("source") or "unknown")] += 1
        skipped_row_count += int(report.get("invalidRowCount") or 0)
        for reason, count in (report.get("reasonCounts") or {}).items():
            reason_counts[sanitize_reason_key(reason)] += int(count or 0)
    out = {
        "kind": "fill_public_kr_daily_nontrading_placeholder_skip_audit_v1",
        "generatedAt": generated_at.isoformat(),
        "dateRange": {
            "from": day_from_key,
            "to": day_to_key,
        },
        "skippedSymbolCount": len(reports or []),
        "skippedRowCount": skipped_row_count,
        "reasonCounts": {key: int(reason_counts[key]) for key in sorted(reason_counts)},
        "sourceCounts": {key: int(source_counts[key]) for key in sorted(source_counts)},
        "symbols": list(reports or []),
    }
    filename = (
        "fill_public_kr_daily_nontrading_placeholder_skips_"
        f"{re.sub(r'[^0-9]+', '', day_from_key)}_"
        f"{re.sub(r'[^0-9]+', '', day_to_key)}_"
        f"{generated_at.strftime('%Y%m%d_%H%M%S')}.json"
    )
    path = audit_root / filename
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    return path


def write_nontrading_status_audit(root, *, audit_dir, day_from_key, day_to_key, reports):
    audit_root = Path(root) / str(audit_dir or INVALID_CANDLE_AUDIT_DIR)
    audit_root.mkdir(parents=True, exist_ok=True)
    generated_at = datetime.now(timezone.utc)
    reason_counts = defaultdict(int)
    source_counts = defaultdict(int)
    nontrading_row_count = 0
    for report in reports or []:
        source_counts[str(report.get("source") or "unknown")] += 1
        nontrading_row_count += int(report.get("invalidRowCount") or 0)
        for reason, count in (report.get("reasonCounts") or {}).items():
            reason_counts[sanitize_reason_key(reason)] += int(count or 0)
    out = {
        "kind": "fill_public_kr_daily_nontrading_status_audit_v1",
        "generatedAt": generated_at.isoformat(),
        "dateRange": {
            "from": day_from_key,
            "to": day_to_key,
        },
        "nonTradingSymbolCount": len(reports or []),
        "nonTradingRowCount": nontrading_row_count,
        "reasonCounts": {key: int(reason_counts[key]) for key in sorted(reason_counts)},
        "sourceCounts": {key: int(source_counts[key]) for key in sorted(source_counts)},
        "symbols": list(reports or []),
    }
    filename = (
        "fill_public_kr_daily_nontrading_status_"
        f"{re.sub(r'[^0-9]+', '', day_from_key)}_"
        f"{re.sub(r'[^0-9]+', '', day_to_key)}_"
        f"{generated_at.strftime('%Y%m%d_%H%M%S')}.json"
    )
    path = audit_root / filename
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    return path


def clean_html_text(raw):
    if raw is None:
        return ""
    text = re.sub(r"<[^>]+>", " ", str(raw))
    text = unescape(text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def find_latest_date_before(path, key_name, before_date_key):
    latest = ""
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            row = json.loads(line)
            date_key = str(row.get(key_name, "")).strip()
            if date_key and date_key < before_date_key and date_key > latest:
                latest = date_key
    return latest


def collect_symbols_on_date(path, key_name, target_date_key):
    symbols = set()
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            row = json.loads(line)
            if str(row.get(key_name, "")).strip() == target_date_key:
                symbol = str(row.get("symbol", "")).strip()
                if symbol:
                    symbols.add(symbol)
    return symbols


def read_latest_date(path, key_name):
    latest = ""
    if not path.exists():
        return None
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            row = json.loads(line)
            date_key = str(row.get(key_name, "")).strip()
            if date_key and date_key > latest:
                latest = date_key
    return parse_day(latest) if latest else None


def resolve_date_range(args, candle_path, universe_path):
    latest_candle = read_latest_date(candle_path, "dateKey")
    latest_universe = read_latest_date(universe_path, "tradingDateKey")
    day_to = parse_day(args.date_to) if args.date_to else datetime.now().date()
    if args.date_from:
        day_from = parse_day(args.date_from)
    else:
        known_latest = [day for day in (latest_candle, latest_universe) if day is not None]
        if not known_latest:
            raise SystemExit("missing --from and no existing daily data found to infer range")
        base_latest = min(known_latest)
        rewind_days = max(0, int(args.rewind_days or 0))
        if rewind_days == 0:
            day_from = base_latest + timedelta(days=1)
        else:
            day_from = base_latest - timedelta(days=rewind_days - 1)
    return {
        "day_from": day_from,
        "day_to": day_to,
        "latest_candle": latest_candle,
        "latest_universe": latest_universe,
    }


def build_latest_universe_rows(universe_path, before_date_key):
    latest = {}
    with open(universe_path, encoding="utf-8") as fh:
        for line in fh:
            row = json.loads(line)
            symbol = str(row.get("symbol", "")).strip()
            date_key = str(row.get("tradingDateKey", "")).strip()
            if not symbol or not date_key or date_key >= before_date_key:
                continue
            prev = latest.get(symbol)
            if prev is None or date_key > prev["dateKey"]:
                latest[symbol] = {
                    "dateKey": date_key,
                    "marketCapKrw": parse_int(row.get("marketCapKrw")),
                }
    return latest


def build_close_lookup_for_pairs(candle_path, needed_pairs):
    out = {}
    with open(candle_path, encoding="utf-8") as fh:
        for line in fh:
            row = json.loads(line)
            symbol = str(row.get("symbol", "")).strip()
            date_key = str(row.get("dateKey", "")).strip()
            pair = (symbol, date_key)
            if pair not in needed_pairs:
                continue
            close_price = parse_int(row.get("close"))
            if close_price is not None:
                out[pair] = close_price
    return out


def build_base_shares(universe_path, candle_path, before_date_key):
    latest_universe = build_latest_universe_rows(universe_path, before_date_key)
    needed_pairs = {(symbol, row["dateKey"]) for symbol, row in latest_universe.items()}
    closes = build_close_lookup_for_pairs(candle_path, needed_pairs)
    base_shares = {}
    for symbol, row in latest_universe.items():
        market_cap = row["marketCapKrw"]
        close_price = closes.get((symbol, row["dateKey"]))
        if market_cap is None or close_price is None or close_price <= 0:
            continue
        shares = int(round(market_cap / close_price))
        if shares > 0:
            base_shares[symbol] = shares
    return base_shares


def seed_trading_value_windows(candle_path, before_date_key, symbols):
    tracked = set(symbols)
    windows = defaultdict(lambda: deque(maxlen=20))
    with open(candle_path, encoding="utf-8") as fh:
        for line in fh:
            row = json.loads(line)
            symbol = str(row.get("symbol", "")).strip()
            if symbol not in tracked:
                continue
            date_key = str(row.get("dateKey", "")).strip()
            if not date_key or date_key >= before_date_key:
                continue
            close_price = parse_int(row.get("close"))
            volume = parse_int(row.get("volume"))
            if close_price is None or volume is None:
                continue
            windows[symbol].append(close_price * volume)
    return windows


def fetch_text(url, headers, retries, sleep_ms, timeout=30):
    last_error = None
    for attempt in range(1, retries + 1):
        try:
            response = requests.get(url, headers=headers, timeout=timeout)
            response.raise_for_status()
            if response.apparent_encoding:
                response.encoding = response.apparent_encoding
            return response.text
        except Exception as exc:  # pragma: no cover - remote/network variability
            last_error = exc
            time.sleep((sleep_ms / 1000.0) * attempt)
    raise RuntimeError(f"request failed for {url}: {last_error}")


def parse_naver_market_sum_page_count(text):
    pages = [int(value) for value in re.findall(r"page=(\d+)", unescape(text or ""))]
    return max(pages) if pages else 1


def parse_naver_market_sum_rows(text):
    out = {}
    for row_html in re.findall(r"<tr[^>]*>(.*?)</tr>", text, re.IGNORECASE | re.DOTALL):
        symbol_match = re.search(r"/item/main\.naver\?code=(\d{6})", row_html)
        if not symbol_match:
            continue
        cells = [clean_html_text(cell) for cell in re.findall(r"<td[^>]*>(.*?)</td>", row_html, re.IGNORECASE | re.DOTALL)]
        if len(cells) < 8:
            continue
        listed_stock_thousands = parse_int(cells[7])
        if listed_stock_thousands is None or listed_stock_thousands <= 0:
            continue
        out[symbol_match.group(1)] = int(listed_stock_thousands * 1000)
    return out


def fetch_naver_listed_shares_map(retries, sleep_ms):
    out = {}
    for market_code, sosok in NAVER_MARKET_SOSOK.items():
        first_url = f"https://finance.naver.com/sise/sise_market_sum.naver?sosok={sosok}&page=1"
        first_text = fetch_text(first_url, NAVER_HEADERS, retries, sleep_ms)
        out.update(parse_naver_market_sum_rows(first_text))
        max_page = parse_naver_market_sum_page_count(first_text)
        for page in range(2, max_page + 1):
            url = f"https://finance.naver.com/sise/sise_market_sum.naver?sosok={sosok}&page={page}"
            text = fetch_text(url, NAVER_HEADERS, retries, sleep_ms)
            out.update(parse_naver_market_sum_rows(text))
    return out


def normalize_naver_date(text):
    digits = str(text or "").replace(".", "-").strip()
    try:
        return datetime.strptime(digits, "%Y-%m-%d").date().isoformat()
    except ValueError:
        return None


def parse_naver_daily_rows(text, day_from_key, day_to_key):
    out = []
    for row_html in re.findall(r"<tr[^>]*>(.*?)</tr>", text, re.IGNORECASE | re.DOTALL):
        cells = [clean_html_text(cell) for cell in re.findall(r"<td[^>]*>(.*?)</td>", row_html, re.IGNORECASE | re.DOTALL)]
        if len(cells) != 7:
            continue
        date_key = normalize_naver_date(cells[0])
        if not date_key or date_key < day_from_key or date_key > day_to_key:
            continue
        close_price = parse_int(cells[1])
        open_price = parse_int(cells[3])
        high_price = parse_int(cells[4])
        low_price = parse_int(cells[5])
        volume = parse_int(cells[6])
        if None in (open_price, high_price, low_price, close_price, volume):
            continue
        out.append(
            {
                "dateKey": date_key,
                "open": open_price,
                "high": high_price,
                "low": low_price,
                "close": close_price,
                "volume": volume,
            }
        )
    out.sort(key=lambda row: row["dateKey"])
    return out


def fetch_naver_series(symbol, day_from, day_to, retries, sleep_ms):
    day_from_key = to_date_key(day_from)
    day_to_key = to_date_key(day_to)
    rows_by_date = {}
    page = 1
    while page <= 20:
        url = f"https://finance.naver.com/item/sise_day.naver?code={symbol}&page={page}"
        text = fetch_text(url, NAVER_HEADERS, retries, sleep_ms)
        page_rows = parse_naver_daily_rows(text, day_from_key, day_to_key)
        if not page_rows and page > 1:
            break
        for row in page_rows:
            rows_by_date[row["dateKey"]] = row
        if page_rows:
            oldest_page_date = min(row["dateKey"] for row in page_rows)
            if oldest_page_date <= day_from_key:
                break
        page += 1
    rows = [rows_by_date[key] for key in sorted(rows_by_date)]
    return rows


def read_symbol_master(path):
    rows = []
    by_symbol = {}
    if not path.exists():
        return rows, by_symbol
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            row = json.loads(line)
            symbol = str(row.get("symbol", "")).strip()
            if not symbol:
                continue
            rows.append(row)
            by_symbol[symbol] = row
    return rows, by_symbol


def write_symbol_master(path, rows):
    ordered = sorted(rows, key=lambda row: str(row.get("symbol", "")))
    with NamedTemporaryFile("w", encoding="utf-8", delete=False, dir=str(path.parent)) as tmp:
        for row in ordered:
            tmp.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")))
            tmp.write("\n")
        temp_path = Path(tmp.name)
    shutil.move(str(temp_path), str(path))


def merge_symbol_master(path, metadata_by_symbol):
    rows, by_symbol = read_symbol_master(path)
    for symbol, meta in sorted(metadata_by_symbol.items()):
        name = str(meta.get("name") or symbol).strip() or symbol
        market_code = str(meta.get("marketCode") or "").strip() or None
        existing = by_symbol.get(symbol)
        if existing is None:
            row = {
                "symbol": symbol,
                "name": name,
                "marketCode": market_code,
                "type": "COMMON",
                "isListed": True,
            }
            rows.append(row)
            by_symbol[symbol] = row
            continue
        existing["name"] = name
        if market_code:
            existing["marketCode"] = market_code
        if existing.get("type") in (None, "", "UNKNOWN"):
            existing["type"] = "COMMON"
        if existing.get("isListed") is not False:
            existing["isListed"] = True
    write_symbol_master(path, rows)


def build_fill_summary(
    *,
    run_id,
    status,
    day_from_key,
    day_to_key,
    latest_candle_before,
    latest_universe_before,
    latest_candle_after,
    latest_universe_after,
    latest_written_date,
    valid_candle_rows,
    valid_universe_rows,
    nontrading_symbol_count,
    nontrading_row_count,
    fatal_invalid_symbol_count,
    fatal_invalid_row_count,
    audit_paths=None,
    nontrading_path=None,
    existing_symbol_seed_count=0,
    share_symbol_count=0,
    failure_reason=None,
):
    return {
        "version": FILL_SUMMARY_VERSION,
        "generatedAt": iso_now_utc(),
        "runId": first_text(run_id),
        "status": str(status or "").strip() or FILL_STATUS_FAILED_RUNTIME_ERROR,
        "from": first_text(day_from_key),
        "to": first_text(day_to_key),
        "latestCandleBefore": first_text(latest_candle_before),
        "latestUniverseBefore": first_text(latest_universe_before),
        "latestCandleAfter": first_text(latest_candle_after),
        "latestUniverseAfter": first_text(latest_universe_after),
        "latestWrittenDate": first_text(latest_written_date),
        "validCandleRows": int(valid_candle_rows or 0),
        "validUniverseRows": int(valid_universe_rows or 0),
        "nonTradingSymbolCount": int(nontrading_symbol_count or 0),
        "nonTradingRowCount": int(nontrading_row_count or 0),
        "fatalInvalidSymbolCount": int(fatal_invalid_symbol_count or 0),
        "fatalInvalidRowCount": int(fatal_invalid_row_count or 0),
        "existingSymbolSeedCount": int(existing_symbol_seed_count or 0),
        "shareSymbolCount": int(share_symbol_count or 0),
        "nonTradingPath": first_text(nontrading_path),
        "auditPaths": {
            "nonTradingStatus": first_text((audit_paths or {}).get("nonTradingStatus")),
            "fatalInvalid": first_text((audit_paths or {}).get("fatalInvalid")),
        },
        "failureReason": first_text(failure_reason),
    }


def write_fill_summary(summary_out, summary):
    output_path = Path(str(summary_out or "").strip())
    if not str(summary_out or "").strip():
        return None
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as fh:
        json.dump(summary, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    return output_path


def rewrite_jsonl_with_append(path, *, key_name, date_from_key, date_to_key, new_rows):
    with NamedTemporaryFile("w", encoding="utf-8", delete=False, dir=str(path.parent)) as tmp:
        if path.exists():
            with open(path, encoding="utf-8") as fh:
                for line in fh:
                    row = json.loads(line)
                    date_key = str(row.get(key_name, "")).strip()
                    if date_from_key <= date_key <= date_to_key:
                        continue
                    tmp.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")))
                    tmp.write("\n")
        for row in new_rows:
            tmp.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")))
            tmp.write("\n")
        temp_path = Path(tmp.name)
    shutil.move(str(temp_path), str(path))


def update_anchor_date(config_path, anchor_date_key):
    with open(config_path, encoding="utf-8") as fh:
        config = json.load(fh)
    timeline = config.get("timeline") or {}
    prev_anchor = str(timeline.get("anchorDateKey", "")).strip()
    timeline["anchorDateKey"] = anchor_date_key
    config["timeline"] = timeline
    with NamedTemporaryFile("w", encoding="utf-8", delete=False, dir=str(config_path.parent)) as tmp:
        json.dump(config, tmp, ensure_ascii=False, indent=2)
        tmp.write("\n")
        temp_path = Path(tmp.name)
    shutil.move(str(temp_path), str(config_path))
    return prev_anchor


def finder_symbol_metadata():
    finder = instantiate_pykrx_symbol_search().fetch("ALL", "")
    out = {}
    for _, row in finder.iterrows():
        symbol = str(row["short_code"]).strip()
        market_code = str(row["marketCode"]).strip()
        if market_code not in FINDER_MARKETS:
            continue
        if not symbol.isdigit() or len(symbol) != 6:
            continue
        out[symbol] = {
            "name": str(row["codeName"]).strip() or symbol,
            "marketCode": market_code,
        }
    return out


def candidate_yahoo_symbols(symbol, market_code):
    if market_code == "STK":
        return [f"{symbol}.KS", f"{symbol}.KQ"]
    if market_code == "KSQ":
        return [f"{symbol}.KQ", f"{symbol}.KS"]
    return [f"{symbol}.KS", f"{symbol}.KQ"]


def yahoo_chart_url(yahoo_symbol, day_from, day_to):
    start_dt = datetime.combine(day_from, datetime.min.time(), tzinfo=timezone.utc)
    end_dt = datetime.combine(day_to + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)
    return (
        f"https://query1.finance.yahoo.com/v8/finance/chart/{yahoo_symbol}"
        f"?period1={int(start_dt.timestamp())}"
        f"&period2={int(end_dt.timestamp())}"
        "&interval=1d&includeAdjustedClose=true&events=history"
    )


def fetch_chart_payload(yahoo_symbol, day_from, day_to, retries, sleep_ms):
    url = yahoo_chart_url(yahoo_symbol, day_from, day_to)
    last_error = None
    for attempt in range(1, retries + 1):
        try:
            response = requests.get(url, headers=YAHOO_HEADERS, timeout=30)
            response.raise_for_status()
            payload = response.json()
            error = payload.get("chart", {}).get("error")
            if error:
                raise RuntimeError(error)
            result = payload.get("chart", {}).get("result") or []
            if not result:
                return None
            return result[0]
        except Exception as exc:  # pragma: no cover - remote/network variability
            last_error = exc
            time.sleep((sleep_ms / 1000.0) * attempt)
    raise RuntimeError(f"chart fetch failed for {yahoo_symbol}: {last_error}")


def normalize_chart_rows(payload, day_from_key, day_to_key):
    meta = payload.get("meta") or {}
    gmtoffset = int(meta.get("gmtoffset") or 0)
    timestamps = payload.get("timestamp") or []
    indicators = payload.get("indicators") or {}
    quote_list = indicators.get("quote") or []
    if not quote_list:
        return []
    quote = quote_list[0]
    rows = []
    for idx, timestamp in enumerate(timestamps):
        dt = datetime.fromtimestamp(int(timestamp), tz=timezone.utc) + timedelta(seconds=gmtoffset)
        date_key = dt.date().isoformat()
        if date_key < day_from_key or date_key > day_to_key:
            continue
        open_price = parse_int((quote.get("open") or [None])[idx])
        high_price = parse_int((quote.get("high") or [None])[idx])
        low_price = parse_int((quote.get("low") or [None])[idx])
        close_price = parse_int((quote.get("close") or [None])[idx])
        volume = parse_int((quote.get("volume") or [None])[idx])
        if None in (open_price, high_price, low_price, close_price, volume):
            continue
        rows.append(
            {
                "dateKey": date_key,
                "open": open_price,
                "high": high_price,
                "low": low_price,
                "close": close_price,
                "volume": volume,
            }
        )
    rows.sort(key=lambda row: row["dateKey"])
    return rows


def validate_symbol_series_rows(rows, *, symbol, source_name):
    partitioned = partition_symbol_series_rows(rows)
    invalid_rows = list(partitioned.get("fatalRows") or [])
    if not invalid_rows:
        return list(partitioned.get("validRows") or [])
    raise InvalidCandleRowsError(
        symbol=symbol,
        source_name=source_name,
        invalid_rows=invalid_rows,
    )


def fetch_symbol_series(symbol, market_code, day_from, day_to, retries, sleep_ms):
    naver_rows = fetch_naver_series(symbol, day_from, day_to, retries, sleep_ms)
    if naver_rows:
        return naver_rows, "naver"
    last_error = None
    for yahoo_symbol in candidate_yahoo_symbols(symbol, market_code):
        try:
            payload = fetch_chart_payload(yahoo_symbol, day_from, day_to, retries, sleep_ms)
            if payload is None:
                continue
            rows = normalize_chart_rows(payload, to_date_key(day_from), to_date_key(day_to))
            if rows:
                return rows, yahoo_symbol
        except Exception as exc:
            last_error = exc
            continue
    if last_error is not None:
        raise last_error
    return [], None


def universe_reject_reason(mode, market_cap, avg_trading_value_20d, filters_cfg):
    if market_cap is None or avg_trading_value_20d is None:
        if market_cap is None and avg_trading_value_20d is None:
            return "missing_market_cap_and_avg_trading_value_20d"
        if market_cap is None:
            return "missing_market_cap"
        return "missing_avg_trading_value_20d"
    if mode == "all_common":
        return None
    reasons = []
    if market_cap <= filters_cfg["min_market_cap"]:
        reasons.append("market_cap_below_min")
    if avg_trading_value_20d < filters_cfg["min_liquidity"]:
        reasons.append("liquidity_below_min")
    return "+".join(reasons) if reasons else None


def universe_passes(mode, market_cap, avg_trading_value_20d, filters_cfg):
    return universe_reject_reason(mode, market_cap, avg_trading_value_20d, filters_cfg) is None


def build_target_symbol_metadata(candle_path, before_date_key):
    latest_existing_date = find_latest_date_before(candle_path, "dateKey", before_date_key)
    existing_symbols = collect_symbols_on_date(candle_path, "dateKey", latest_existing_date) if latest_existing_date else set()
    current_meta = finder_symbol_metadata()
    out = dict(current_meta)
    for symbol in sorted(existing_symbols):
        out.setdefault(symbol, {"name": symbol, "marketCode": None})
    return out, latest_existing_date, existing_symbols


def execute_fill(args):
    root = Path.cwd()
    data_dir = root / args.data_dir
    config_path = root / args.config
    candle_path = data_dir / "candle_daily.jsonl"
    universe_path = data_dir / "universe_daily.jsonl"
    symbol_master_path = data_dir / "symbol_master.jsonl"
    nontrading_path = data_dir / NONTRADING_STATUS_BASENAME
    resolved_range = resolve_date_range(args, candle_path, universe_path)
    day_from = resolved_range["day_from"]
    day_to = resolved_range["day_to"]
    latest_candle = resolved_range["latest_candle"]
    latest_universe = resolved_range["latest_universe"]
    latest_candle_before = date_to_text(latest_candle)
    latest_universe_before = date_to_text(latest_universe)
    day_from_key = to_date_key(day_from)
    day_to_key = to_date_key(day_to)
    run_id = first_text(args.run_id)
    if day_from > day_to:
        log(
            "NOOP fill_public_kr_daily "
            f"from={day_from_key} to={day_to_key} "
            f"latest_candle={latest_candle_before or 'NONE'} "
            f"latest_universe={latest_universe_before or 'NONE'} "
            "reason=empty_range"
        )
        return (
            build_fill_summary(
                run_id=run_id,
                status=FILL_STATUS_NOOP_EMPTY_RANGE,
                day_from_key=day_from_key,
                day_to_key=day_to_key,
                latest_candle_before=latest_candle_before,
                latest_universe_before=latest_universe_before,
                latest_candle_after=latest_candle_before,
                latest_universe_after=latest_universe_before,
                latest_written_date=latest_candle_before,
                valid_candle_rows=0,
                valid_universe_rows=0,
                nontrading_symbol_count=0,
                nontrading_row_count=0,
                fatal_invalid_symbol_count=0,
                fatal_invalid_row_count=0,
                nontrading_path=str(nontrading_path),
            ),
            0,
        )
    filters_cfg = load_filters(config_path)
    if args.dry_run:
        log(
            "DRYRUN fill_public_kr_daily "
            f"from={day_from_key} to={day_to_key} "
            f"latest_candle={latest_candle_before or 'NONE'} "
            f"latest_universe={latest_universe_before or 'NONE'} "
            f"rewind_days={max(0, int(args.rewind_days or 0))} "
            f"update_anchor={args.update_anchor is True}"
        )
        return (
            build_fill_summary(
                run_id=run_id,
                status=FILL_STATUS_DRY_RUN,
                day_from_key=day_from_key,
                day_to_key=day_to_key,
                latest_candle_before=latest_candle_before,
                latest_universe_before=latest_universe_before,
                latest_candle_after=latest_candle_before,
                latest_universe_after=latest_universe_before,
                latest_written_date=latest_candle_before,
                valid_candle_rows=0,
                valid_universe_rows=0,
                nontrading_symbol_count=0,
                nontrading_row_count=0,
                fatal_invalid_symbol_count=0,
                fatal_invalid_row_count=0,
                nontrading_path=str(nontrading_path),
            ),
            0,
        )

    metadata_by_symbol, latest_existing_date, existing_symbols = build_target_symbol_metadata(candle_path, day_from_key)
    existing_share_seed = build_base_shares(universe_path, candle_path, day_from_key)
    listed_shares_map = fetch_naver_listed_shares_map(args.retries, args.sleep_ms)
    share_counts = dict(existing_share_seed)
    share_counts.update(listed_shares_map)
    trading_value_windows = seed_trading_value_windows(candle_path, day_from_key, share_counts.keys())

    log(
        "START fill_public_kr_daily "
        f"from={day_from_key} to={day_to_key} "
        f"target_symbols={len(metadata_by_symbol)} "
        f"latest_existing_date={latest_existing_date or 'NONE'} "
        f"share_symbols={len(share_counts)} "
        f"existing_share_seed={len(existing_share_seed)} "
        f"listed_share_symbols={len(listed_shares_map)}"
    )

    candle_rows_by_symbol = {}
    nontrading_status_rows = []
    nontrading_symbol_reports = []
    invalid_symbol_reports = []
    processed = 0
    success = 0
    with ThreadPoolExecutor(max_workers=max(1, args.max_workers)) as executor:
        future_map = {
            executor.submit(
                fetch_symbol_series,
                symbol,
                meta.get("marketCode"),
                day_from,
                day_to,
                args.retries,
                args.sleep_ms,
            ): symbol
            for symbol, meta in metadata_by_symbol.items()
        }
        total = len(future_map)
        for future in as_completed(future_map):
            symbol = future_map[future]
            processed += 1
            try:
                rows, source_name = future.result()
            except Exception as exc:
                log(f"WARN symbol={symbol} status=error err={type(exc).__name__}:{exc}")
                rows = []
                source_name = None
            if rows:
                partitioned = partition_symbol_series_rows(rows)
                valid_rows = list(partitioned.get("validRows") or [])
                nontrading_rows = list(partitioned.get("nonTradingRows") or [])
                fatal_rows = list(partitioned.get("fatalRows") or [])
                metadata = metadata_by_symbol.get(symbol) or {}
                if fatal_rows:
                    report = build_invalid_candle_symbol_report(
                        symbol=symbol,
                        source_name=source_name,
                        invalid_rows=fatal_rows,
                        metadata=metadata,
                    )
                    invalid_symbol_reports.append(report)
                    log(
                        "FATAL symbol={symbol} status=invalid_candle_rows source={source} invalid_rows={count} reasons={reasons}".format(
                            symbol=symbol,
                            source=source_name,
                            count=len(fatal_rows),
                            reasons=json.dumps(summarize_reason_counts(fatal_rows), ensure_ascii=False, separators=(",", ":")),
                        )
                    )
                else:
                    if valid_rows:
                        success += 1
                        candle_rows_by_symbol[symbol] = valid_rows
                        if not metadata_by_symbol[symbol].get("name"):
                            metadata_by_symbol[symbol]["name"] = symbol
                        log(
                            f"FETCH symbol={symbol} source={source_name} rows={len(valid_rows)} "
                            f"first={valid_rows[0]['dateKey']} last={valid_rows[-1]['dateKey']}"
                        )
                    if nontrading_rows:
                        report = build_invalid_candle_symbol_report(
                            symbol=symbol,
                            source_name=source_name,
                            invalid_rows=nontrading_rows,
                            metadata=metadata,
                        )
                        nontrading_symbol_reports.append(report)
                        generated_at = iso_now_utc()
                        for nontrading_row in nontrading_rows:
                            nontrading_status_rows.append(
                                build_nontrading_status_row(
                                    symbol=symbol,
                                    source_name=source_name,
                                    row=nontrading_row,
                                    metadata=metadata,
                                    generated_at=generated_at,
                                )
                            )
                        log(
                            "NONTRADING symbol={symbol} status=nontrading_status source={source} rows={count} reasons={reasons}".format(
                                symbol=symbol,
                                source=source_name,
                                count=len(nontrading_rows),
                                reasons=json.dumps(summarize_reason_counts(nontrading_rows), ensure_ascii=False, separators=(",", ":")),
                            )
                        )
            if processed % 50 == 0 or processed == total:
                log(f"PROGRESS fetched={processed}/{total} success={success}")

    audit_paths = {}
    if nontrading_symbol_reports:
        nontrading_audit_path = write_nontrading_status_audit(
            root,
            audit_dir=args.invalid_candle_audit_dir,
            day_from_key=day_from_key,
            day_to_key=day_to_key,
            reports=sorted(nontrading_symbol_reports, key=lambda row: (row.get("symbol") or "", row.get("source") or "")),
        )
        audit_paths["nonTradingStatus"] = str(nontrading_audit_path)
        log(
            "NTSUMMARY fill_public_kr_daily "
            f"nontrading_symbols={len(nontrading_symbol_reports)} "
            f"nontrading_rows={sum(int(row.get('invalidRowCount') or 0) for row in nontrading_symbol_reports)} "
            f"audit={nontrading_audit_path}"
        )

    if invalid_symbol_reports:
        audit_path = write_invalid_candle_audit(
            root,
            audit_dir=args.invalid_candle_audit_dir,
            day_from_key=day_from_key,
            day_to_key=day_to_key,
            reports=sorted(invalid_symbol_reports, key=lambda row: (row.get("symbol") or "", row.get("source") or "")),
        )
        audit_paths["fatalInvalid"] = str(audit_path)
        log(
            "ABORT fill_public_kr_daily "
            f"reason=invalid_candle_rows invalid_symbols={len(invalid_symbol_reports)} "
            f"invalid_rows={sum(int(row.get('invalidRowCount') or 0) for row in invalid_symbol_reports)} "
            f"audit={audit_path}"
        )
        return (
            build_fill_summary(
                run_id=run_id,
                status=FILL_STATUS_FAILED_FATAL_INVALID,
                day_from_key=day_from_key,
                day_to_key=day_to_key,
                latest_candle_before=latest_candle_before,
                latest_universe_before=latest_universe_before,
                latest_candle_after=latest_candle_before,
                latest_universe_after=latest_universe_before,
                latest_written_date=latest_candle_before,
                valid_candle_rows=0,
                valid_universe_rows=0,
                nontrading_symbol_count=len(nontrading_symbol_reports),
                nontrading_row_count=len(nontrading_status_rows),
                fatal_invalid_symbol_count=len(invalid_symbol_reports),
                fatal_invalid_row_count=sum(int(row.get("invalidRowCount") or 0) for row in invalid_symbol_reports),
                audit_paths=audit_paths,
                nontrading_path=str(nontrading_path),
                existing_symbol_seed_count=len(existing_symbols),
                share_symbol_count=len(share_counts),
                failure_reason=f"invalid candle rows detected from upstream public sources; see audit {audit_path}",
            ),
            1,
        )

    candle_rows = []
    per_day_candle_counts = defaultdict(int)
    for symbol in sorted(candle_rows_by_symbol):
        for row in candle_rows_by_symbol[symbol]:
            candle_rows.append(
                {
                    "symbol": symbol,
                    "dateKey": row["dateKey"],
                    "open": row["open"],
                    "high": row["high"],
                    "low": row["low"],
                    "close": row["close"],
                    "volume": row["volume"],
                }
            )
            per_day_candle_counts[row["dateKey"]] += 1

    universe_rows = []
    per_day_universe_counts = defaultdict(int)
    for symbol in sorted(share_counts):
        rows = candle_rows_by_symbol.get(symbol) or []
        if not rows:
            continue
        share_count = share_counts[symbol]
        window = trading_value_windows[symbol]
        for row in rows:
            trading_value = row["close"] * row["volume"]
            window.append(trading_value)
            avg20 = int(sum(window) / len(window)) if window else None
            market_cap = int(row["close"] * share_count)
            if not universe_passes(args.universe_mode, market_cap, avg20, filters_cfg):
                continue
            universe_rows.append(
                {
                    "symbol": symbol,
                    "tradingDateKey": row["dateKey"],
                    "avgTradingValue20d": avg20,
                    "marketCapKrw": market_cap,
                }
            )
            per_day_universe_counts[row["dateKey"]] += 1

    rewrite_jsonl_with_append(
        candle_path,
        key_name="dateKey",
        date_from_key=day_from_key,
        date_to_key=day_to_key,
        new_rows=candle_rows,
    )
    rewrite_jsonl_with_append(
        universe_path,
        key_name="tradingDateKey",
        date_from_key=day_from_key,
        date_to_key=day_to_key,
        new_rows=universe_rows,
    )
    rewrite_jsonl_with_append(
        nontrading_path,
        key_name="dateKey",
        date_from_key=day_from_key,
        date_to_key=day_to_key,
        new_rows=sorted(nontrading_status_rows, key=lambda row: (str(row.get("dateKey") or ""), str(row.get("symbol") or ""))),
    )

    if args.refresh_symbol_master:
        merge_symbol_master(symbol_master_path, metadata_by_symbol)
        log(f"SYMBOL_MASTER updated symbols={len(metadata_by_symbol)}")

    summary = []
    for date_key in sorted(set(per_day_candle_counts) | set(per_day_universe_counts)):
        summary.append(
            {
                "dateKey": date_key,
                "candleRows": int(per_day_candle_counts.get(date_key, 0)),
                "universeRows": int(per_day_universe_counts.get(date_key, 0)),
            }
        )
    log(
        "DONE fill_public_kr_daily "
        f"candle_rows={len(candle_rows)} universe_rows={len(universe_rows)} "
        f"nontrading_rows={len(nontrading_status_rows)} days={len(summary)} existing_symbol_seed={len(existing_symbols)} "
        f"share_symbols={len(share_counts)}"
    )
    log("SUMMARY " + json.dumps(summary, ensure_ascii=False, separators=(",", ":")))
    latest_written = read_latest_date(candle_path, "dateKey")
    if args.update_anchor:
        if latest_written is not None:
            prev_anchor = update_anchor_date(config_path, to_date_key(latest_written))
            log(
                "ANCHOR updated "
                f"prev={prev_anchor or 'NONE'} "
                f"next={to_date_key(latest_written)} "
                f"config={config_path}"
            )
    latest_candle_after = date_to_text(read_latest_date(candle_path, "dateKey"))
    latest_universe_after = date_to_text(read_latest_date(universe_path, "tradingDateKey"))
    return (
        build_fill_summary(
            run_id=run_id,
            status=FILL_STATUS_COMPLETED_WITH_NONTRADING_STATUS if nontrading_status_rows else FILL_STATUS_COMPLETED,
            day_from_key=day_from_key,
            day_to_key=day_to_key,
            latest_candle_before=latest_candle_before,
            latest_universe_before=latest_universe_before,
            latest_candle_after=latest_candle_after,
            latest_universe_after=latest_universe_after,
            latest_written_date=date_to_text(latest_written),
            valid_candle_rows=len(candle_rows),
            valid_universe_rows=len(universe_rows),
            nontrading_symbol_count=len(nontrading_symbol_reports),
            nontrading_row_count=len(nontrading_status_rows),
            fatal_invalid_symbol_count=0,
            fatal_invalid_row_count=0,
            audit_paths=audit_paths,
            nontrading_path=str(nontrading_path),
            existing_symbol_seed_count=len(existing_symbols),
            share_symbol_count=len(share_counts),
        ),
        0,
    )


def main():
    args = parse_args()
    summary = None
    exit_code = 0
    try:
        summary, exit_code = execute_fill(args)
    except BaseException as exc:
        summary = build_fill_summary(
            run_id=first_text(getattr(args, "run_id", "")),
            status=FILL_STATUS_FAILED_RUNTIME_ERROR,
            day_from_key=first_text(getattr(args, "date_from", "")),
            day_to_key=first_text(getattr(args, "date_to", "")),
            latest_candle_before=None,
            latest_universe_before=None,
            latest_candle_after=None,
            latest_universe_after=None,
            latest_written_date=None,
            valid_candle_rows=0,
            valid_universe_rows=0,
            nontrading_symbol_count=0,
            nontrading_row_count=0,
            fatal_invalid_symbol_count=0,
            fatal_invalid_row_count=0,
            nontrading_path=str(Path.cwd() / getattr(args, "data_dir", "data") / NONTRADING_STATUS_BASENAME),
            failure_reason=f"{type(exc).__name__}:{exc}",
        )
        write_fill_summary(getattr(args, "summary_out", ""), summary)
        raise
    write_fill_summary(args.summary_out, summary)
    if exit_code != 0:
        raise SystemExit(exit_code)
    return summary


if __name__ == "__main__":
    main()
