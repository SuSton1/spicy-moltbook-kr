#!/usr/bin/env python3

import csv
import json
import shutil
import time
from datetime import datetime
from html.parser import HTMLParser
from io import StringIO
from pathlib import Path
from tempfile import NamedTemporaryFile

import requests

from fill_public_kr_daily import candidate_yahoo_symbols
from fill_public_kr_daily import iso_now_utc, log, parse_day, to_date_key


LIFECYCLE_SUMMARY_KIND = "public_kr_historical_lifecycle_summary_v1"
SHARES_SUMMARY_KIND = "public_kr_historical_shares_summary_v1"
KIND_CORP_LIST_URL = "http://kind.krx.co.kr/corpgeneral/corpList.do?method=download&searchType=13"
FDR_DELISTING_CONTENTS_API_URL = (
    "https://api.github.com/repos/FinanceData/fdr_krx_data_cache/contents/data/listing/delisting"
)
DEFAULT_HTTP_TIMEOUT_SEC = 30


class KindTableParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self._in_table = False
        self._in_cell = False
        self._row = []
        self._rows = []
        self._text_parts = []

    def handle_starttag(self, tag, attrs):
        normalized = str(tag or "").strip().lower()
        if normalized == "table" and not self._in_table:
            self._in_table = True
            return
        if not self._in_table:
            return
        if normalized == "tr":
            self._row = []
            return
        if normalized in {"td", "th"}:
            self._in_cell = True
            self._text_parts = []

    def handle_endtag(self, tag):
        normalized = str(tag or "").strip().lower()
        if not self._in_table:
            return
        if normalized in {"td", "th"} and self._in_cell:
            self._row.append("".join(self._text_parts).strip())
            self._text_parts = []
            self._in_cell = False
            return
        if normalized == "tr":
            if self._row:
                self._rows.append(list(self._row))
            self._row = []
            return
        if normalized == "table":
            self._in_table = False

    def handle_data(self, data):
        if self._in_cell:
            self._text_parts.append(data)

    def rows(self):
        return list(self._rows)


def write_json(path, payload):
    output_path = Path(path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile("w", encoding="utf-8", delete=False, dir=str(output_path.parent)) as tmp:
        json.dump(payload, tmp, ensure_ascii=False, indent=2)
        tmp.write("\n")
        temp_path = Path(tmp.name)
    shutil.move(str(temp_path), str(output_path))
    return output_path


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


def iter_jsonl(path):
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            text = line.strip()
            if not text:
                continue
            yield json.loads(text)


def sort_rows(rows, key_names):
    safe_keys = tuple(key_names or [])
    return sorted(
        rows or [],
        key=lambda row: tuple(str(row.get(key) or "") for key in safe_keys),
    )


def build_summary(kind, *, args, row_count, symbol_count, audit_paths=None, failure_reason=None, extra=None):
    payload = {
        "kind": kind,
        "generatedAt": iso_now_utc(),
        "from": str(args.date_from or "").strip(),
        "to": str(args.date_to or "").strip(),
        "outputPath": str(Path(args.output).resolve()),
        "rowCount": int(row_count or 0),
        "symbolCount": int(symbol_count or 0),
        "auditPaths": dict(audit_paths or {}),
        "failureReason": str(failure_reason or "").strip() or None,
    }
    if extra:
        payload.update(extra)
    return payload


def write_summary(args, payload):
    if str(args.summary_out or "").strip():
        write_json(args.summary_out, payload)


def call_with_retries(fn, *, retries, sleep_ms, label):
    last_error = None
    for attempt in range(1, max(1, int(retries or 1)) + 1):
        try:
            return fn()
        except Exception as exc:  # pragma: no cover - remote/network variability
            last_error = exc
            if attempt >= max(1, int(retries or 1)):
                break
            time.sleep((int(sleep_ms or 0) / 1000.0) * attempt)
    raise RuntimeError(f"{label} failed after retries: {last_error}")


def normalize_market_code(raw):
    text = str(raw or "").strip().upper()
    if text in {"KOSPI", "STK"}:
        return "STK"
    if text in {"KOSDAQ", "KSQ"}:
        return "KSQ"
    if text in {"ALL", "MIXED"}:
        return "ALL"
    raise ValueError(f"unsupported market code: {raw}")


def load_yfinance_module():
    try:
        import yfinance
    except ModuleNotFoundError as exc:
        missing = exc.name or "dependency"
        raise SystemExit(
            f"missing python dependency: {missing}. "
            "Install yfinance on the server first, for example: .venv-datafill/bin/pip install yfinance"
        ) from exc
    return yfinance


def parse_date_text(raw):
    text = str(raw or "").strip()
    if not text:
        return None
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d", "%Y%m%d"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"invalid date text: {raw}")


def download_response(url, *, retries, sleep_ms, label, headers=None):
    def _request():
        response = requests.get(url, headers=headers, timeout=DEFAULT_HTTP_TIMEOUT_SEC)
        response.raise_for_status()
        return response

    return call_with_retries(_request, retries=retries, sleep_ms=sleep_ms, label=label)


def load_kind_current_list_rows(*, retries, sleep_ms):
    response = download_response(
        KIND_CORP_LIST_URL,
        retries=retries,
        sleep_ms=sleep_ms,
        label="download kind current listed table",
    )
    response.encoding = response.encoding or "euc-kr"
    parser = KindTableParser()
    parser.feed(response.text)
    rows = parser.rows()
    if len(rows) < 2:
        raise RuntimeError("kind current listed table returned no data rows")
    header = rows[0]
    data_rows = []
    for values in rows[1:]:
        if len(values) != len(header):
            continue
        data_rows.append({header[idx]: values[idx] for idx in range(len(header))})
    if not data_rows:
        raise RuntimeError("kind current listed table returned zero parsed rows")
    return data_rows


def resolve_latest_fdr_delisting_csv(*, retries, sleep_ms):
    response = download_response(
        FDR_DELISTING_CONTENTS_API_URL,
        retries=retries,
        sleep_ms=sleep_ms,
        label="download fdr delisting contents api",
        headers={"Accept": "application/vnd.github+json"},
    )
    payload = response.json()
    items = [item for item in payload if str(item.get("name") or "").endswith(".csv")]
    if not items:
        raise RuntimeError("fdr delisting contents api returned no csv entries")
    latest = sorted(items, key=lambda item: str(item.get("name") or ""))[-1]
    url = str(latest.get("download_url") or "").strip()
    if not url:
        raise RuntimeError("latest fdr delisting entry missing download_url")
    return {"name": str(latest.get("name") or "").strip(), "downloadUrl": url}


def load_fdr_delisting_rows(*, retries, sleep_ms):
    latest = resolve_latest_fdr_delisting_csv(retries=retries, sleep_ms=sleep_ms)
    response = download_response(
        latest["downloadUrl"],
        retries=retries,
        sleep_ms=sleep_ms,
        label=f"download fdr delisting csv {latest['name']}",
    )
    reader = csv.DictReader(StringIO(response.text.lstrip("\ufeff")))
    rows = [dict(row) for row in reader if row]
    if not rows:
        raise RuntimeError(f"fdr delisting csv returned zero rows: {latest['name']}")
    return rows, latest


def load_krx_finder_maps(*, retries, sleep_ms):
    from public_kr_krx_curl_client import KRX_AUTH_MODE_ANONYMOUS, KrxCurlClient

    client = KrxCurlClient(
        retries=retries,
        sleep_ms=sleep_ms,
        auth_mode=KRX_AUTH_MODE_ANONYMOUS,
        trace_dir="",
    )
    listed_rows = client.fetch_listed_finder(search_text="")
    delisted_rows = client.fetch_delisted_finder(search_text="")
    listed_map = {}
    delisted_map = {}
    for row in listed_rows:
        symbol = normalize_kind_symbol(row.get("short_code"))
        full_code = str(row.get("full_code") or "").strip() or None
        if symbol and full_code:
            listed_map[symbol] = {
                "symbol": symbol,
                "fullCode": full_code,
                "name": str(row.get("codeName") or "").strip() or None,
                "marketCode": str(row.get("marketCode") or "").strip() or None,
            }
    for row in delisted_rows:
        symbol = normalize_kind_symbol(row.get("short_code"))
        full_code = str(row.get("full_code") or "").strip() or None
        if symbol and full_code:
            delisted_map[symbol] = {
                "symbol": symbol,
                "fullCode": full_code,
                "name": str(row.get("codeName") or "").strip() or None,
                "marketCode": str(row.get("marketCode") or "").strip() or None,
            }
    if not listed_map:
        raise RuntimeError("krx finder listed map returned zero symbols")
    if not delisted_map:
        raise RuntimeError("krx finder delisted map returned zero symbols")
    return {
        "listed": listed_map,
        "delisted": delisted_map,
    }


def normalize_kind_market_code(raw):
    text = str(raw or "").strip().upper()
    if text in {"KOSPI", "코스피", "유가증권시장", "유가", "유가증권"}:
        return "STK"
    if text in {"KOSDAQ", "코스닥"}:
        return "KSQ"
    return None


def normalize_kind_symbol(raw):
    text = str(raw or "").strip().upper()
    if text.isdigit() and len(text) == 6:
        return text
    return None


def normalize_yahoo_share_points(series, *, date_from, date_to):
    points_by_date = {}
    latest_pre_range = None
    if series is None:
        return []
    iterator = series.items() if hasattr(series, "items") else []
    for raw_index, raw_value in iterator:
        shares = int(raw_value) if raw_value is not None else None
        if shares is None or shares <= 0:
            continue
        if hasattr(raw_index, "to_pydatetime"):
            day = raw_index.to_pydatetime().date()
        elif hasattr(raw_index, "date"):
            day = raw_index.date()
        else:
            day = parse_date_text(str(raw_index).split(" ")[0])
        if day is None:
            continue
        if day < date_from:
            latest_pre_range = {"dateKey": to_date_key(day), "sharesOutstanding": int(shares)}
            continue
        if day > date_to:
            continue
        points_by_date[to_date_key(day)] = int(shares)
    if latest_pre_range is not None:
        points_by_date.setdefault(latest_pre_range["dateKey"], latest_pre_range["sharesOutstanding"])
    return [
        {"dateKey": date_key, "sharesOutstanding": points_by_date[date_key]}
        for date_key in sorted(points_by_date)
    ]


def fetch_yahoo_shares_full(symbol, market_code, *, date_from, date_to, retries, sleep_ms):
    yfinance = load_yfinance_module()
    last_error = None
    for yahoo_symbol in candidate_yahoo_symbols(symbol, market_code):
        try:
            ticker = yfinance.Ticker(yahoo_symbol)
            series = call_with_retries(
                lambda: ticker.get_shares_full(),
                retries=retries,
                sleep_ms=sleep_ms,
                label=f"yahoo get_shares_full symbol={yahoo_symbol}",
            )
            points = normalize_yahoo_share_points(series, date_from=date_from, date_to=date_to)
            if points:
                return points, yahoo_symbol
        except Exception as exc:  # pragma: no cover - remote/network variability
            last_error = exc
    if last_error is not None:
        raise RuntimeError(f"yahoo get_shares_full failed symbol={symbol}: {last_error}")
    return [], None


def log_progress(prefix, *, processed, total, extra=""):
    tail = f" {extra.strip()}" if str(extra or "").strip() else ""
    log(f"PROGRESS {prefix} processed={processed}/{total}{tail}")
