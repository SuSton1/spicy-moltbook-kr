#!/usr/bin/env python3

import os
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from public_kr_historical_inputs_common import call_with_retries, iso_now_utc, write_json


KIWOOM_DEFAULT_BASE_URL = "https://api.kiwoom.com"
KIWOOM_MOCK_BASE_URL = "https://mockapi.kiwoom.com"
KIWOOM_TOKEN_PATH = "/oauth2/token"
KIWOOM_CHART_PATH = "/api/dostk/chart"
KIWOOM_MARKET_CONDITION_PATH = "/api/dostk/mrkcond"
KIWOOM_SHORTING_PATH = "/api/dostk/shsa"
KIWOOM_LENDING_PATH = "/api/dostk/slb"
KIWOOM_STOCK_INFO_PATH = "/api/dostk/stkinfo"
KIWOOM_SECTOR_PATH = "/api/dostk/sect"
KIWOOM_DEFAULT_HEADERS = {
    "Accept": "application/json",
    "Content-Type": "application/json;charset=UTF-8",
    "User-Agent": "stockdesk-lab-lite/kiwoom-rest-client",
}
KIWOOM_API_ID_MINUTE_CHART = "ka10080"
KIWOOM_API_ID_INVESTOR_DAILY = "ka10060"
KIWOOM_API_ID_PROGRAM_DAILY = "ka90013"
KIWOOM_API_ID_TRADE_STRENGTH_DAILY = "ka10047"
KST = timezone(timedelta(hours=9))
KIWOOM_API_PATH_BY_ID = {
    "ka10080": KIWOOM_CHART_PATH,
    "ka10060": KIWOOM_CHART_PATH,
    "ka10064": KIWOOM_CHART_PATH,
    "ka90013": KIWOOM_MARKET_CONDITION_PATH,
    "ka10047": KIWOOM_MARKET_CONDITION_PATH,
    "ka10014": KIWOOM_SHORTING_PATH,
    "ka10068": KIWOOM_LENDING_PATH,
    "ka20068": KIWOOM_LENDING_PATH,
    "ka10013": KIWOOM_STOCK_INFO_PATH,
    "ka20009": KIWOOM_SECTOR_PATH,
    "ka10051": KIWOOM_SECTOR_PATH,
    "ka10010": KIWOOM_SECTOR_PATH,
}


_REQUEST_GATE_LOCK = threading.Lock()
_NEXT_REQUEST_TS = 0.0


class KiwoomContractError(RuntimeError):
    pass


class KiwoomRateLimitError(KiwoomContractError):
    pass


def load_requests_module():
    try:
        import requests
    except ModuleNotFoundError as exc:
        missing = exc.name or "dependency"
        raise SystemExit(
            f"missing python dependency: {missing}. "
            "Install requests on the server first, for example: .venv-datafill/bin/pip install requests"
        ) from exc
    return requests


def normalize_secret(raw):
    text = str(raw or "").strip()
    if not text:
        return None
    if text.lower() in {"appkey", "secretkey"}:
        return None
    return text


def normalize_date_key(raw):
    text = str(raw or "").strip()
    if not text:
        return None
    for fmt in ("%Y%m%d", "%Y-%m-%d", "%Y/%m/%d"):
        try:
            return datetime.strptime(text, fmt).strftime("%Y%m%d")
        except ValueError:
            continue
    raise ValueError(f"invalid date key: {raw}")


def parse_expiry(raw):
    text = str(raw or "").strip()
    if not text:
        return None
    for fmt in ("%Y%m%d%H%M%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(text, fmt).replace(tzinfo=KST)
        except ValueError:
            continue
    return None


def header_value(headers, name):
    expected = str(name or "").strip().lower()
    for key, value in dict(headers or {}).items():
        if str(key or "").strip().lower() == expected:
            return str(value or "").strip()
    return ""


def redact_headers(headers):
    out = {}
    for key, value in dict(headers or {}).items():
        normalized = str(key or "").strip().lower()
        if normalized == "authorization":
            text = str(value or "").strip()
            if not text:
                out[key] = ""
            elif len(text) <= 12:
                out[key] = "***"
            else:
                out[key] = f"{text[:10]}***"
            continue
        out[key] = value
    return out


def redact_body(body):
    out = {}
    for key, value in dict(body or {}).items():
        normalized = str(key or "").strip().lower()
        if normalized in {"appkey", "secretkey"}:
            text = str(value or "").strip()
            if not text:
                out[key] = ""
            elif len(text) <= 6:
                out[key] = "***"
            else:
                out[key] = f"{text[:3]}***{text[-3:]}"
            continue
        out[key] = value
    return out


def build_trace_payload(*, step, method, url, headers, body, response):
    text = str(getattr(response, "text", "") or "")
    payload = {
        "generatedAt": iso_now_utc(),
        "step": step,
        "method": method,
        "url": url,
        "headers": redact_headers(headers),
        "body": redact_body(body),
        "statusCode": int(getattr(response, "status_code", 0) or 0),
        "responseHeaders": dict(getattr(response, "headers", {}) or {}),
        "bodyPreview": text[:4000],
    }
    try:
        payload["jsonPreview"] = response.json()
    except Exception:
        payload["jsonPreview"] = None
    return payload


def resolve_api_path(api_id, explicit_path=""):
    if str(explicit_path or "").strip():
        return str(explicit_path).strip()
    api_key = str(api_id or "").strip()
    path = KIWOOM_API_PATH_BY_ID.get(api_key)
    if not path:
        raise KiwoomContractError(f"unsupported Kiwoom REST api-id path mapping: {api_key}")
    return path


class KiwoomRestClient:
    def __init__(
        self,
        *,
        retries=3,
        sleep_ms=400,
        trace_dir="",
        base_url=KIWOOM_DEFAULT_BASE_URL,
        app_key="",
        secret_key="",
        min_interval_ms=1200,
        cooldown_429_ms=30000,
    ):
        requests = load_requests_module()
        self._requests = requests
        self._session = requests.Session()
        self._retries = int(retries or 3)
        self._sleep_ms = int(sleep_ms or 400)
        self._trace_dir = Path(trace_dir) if str(trace_dir or "").strip() else None
        self._base_url = str(base_url or KIWOOM_DEFAULT_BASE_URL).rstrip("/")
        self._app_key = normalize_secret(app_key) or normalize_secret(os.environ.get("KIWOOM_APP_KEY"))
        self._secret_key = normalize_secret(secret_key) or normalize_secret(os.environ.get("KIWOOM_SECRET_KEY"))
        self._min_interval_ms = max(0, int(min_interval_ms or 0))
        self._cooldown_429_ms = max(0, int(cooldown_429_ms or 0))
        self._token = None
        self._token_type = "Bearer"
        self._token_expires_at = None
        self._rate_limit_hit_count = 0

    def _write_trace(self, step, method, url, headers, body, response):
        if self._trace_dir is None:
            return
        self._trace_dir.mkdir(parents=True, exist_ok=True)
        payload = build_trace_payload(
            step=step,
            method=method,
            url=url,
            headers=headers,
            body=body,
            response=response,
        )
        write_json(self._trace_dir / f"{step}.json", payload)

    def _throttle_request(self):
        if self._min_interval_ms <= 0:
            return
        global _NEXT_REQUEST_TS
        while True:
            with _REQUEST_GATE_LOCK:
                now = time.monotonic()
                if now >= _NEXT_REQUEST_TS:
                    _NEXT_REQUEST_TS = now + (self._min_interval_ms / 1000.0)
                    return
                wait_sec = _NEXT_REQUEST_TS - now
            if wait_sec > 0:
                time.sleep(wait_sec)

    def _cooldown_after_429(self):
        if self._cooldown_429_ms <= 0:
            return
        time.sleep(self._cooldown_429_ms / 1000.0)

    def _require_credentials(self):
        if self._app_key and self._secret_key:
            return self._app_key, self._secret_key
        raise KiwoomContractError(
            "missing KIWOOM_APP_KEY/KIWOOM_SECRET_KEY for Kiwoom REST contract. "
            "Export KIWOOM_APP_KEY and KIWOOM_SECRET_KEY in the server environment first."
        )

    def _token_is_valid(self):
        if not self._token:
            return False
        if self._token_expires_at is None:
            return True
        return datetime.now(KST) < (self._token_expires_at - timedelta(minutes=5))

    def _decode_json_response(self, *, step, response):
        status_code = int(getattr(response, "status_code", 0) or 0)
        text = str(getattr(response, "text", "") or "").strip()
        if status_code == 429:
            self._rate_limit_hit_count += 1
            self._cooldown_after_429()
            raise KiwoomRateLimitError(f"{step} returned http_status=429 body={text[:200]}")
        if status_code == 401:
            self._token = None
            self._token_expires_at = None
            raise KiwoomContractError(f"{step} returned http_status=401 body={text[:200]}")
        if status_code >= 400:
            raise KiwoomContractError(f"{step} returned http_status={status_code} body={text[:200]}")
        try:
            return response.json()
        except Exception as exc:
            raise KiwoomContractError(f"{step} returned invalid json body={text[:200]}") from exc

    def issue_token(self, *, force_refresh=False, trace_step="token_issue"):
        if self._token and not force_refresh and self._token_is_valid():
            return {
                "status": "cached",
                "tokenType": self._token_type,
                "expiresAt": self._token_expires_at.isoformat() if self._token_expires_at else None,
            }
        app_key, secret_key = self._require_credentials()
        url = f"{self._base_url}{KIWOOM_TOKEN_PATH}"
        body = {
            "grant_type": "client_credentials",
            "appkey": app_key,
            "secretkey": secret_key,
        }
        headers = dict(KIWOOM_DEFAULT_HEADERS)

        def _request():
            self._throttle_request()
            response = self._session.post(url, headers=headers, json=body, timeout=30)
            self._write_trace(trace_step, "POST", url, headers, body, response)
            return self._decode_json_response(step=trace_step, response=response)

        payload = call_with_retries(
            _request,
            retries=self._retries,
            sleep_ms=self._sleep_ms,
            label="kiwoom oauth token issuance",
        )
        token = str(payload.get("token") or "").strip()
        if not token:
            raise KiwoomContractError("token_issue returned empty token")
        self._token = token
        self._token_type = str(payload.get("token_type") or "Bearer").strip() or "Bearer"
        self._token_expires_at = parse_expiry(payload.get("expires_dt"))
        return {
            "status": "issued",
            "tokenType": self._token_type,
            "expiresAt": self._token_expires_at.isoformat() if self._token_expires_at else None,
        }

    def call_json(self, *, path="", api_id, body, cont_yn=None, next_key=None, trace_step="chart_call"):
        url = f"{self._base_url}{resolve_api_path(api_id, explicit_path=path)}"

        def _request():
            self.issue_token()
            headers = dict(KIWOOM_DEFAULT_HEADERS)
            headers["authorization"] = f"{self._token_type} {self._token}"
            headers["api-id"] = str(api_id or "").strip()
            if str(cont_yn or "").strip():
                headers["cont-yn"] = str(cont_yn).strip()
            if str(next_key or "").strip():
                headers["next-key"] = str(next_key).strip()
            self._throttle_request()
            response = self._session.post(url, headers=headers, json=dict(body or {}), timeout=30)
            self._write_trace(trace_step, "POST", url, headers, body, response)
            payload = self._decode_json_response(step=trace_step, response=response)
            return {
                "payload": payload,
                "contYn": header_value(response.headers, "cont-yn"),
                "nextKey": header_value(response.headers, "next-key"),
                "apiId": header_value(response.headers, "api-id") or str(api_id or "").strip(),
            }

        return call_with_retries(
            _request,
            retries=self._retries,
            sleep_ms=self._sleep_ms,
            label=f"kiwoom api call {api_id}",
        )

    def fetch_chart_rows(self, *, api_id, body, list_key, path="", cont_yn=None, next_key=None, trace_step="chart_call"):
        result = self.call_json(
            path=path,
            api_id=api_id,
            body=body,
            cont_yn=cont_yn,
            next_key=next_key,
            trace_step=trace_step,
        )
        payload = result["payload"]
        rows = payload.get(list_key)
        if rows is None:
            raise KiwoomContractError(f"{api_id} payload missing list_key={list_key}")
        if not isinstance(rows, list):
            raise KiwoomContractError(f"{api_id} payload list_key={list_key} is not a list")
        result["rows"] = [dict(row or {}) for row in rows]
        result["requestBody"] = dict(body or {})
        return result

    def fetch_minute_chart(
        self,
        *,
        symbol,
        tick_scope="1",
        adjusted_price="1",
        base_date="",
        cont_yn=None,
        next_key=None,
        trace_step="ka10080",
    ):
        body = {
            "stk_cd": str(symbol or "").strip(),
            "tic_scope": str(tick_scope or "").strip() or "1",
            "upd_stkpc_tp": str(adjusted_price or "").strip() or "1",
        }
        normalized_base = normalize_date_key(base_date)
        if normalized_base:
            body["base_dt"] = normalized_base
        return self.fetch_chart_rows(
            api_id=KIWOOM_API_ID_MINUTE_CHART,
            body=body,
            list_key="stk_min_pole_chart_qry",
            cont_yn=cont_yn,
            next_key=next_key,
            trace_step=trace_step,
        )

    def fetch_investor_daily(
        self,
        *,
        symbol,
        date_key,
        amount_qty_type="1",
        trade_type="0",
        unit_type="1",
        cont_yn=None,
        next_key=None,
        trace_step="ka10060",
    ):
        body = {
            "dt": normalize_date_key(date_key),
            "stk_cd": str(symbol or "").strip(),
            "amt_qty_tp": str(amount_qty_type or "").strip() or "1",
            "trde_tp": str(trade_type or "").strip() or "0",
            "unit_tp": str(unit_type or "").strip() or "1",
        }
        return self.fetch_chart_rows(
            api_id=KIWOOM_API_ID_INVESTOR_DAILY,
            body=body,
            list_key="stk_invsr_orgn_chart",
            cont_yn=cont_yn,
            next_key=next_key,
            trace_step=trace_step,
        )

    def fetch_program_daily(
        self,
        *,
        symbol,
        date_key="",
        amount_qty_type="1",
        cont_yn=None,
        next_key=None,
        trace_step="ka90013",
    ):
        body = {
            "stk_cd": str(symbol or "").strip(),
            "amt_qty_tp": str(amount_qty_type or "").strip() or "1",
        }
        normalized_date = normalize_date_key(date_key)
        if normalized_date:
            body["date"] = normalized_date
        return self.fetch_chart_rows(
            api_id=KIWOOM_API_ID_PROGRAM_DAILY,
            body=body,
            list_key="stk_daly_prm_trde_trnsn",
            cont_yn=cont_yn,
            next_key=next_key,
            trace_step=trace_step,
        )

    def fetch_trade_strength_daily(
        self,
        *,
        symbol,
        cont_yn=None,
        next_key=None,
        trace_step="ka10047",
    ):
        body = {
            "stk_cd": str(symbol or "").strip(),
        }
        return self.fetch_chart_rows(
            api_id=KIWOOM_API_ID_TRADE_STRENGTH_DAILY,
            body=body,
            list_key="cntr_str_daly",
            cont_yn=cont_yn,
            next_key=next_key,
            trace_step=trace_step,
        )

    def get_rate_limit_hit_count(self, *, reset=False):
        count = int(self._rate_limit_hit_count or 0)
        if reset:
            self._rate_limit_hit_count = 0
        return count
