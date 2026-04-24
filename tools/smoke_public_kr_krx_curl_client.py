#!/usr/bin/env python3

import json
import sys
from pathlib import Path
from tempfile import TemporaryDirectory


ROOT = Path(__file__).resolve().parent.parent
TOOLS_DIR = ROOT / "tools"
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

import public_kr_krx_curl_client as client_mod  # noqa: E402


class FakeResponse:
    def __init__(self, *, status_code=200, text="", url="https://data.krx.co.kr/mock", headers=None):
        self.status_code = status_code
        self.text = text
        self.url = url
        self.headers = headers or {}

    def json(self):
        return json.loads(self.text)


class FakeSession:
    def __init__(self, responses):
        self._responses = list(responses)
        self.cookies = []

    def get(self, url, headers=None, timeout=None):
        if "data.krx.co.kr/" in str(url):
            self.cookies = ["JSESSIONID=fake"]
        return self._responses.pop(0)

    def post(self, url, headers=None, data=None, timeout=None):
        return self._responses.pop(0)


class FakeRequests:
    def __init__(self, responses):
        self._responses = list(responses)

    def Session(self, impersonate=None):  # noqa: N802
        return FakeSession(self._responses)


def main():
    original_loader = client_mod.load_curl_cffi_requests
    original_env_id = client_mod.os.environ.get("KRX_ID")
    original_env_pw = client_mod.os.environ.get("KRX_PW")
    try:
        client_mod.os.environ["KRX_ID"] = "tester"
        client_mod.os.environ["KRX_PW"] = "secret"
        with TemporaryDirectory() as tmp_dir:
            trace_dir = Path(tmp_dir) / "trace"
            client_mod.load_curl_cffi_requests = lambda: FakeRequests(
                [
                    FakeResponse(text="<html>root</html>"),
                    FakeResponse(text="<html>login page</html>"),
                    FakeResponse(text="<html>login jsp</html>"),
                    FakeResponse(text='{"_error_code":"CD001"}'),
                    FakeResponse(
                        text='{"block1":[{"full_code":"KR7005930003","short_code":"005930","codeName":"삼성전자"}]}'
                    ),
                    FakeResponse(
                        text='{"block1":[{"full_code":"KR7194510004","short_code":"194510","codeName":"파티게임즈"}]}'
                    ),
                    FakeResponse(text='{"output":[{"TRD_DD":"2020/01/02"},{"TRD_DD":"2020/01/03"}]}'),
                    FakeResponse(text='{"output":[{"TRD_DD":"2010/01/04"},{"TRD_DD":"2010/01/05"}]}'),
                ]
            )
            client = client_mod.KrxCurlClient(
                retries=1,
                sleep_ms=1,
                trace_dir=str(trace_dir),
                auth_mode=client_mod.KRX_AUTH_MODE_LOGIN_REQUIRED,
            )
            bundle = client.warm_root_session()
            if int(bundle.get("cookieCount") or 0) != 1:
                raise AssertionError(bundle)
            login_payload = client.login()
            if str(login_payload.get("_error_code") or "") != "CD001":
                raise AssertionError(login_payload)
            listed = client.fetch_listed_finder(search_text="005930")
            if listed[0]["short_code"] != "005930":
                raise AssertionError(listed)
            delisted = client.fetch_delisted_finder(search_text="194510")
            if delisted[0]["short_code"] != "194510":
                raise AssertionError(delisted)
            active_rows = client.fetch_active_price(full_code="KR7005930003", date_from="2020-01-02", date_to="2020-01-03")
            if len(active_rows) != 2:
                raise AssertionError(active_rows)
            delisted_rows = client.fetch_delisted_price(
                full_code="KR7194510004",
                date_from="2019-09-10",
                date_to="2019-09-11",
            )
            if len(delisted_rows) != 2:
                raise AssertionError(delisted_rows)
            expected_traces = {
                "root_session.json",
                "login_page.json",
                "login_jsp.json",
                "login_post.json",
                "finder_listed.json",
                "finder_delisted.json",
                "price_active.json",
                "price_delisted.json",
            }
            if expected_traces != {path.name for path in trace_dir.iterdir()}:
                raise AssertionError(sorted(path.name for path in trace_dir.iterdir()))

        windows = list(client_mod.iter_two_year_windows("2020-01-02", "2022-01-02"))
        if len(windows) != 2:
            raise AssertionError(windows)
        if windows[0][0].isoformat() != "2020-01-02" or windows[0][1].isoformat() != "2022-01-01":
            raise AssertionError(windows)
        if windows[1][0].isoformat() != "2022-01-02" or windows[1][1].isoformat() != "2022-01-02":
            raise AssertionError(windows)

        client_mod.os.environ.pop("KRX_ID", None)
        client_mod.os.environ.pop("KRX_PW", None)
        client_mod.load_curl_cffi_requests = lambda: FakeRequests(
            [
                FakeResponse(text="<html>root</html>"),
            ]
        )
        client = client_mod.KrxCurlClient(
            retries=1,
            sleep_ms=1,
            trace_dir="",
            auth_mode=client_mod.KRX_AUTH_MODE_LOGIN_REQUIRED,
        )
        try:
            client.login()
        except Exception as exc:
            if "missing KRX_ID/KRX_PW" not in str(exc):
                raise
        else:
            raise AssertionError("expected missing login secret contract error")
    finally:
        if original_env_id is None:
            client_mod.os.environ.pop("KRX_ID", None)
        else:
            client_mod.os.environ["KRX_ID"] = original_env_id
        if original_env_pw is None:
            client_mod.os.environ.pop("KRX_PW", None)
        else:
            client_mod.os.environ["KRX_PW"] = original_env_pw
        client_mod.load_curl_cffi_requests = original_loader

    print("ok smoke_public_kr_krx_curl_client")


if __name__ == "__main__":
    main()
