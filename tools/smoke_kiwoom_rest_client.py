#!/usr/bin/env python3

import json
import sys
from pathlib import Path
from tempfile import TemporaryDirectory


ROOT = Path(__file__).resolve().parent.parent
TOOLS_DIR = ROOT / "tools"
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

import kiwoom_rest_client as client_mod  # noqa: E402


class FakeResponse:
    def __init__(self, *, status_code=200, headers=None, payload=None, url="https://api.kiwoom.com/mock"):
        self.status_code = status_code
        self.headers = headers or {}
        self._payload = payload if payload is not None else {}
        self.text = json.dumps(self._payload, ensure_ascii=False)
        self.url = url

    def json(self):
        return self._payload


class FakeSession:
    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = []

    def post(self, url, headers=None, json=None, timeout=None):
        self.calls.append({"url": url, "headers": dict(headers or {}), "json": dict(json or {})})
        if not self._responses:
            raise AssertionError("no queued fake response remaining")
        return self._responses.pop(0)


class FakeRequests:
    def __init__(self, responses):
        self._responses = list(responses)
        self.last_session = None

    def Session(self):  # noqa: N802
        self.last_session = FakeSession(self._responses)
        return self.last_session


def main():
    original_loader = client_mod.load_requests_module
    original_app_key = client_mod.os.environ.get("KIWOOM_APP_KEY")
    original_secret_key = client_mod.os.environ.get("KIWOOM_SECRET_KEY")
    try:
        client_mod.os.environ["KIWOOM_APP_KEY"] = "app_test_key"
        client_mod.os.environ["KIWOOM_SECRET_KEY"] = "secret_test_key"
        fake_requests = FakeRequests(
            [
                FakeResponse(payload={"token": "token-123", "token_type": "Bearer", "expires_dt": "20991231235959"}),
                FakeResponse(
                    headers={"cont-yn": "Y", "next-key": "page-2", "api-id": "ka10080"},
                    payload={
                        "stk_cd": "005930",
                        "stk_min_pole_chart_qry": [
                            {
                                "cur_prc": "71000",
                                "trde_qty": "1200",
                                "cntr_tm": "20260403153000",
                                "open_pric": "70000",
                                "high_pric": "71200",
                                "low_pric": "69900",
                            }
                        ],
                    },
                ),
                FakeResponse(
                    headers={"cont-yn": "Y", "next-key": "page-3", "api-id": "ka10060"},
                    payload={
                        "stk_invsr_orgn_chart": [
                            {
                                "dt": "20160104",
                                "ind_invsr": "100",
                            }
                        ]
                    },
                ),
                FakeResponse(
                    headers={"cont-yn": "", "next-key": "", "api-id": "ka90013"},
                    payload={
                        "stk_daly_prm_trde_trnsn": [
                            {
                                "dt": "20160104",
                                "prm_netprps_amt": "3000000",
                            }
                        ]
                    },
                ),
                FakeResponse(
                    headers={"cont-yn": "", "next-key": "", "api-id": "ka10047"},
                    payload={
                        "cntr_str_daly": [
                            {
                                "dt": "20260403",
                                "cntr_str": "123.4",
                            }
                        ]
                    },
                ),
            ]
        )
        client_mod.load_requests_module = lambda: fake_requests
        with TemporaryDirectory() as tmp_dir:
            client = client_mod.KiwoomRestClient(
                retries=1,
                sleep_ms=1,
                trace_dir=tmp_dir,
                min_interval_ms=0,
                cooldown_429_ms=0,
            )
            token_info = client.issue_token()
            if token_info.get("status") != "issued":
                raise AssertionError(token_info)
            minute = client.fetch_minute_chart(symbol="005930", base_date="2026-04-03", trace_step="minute")
            if len(minute["rows"]) != 1 or minute["contYn"] != "Y" or minute["nextKey"] != "page-2":
                raise AssertionError(minute)
            investor = client.fetch_investor_daily(symbol="005930", date_key="2016-01-04", trace_step="investor")
            if investor["rows"][0]["dt"] != "20160104":
                raise AssertionError(investor)
            program = client.fetch_program_daily(symbol="005930", date_key="2016-01-04", trace_step="program")
            if program["rows"][0]["dt"] != "20160104":
                raise AssertionError(program)
            trade_strength = client.fetch_trade_strength_daily(symbol="005930", trace_step="strength")
            if trade_strength["rows"][0]["dt"] != "20260403":
                raise AssertionError(trade_strength)
            if len(fake_requests.last_session.calls) != 5:
                raise AssertionError(fake_requests.last_session.calls)
            token_call = fake_requests.last_session.calls[0]
            if token_call["url"] != "https://api.kiwoom.com/oauth2/token":
                raise AssertionError(token_call)
            minute_call = fake_requests.last_session.calls[1]
            if minute_call["headers"].get("api-id") != "ka10080":
                raise AssertionError(minute_call)
            if minute_call["json"].get("base_dt") != "20260403":
                raise AssertionError(minute_call)
            expected_trace_names = {"token_issue.json", "minute.json", "investor.json", "program.json", "strength.json"}
            observed_trace_names = {path.name for path in Path(tmp_dir).iterdir()}
            if expected_trace_names != observed_trace_names:
                raise AssertionError(observed_trace_names)

        client_mod.os.environ.pop("KIWOOM_APP_KEY", None)
        client_mod.os.environ.pop("KIWOOM_SECRET_KEY", None)
        client_mod.load_requests_module = lambda: FakeRequests([])
        missing_client = client_mod.KiwoomRestClient(retries=1, sleep_ms=1, min_interval_ms=0, cooldown_429_ms=0)
        try:
            missing_client.issue_token()
        except Exception as exc:
            if "missing KIWOOM_APP_KEY/KIWOOM_SECRET_KEY" not in str(exc):
                raise
        else:
            raise AssertionError("expected missing secret error")
    finally:
        if original_app_key is None:
            client_mod.os.environ.pop("KIWOOM_APP_KEY", None)
        else:
            client_mod.os.environ["KIWOOM_APP_KEY"] = original_app_key
        if original_secret_key is None:
            client_mod.os.environ.pop("KIWOOM_SECRET_KEY", None)
        else:
            client_mod.os.environ["KIWOOM_SECRET_KEY"] = original_secret_key
        client_mod.load_requests_module = original_loader

    print("ok smoke_kiwoom_rest_client")


if __name__ == "__main__":
    main()
