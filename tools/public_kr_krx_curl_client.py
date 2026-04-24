#!/usr/bin/env python3
import os
import threading
import time
from datetime import date, datetime, timedelta
from pathlib import Path

from public_kr_historical_inputs_common import call_with_retries, iso_now_utc, write_json


KRX_ORIGIN = "https://data.krx.co.kr"
KRX_ROOT_URL = f"{KRX_ORIGIN}/"
KRX_JSON_ENDPOINT = f"{KRX_ORIGIN}/comm/bldAttendant/getJsonData.cmd"
KRX_OUTER_LOADER_URL = "https://data.krx.co.kr/contents/MDC/MDI/outerLoader/index.cmd"
KRX_LOGIN_PAGE_URL = "https://data.krx.co.kr/contents/MDC/COMS/client/MDCCOMS001.cmd"
KRX_LOGIN_JSP_URL = "https://data.krx.co.kr/contents/MDC/COMS/client/view/login.jsp?site=mdc"
KRX_LOGIN_POST_URL = "https://data.krx.co.kr/contents/MDC/COMS/client/MDCCOMS001D1.cmd"
KRX_AUTH_MODE_AUTO = "auto"
KRX_AUTH_MODE_ANONYMOUS = "anonymous"
KRX_AUTH_MODE_LOGIN_REQUIRED = "login-required"
KRX_DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
}


_REQUEST_GATE_LOCK = threading.Lock()
_NEXT_REQUEST_TS = 0.0


class KrxContractError(RuntimeError):
    pass


def load_curl_cffi_requests():
    try:
        from curl_cffi import requests
    except ModuleNotFoundError as exc:
        missing = exc.name or "dependency"
        raise SystemExit(
            f"missing python dependency: {missing}. "
            "Install curl_cffi on the server first, for example: .venv-datafill/bin/pip install curl_cffi"
        ) from exc
    return requests


def build_trace_payload(*, step, method, url, params, response):
    text = str(getattr(response, "text", "") or "")
    payload = {
        "generatedAt": iso_now_utc(),
        "step": step,
        "method": method,
        "url": url,
        "params": dict(params or {}),
        "statusCode": int(getattr(response, "status_code", 0) or 0),
        "headers": dict(getattr(response, "headers", {}) or {}),
        "bodyPreview": text[:4000],
    }
    try:
        payload["jsonPreview"] = response.json()
    except Exception:
        payload["jsonPreview"] = None
    return payload


def normalize_secret(raw):
    text = str(raw or "").strip()
    if not text or text in {"id", "pw"}:
        return None
    return text


def parse_contract_day(raw):
    if isinstance(raw, date):
        return raw
    text = str(raw or "").strip()
    for fmt in ("%Y-%m-%d", "%Y%m%d", "%Y/%m/%d"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"invalid contract date: {raw}")


def add_years_safe(day, years):
    target_year = int(day.year) + int(years)
    target_month = int(day.month)
    target_day = int(day.day)
    while target_day >= 1:
        try:
            return date(target_year, target_month, target_day)
        except ValueError:
            target_day -= 1
    raise ValueError(f"unable to shift day by years: {day} years={years}")


def iter_two_year_windows(day_from, day_to):
    start = parse_contract_day(day_from)
    end = parse_contract_day(day_to)
    if start > end:
        raise ValueError(f"invalid contract range: from={day_from} to={day_to}")
    cursor = start
    while cursor <= end:
        window_end = min(end, add_years_safe(cursor, 2) - timedelta(days=1))
        yield cursor, window_end
        cursor = window_end + timedelta(days=1)


class KrxCurlClient:
    def __init__(
        self,
        *,
        retries=4,
        sleep_ms=250,
        trace_dir="",
        auth_mode=KRX_AUTH_MODE_AUTO,
        login_id="",
        login_pw="",
        min_interval_ms=1000,
        cooldown_403_ms=60000,
    ):
        requests = load_curl_cffi_requests()
        self._requests = requests
        self._session = requests.Session(impersonate="chrome")
        self._retries = int(retries or 4)
        self._sleep_ms = int(sleep_ms or 250)
        self._trace_dir = Path(trace_dir) if str(trace_dir or "").strip() else None
        self._auth_mode = str(auth_mode or KRX_AUTH_MODE_AUTO).strip() or KRX_AUTH_MODE_AUTO
        if self._auth_mode not in {KRX_AUTH_MODE_AUTO, KRX_AUTH_MODE_ANONYMOUS, KRX_AUTH_MODE_LOGIN_REQUIRED}:
            raise ValueError(f"unsupported auth_mode: {auth_mode}")
        self._login_id = normalize_secret(login_id) or normalize_secret(os.environ.get("KRX_ID"))
        self._login_pw = normalize_secret(login_pw) or normalize_secret(os.environ.get("KRX_PW"))
        self._min_interval_ms = max(0, int(min_interval_ms or 0))
        self._cooldown_403_ms = max(0, int(cooldown_403_ms or 0))
        self._session_warmed = False
        self._logged_in = False

    def _write_trace(self, step, method, url, params, response):
        if self._trace_dir is None:
            return
        self._trace_dir.mkdir(parents=True, exist_ok=True)
        payload = build_trace_payload(step=step, method=method, url=url, params=params, response=response)
        write_json(self._trace_dir / f"{step}.json", payload)

    def _decode_json_response(self, *, step, response, required_key=None):
        text = str(getattr(response, "text", "") or "").strip()
        if int(getattr(response, "status_code", 0) or 0) >= 400:
            raise KrxContractError(f"{step} returned http_status={response.status_code} body={text[:200]}")
        if text == "LOGOUT":
            raise KrxContractError(f"{step} returned LOGOUT")
        try:
            payload = response.json()
        except Exception as exc:
            raise KrxContractError(f"{step} returned invalid json body={text[:200]}") from exc
        if required_key and required_key not in payload:
            raise KrxContractError(f"{step} json missing required key={required_key}")
        return payload

    def _resolve_login_requirement(self, require_login):
        if require_login:
            return True
        return self._auth_mode == KRX_AUTH_MODE_LOGIN_REQUIRED

    def _require_credentials(self):
        if self._login_id and self._login_pw:
            return self._login_id, self._login_pw
        raise KrxContractError(
            "missing KRX_ID/KRX_PW for authenticated KRX contract. "
            "Export KRX_ID and KRX_PW in the server environment first."
        )

    def _build_request_headers(self, *, referer):
        headers = dict(KRX_DEFAULT_HEADERS)
        headers["Referer"] = str(referer or KRX_ROOT_URL)
        return headers

    def _reset_session(self):
        try:
            self._session.cookies.clear()
        except Exception:
            pass
        self._session_warmed = False
        self._logged_in = False

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

    def _cooldown_after_403(self):
        if self._cooldown_403_ms <= 0:
            return
        time.sleep(self._cooldown_403_ms / 1000.0)

    def ensure_session(self, *, require_login):
        if not self._session_warmed:
            self.warm_root_session()
        if not self._resolve_login_requirement(require_login):
            return
        self.login()

    def warm_root_session(self):
        if self._session_warmed:
            return {"status": "already_warmed"}

        def _request():
            self._throttle_request()
            response = self._session.get(
                KRX_ROOT_URL,
                headers={
                    "Accept": "text/html,application/xhtml+xml",
                    "User-Agent": KRX_DEFAULT_HEADERS["User-Agent"],
                },
                timeout=30,
            )
            self._write_trace("root_session", "GET", KRX_ROOT_URL, {}, response)
            if int(getattr(response, "status_code", 0) or 0) >= 400:
                if int(getattr(response, "status_code", 0) or 0) == 403:
                    self._cooldown_after_403()
                raise KrxContractError(f"root_session returned http_status={response.status_code}")
            cookie_count = len(getattr(self._session, "cookies", []) or [])
            if cookie_count <= 0:
                raise KrxContractError("root_session returned zero cookies")
            return {
                "status": "ok",
                "cookieCount": cookie_count,
                "url": getattr(response, "url", KRX_ROOT_URL),
            }

        payload = call_with_retries(
            _request,
            retries=self._retries,
            sleep_ms=self._sleep_ms,
            label="krx root session warmup",
        )
        self._session_warmed = True
        return payload

    def login(self):
        if self._logged_in:
            return {"status": "already_logged_in"}
        login_id, login_pw = self._require_credentials()
        self.warm_root_session()

        def _request():
            self._throttle_request()
            page_response = self._session.get(
                KRX_LOGIN_PAGE_URL,
                headers=self._build_request_headers(referer=KRX_ROOT_URL),
                timeout=30,
            )
            self._write_trace("login_page", "GET", KRX_LOGIN_PAGE_URL, {}, page_response)
            if int(getattr(page_response, "status_code", 0) or 0) >= 400:
                if int(getattr(page_response, "status_code", 0) or 0) == 403:
                    self._cooldown_after_403()
                raise KrxContractError(f"login_page returned http_status={page_response.status_code}")

            self._throttle_request()
            jsp_response = self._session.get(
                KRX_LOGIN_JSP_URL,
                headers=self._build_request_headers(referer=KRX_LOGIN_PAGE_URL),
                timeout=30,
            )
            self._write_trace("login_jsp", "GET", KRX_LOGIN_JSP_URL, {}, jsp_response)
            if int(getattr(jsp_response, "status_code", 0) or 0) >= 400:
                if int(getattr(jsp_response, "status_code", 0) or 0) == 403:
                    self._cooldown_after_403()
                raise KrxContractError(f"login_jsp returned http_status={jsp_response.status_code}")

            payload = {
                "mbrNm": "",
                "telNo": "",
                "di": "",
                "certType": "",
                "mbrId": login_id,
                "pw": login_pw,
            }
            post_headers = self._build_request_headers(referer=KRX_LOGIN_PAGE_URL)
            self._throttle_request()
            response = self._session.post(
                KRX_LOGIN_POST_URL,
                headers=post_headers,
                data=payload,
                timeout=30,
            )
            self._write_trace("login_post", "POST", KRX_LOGIN_POST_URL, payload, response)
            data = self._decode_json_response(step="login_post", response=response)
            error_code = str(data.get("_error_code") or "").strip()
            if error_code == "CD011":
                payload["skipDup"] = "Y"
                self._throttle_request()
                retry_response = self._session.post(
                    KRX_LOGIN_POST_URL,
                    headers=post_headers,
                    data=payload,
                    timeout=30,
                )
                self._write_trace("login_post_skipdup", "POST", KRX_LOGIN_POST_URL, payload, retry_response)
                data = self._decode_json_response(step="login_post_skipdup", response=retry_response)
                error_code = str(data.get("_error_code") or "").strip()
            if error_code != "CD001":
                raise KrxContractError(f"login failed error_code={error_code or '<empty>'}")
            return data

        payload = call_with_retries(
            _request,
            retries=self._retries,
            sleep_ms=self._sleep_ms,
            label="krx login",
        )
        self._logged_in = True
        return payload

    def _post_json(self, *, step, bld, params, required_key, referer=KRX_ROOT_URL, require_login=False):
        def _request():
            url = f"{KRX_JSON_ENDPOINT}?bld={bld}"
            self._throttle_request()
            response = self._session.post(
                url,
                headers={
                    **self._build_request_headers(referer=referer),
                    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                    "Accept": "application/json, text/javascript, */*; q=0.01",
                    "X-Requested-With": "XMLHttpRequest",
                },
                data=params,
                timeout=30,
            )
            self._write_trace(step, "POST", url, params, response)
            try:
                return self._decode_json_response(step=step, response=response, required_key=required_key)
            except KrxContractError as exc:
                if int(getattr(response, "status_code", 0) or 0) == 403:
                    self._cooldown_after_403()
                if "LOGOUT" not in str(exc):
                    raise
                self._reset_session()
                self.warm_root_session()
                if self._resolve_login_requirement(require_login):
                    self.login()
                self._throttle_request()
                retry_response = self._session.post(
                    url,
                    headers={
                        **self._build_request_headers(referer=referer),
                        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                        "Accept": "application/json, text/javascript, */*; q=0.01",
                        "X-Requested-With": "XMLHttpRequest",
                    },
                    data=params,
                    timeout=30,
                )
                self._write_trace(f"{step}_after_root_refresh", "POST", url, params, retry_response)
                return self._decode_json_response(
                    step=f"{step}_after_root_refresh",
                    response=retry_response,
                    required_key=required_key,
                )

        return call_with_retries(
            _request,
            retries=self._retries,
            sleep_ms=self._sleep_ms,
            label=f"krx post {step}",
        )

    def fetch_listed_finder(self, *, search_text="", market="ALL"):
        self.ensure_session(require_login=False)
        payload = self._post_json(
            step="finder_listed",
            bld="dbms/comm/finder/finder_stkisu",
            params={
                "locale": "ko_KR",
                "mktsel": str(market or "ALL").strip() or "ALL",
                "searchText": str(search_text or "").strip(),
                "typeNo": "0",
            },
            required_key="block1",
            require_login=False,
        )
        rows = list(payload.get("block1") or [])
        if not rows:
            raise KrxContractError("finder_listed returned zero rows")
        return rows

    def fetch_delisted_finder(self, *, search_text="", market="ALL"):
        self.ensure_session(require_login=False)
        payload = self._post_json(
            step="finder_delisted",
            bld="dbms/comm/finder/finder_listdelisu",
            params={
                "mktsel": str(market or "ALL").strip() or "ALL",
                "searchText": str(search_text or "").strip(),
                "typeNo": "0",
            },
            required_key="block1",
            require_login=False,
        )
        rows = list(payload.get("block1") or [])
        if not rows:
            raise KrxContractError("finder_delisted returned zero rows")
        return rows

    def fetch_active_price(self, *, full_code, date_from, date_to):
        self.ensure_session(require_login=True)
        payload = self._post_json(
            step="price_active",
            bld="dbms/MDC/STAT/standard/MDCSTAT01701",
            params={
                "locale": "ko_KR",
                "isuCd": str(full_code or "").strip(),
                "isuCd2": "",
                "strtDd": str(date_from).replace("-", ""),
                "endDd": str(date_to).replace("-", ""),
                "adjStkPrc_check": "Y",
                "adjStkPrc": 2,
                "share": "1",
                "money": "1",
                "csvxls_isNo": "false",
            },
            required_key="output",
            require_login=True,
        )
        rows = list(payload.get("output") or [])
        if not rows:
            raise KrxContractError("price_active returned zero rows")
        return rows

    def fetch_delisted_price(self, *, full_code, date_from, date_to):
        self.ensure_session(require_login=True)
        payload = self._post_json(
            step="price_delisted",
            bld="dbms/MDC/STAT/issue/MDCSTAT23902",
            params={
                "isuCd": str(full_code or "").strip(),
                "isuCd2": "",
                "strtDd": str(date_from).replace("-", ""),
                "endDd": str(date_to).replace("-", ""),
                "share": "1",
                "money": "1",
                "csvxls_isNo": "false",
            },
            required_key="output",
            require_login=True,
        )
        rows = list(payload.get("output") or [])
        if not rows:
            raise KrxContractError("price_delisted returned zero rows")
        return rows

    def fetch_active_price_range(self, *, full_code, date_from, date_to):
        rows_by_date = {}
        for window_from, window_to in iter_two_year_windows(date_from, date_to):
            rows = self.fetch_active_price(
                full_code=full_code,
                date_from=window_from.isoformat(),
                date_to=window_to.isoformat(),
            )
            for row in rows:
                date_key = str(row.get("TRD_DD") or "").strip()
                if not date_key:
                    raise KrxContractError("price_active row missing TRD_DD")
                rows_by_date[date_key] = row
        return [rows_by_date[key] for key in sorted(rows_by_date)]

    def fetch_delisted_price_range(self, *, full_code, date_from, date_to):
        rows_by_date = {}
        for window_from, window_to in iter_two_year_windows(date_from, date_to):
            rows = self.fetch_delisted_price(
                full_code=full_code,
                date_from=window_from.isoformat(),
                date_to=window_to.isoformat(),
            )
            for row in rows:
                date_key = str(row.get("TRD_DD") or "").strip()
                if not date_key:
                    raise KrxContractError("price_delisted row missing TRD_DD")
                rows_by_date[date_key] = row
        return [rows_by_date[key] for key in sorted(rows_by_date)]
