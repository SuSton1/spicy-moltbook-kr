#!/usr/bin/env python3

import json
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace


ROOT = Path(__file__).resolve().parent.parent
TOOLS_DIR = ROOT / "tools"
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

import probe_kiwoom_rest_contract as contract_mod  # noqa: E402
import probe_kiwoom_rest_depth as depth_mod  # noqa: E402


class FakeClient:
    def __init__(self, **kwargs):
        self.minute_pages = [
            {
                "rows": [
                    {"cntr_tm": "20260403153000"},
                    {"cntr_tm": "20260402120000"},
                ],
                "contYn": "Y",
                "nextKey": "minute-page-2",
                "requestBody": {"base_dt": "20260403"},
            },
            {
                "rows": [
                    {"cntr_tm": "20260401100000"},
                    {"cntr_tm": "20260331150000"},
                ],
                "contYn": "",
                "nextKey": "",
                "requestBody": {"base_dt": "20260403"},
            },
        ]
        self.minute_direct = {
            "rows": [],
            "contYn": "",
            "nextKey": "",
            "requestBody": {"base_dt": "20160104"},
        }
        self.investor_pages = [
            {
                "rows": [{"dt": "20160104"}],
                "contYn": "Y",
                "nextKey": "investor-page-2",
                "requestBody": {"dt": "20160104"},
            },
            {
                "rows": [{"dt": "20151231"}],
                "contYn": "",
                "nextKey": "",
                "requestBody": {"dt": "20160104"},
            },
        ]
        self.program_pages = [
            {
                "rows": [{"dt": "20160104"}],
                "contYn": "Y",
                "nextKey": "program-page-2",
                "requestBody": {"date": "20160104"},
            },
            {
                "rows": [{"dt": "20151231"}],
                "contYn": "",
                "nextKey": "",
                "requestBody": {"date": "20160104"},
            },
        ]
        self.trade_strength_pages = [
            {
                "rows": [{"dt": "20260403"}],
                "contYn": "Y",
                "nextKey": "strength-page-2",
                "requestBody": {"stk_cd": "005930"},
            },
            {
                "rows": [{"dt": "20260402"}],
                "contYn": "",
                "nextKey": "",
                "requestBody": {"stk_cd": "005930"},
            },
        ]

    def issue_token(self, **kwargs):
        return {"status": "issued", "expiresAt": "2099-12-31T23:59:59+00:00"}

    def fetch_minute_chart(self, *, base_date="", next_key=None, **kwargs):
        if str(base_date or "") == "2016-01-04":
            return dict(self.minute_direct)
        if str(next_key or "").strip() == "minute-page-2":
            return dict(self.minute_pages[1])
        return dict(self.minute_pages[0])

    def fetch_investor_daily(self, *, next_key=None, **kwargs):
        if str(next_key or "").strip() == "investor-page-2":
            return dict(self.investor_pages[1])
        return dict(self.investor_pages[0])

    def fetch_program_daily(self, *, next_key=None, **kwargs):
        if str(next_key or "").strip() == "program-page-2":
            return dict(self.program_pages[1])
        return dict(self.program_pages[0])

    def fetch_trade_strength_daily(self, *, next_key=None, **kwargs):
        if str(next_key or "").strip() == "strength-page-2":
            return dict(self.trade_strength_pages[1])
        return dict(self.trade_strength_pages[0])


def main():
    original_contract_parse_args = contract_mod.parse_args
    original_contract_client = contract_mod.KiwoomRestClient
    original_depth_parse_args = depth_mod.parse_args
    original_depth_client = depth_mod.KiwoomRestClient
    try:
        with TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            contract_out = tmp_path / "contract.json"
            depth_out = tmp_path / "depth.json"
            contract_mod.parse_args = lambda: SimpleNamespace(
                output=str(contract_out),
                trace_dir="",
                base_url="https://api.kiwoom.com",
                retries=1,
                sleep_ms=1,
                min_interval_ms=0,
                cooldown_429_ms=0,
                sample_symbol="005930",
                minute_base_date="2026-04-03",
                minute_direct_old_date="2016-01-04",
                investor_date="2016-01-04",
                program_date="2016-01-04",
            )
            contract_mod.KiwoomRestClient = FakeClient
            contract_mod.main()
            contract_summary = json.loads(contract_out.read_text(encoding="utf-8"))
            if contract_summary.get("status") != "ok":
                raise AssertionError(contract_summary)
            if len(contract_summary.get("steps") or []) != 6:
                raise AssertionError(contract_summary)
            minute_step = next(step for step in contract_summary["steps"] if step["step"] == "ka10080_recent_anchor")
            if minute_step.get("normalizedFirstKey") != "2026-04-02T12:00:00+09:00":
                raise AssertionError(minute_step)
            if minute_step.get("normalizedLastKey") != "2026-04-03T15:30:00+09:00":
                raise AssertionError(minute_step)
            if int(minute_step.get("sessionInvalidRowCount") or 0) != 0:
                raise AssertionError(minute_step)
            depth_mod.parse_args = lambda: SimpleNamespace(
                output=str(depth_out),
                trace_dir="",
                base_url="https://api.kiwoom.com",
                retries=1,
                sleep_ms=1,
                min_interval_ms=0,
                cooldown_429_ms=0,
                sample_symbol="005930",
                minute_base_date="2026-04-03",
                minute_direct_old_date="2016-01-04",
                minute_max_pages=4,
                side_max_pages=4,
                minute_required_floor="2026-03-31",
                investor_date="2016-01-04",
                program_date="2016-01-04",
            )
            depth_mod.KiwoomRestClient = FakeClient
            depth_mod.main()
            depth_summary = json.loads(depth_out.read_text(encoding="utf-8"))
            if depth_summary.get("status") != "ok":
                raise AssertionError(depth_summary)
            if depth_summary["datasets"]["ka10080"]["oldestValue"] != "2026-03-31T15:00:00+09:00":
                raise AssertionError(depth_summary["datasets"]["ka10080"])
            if int(depth_summary["datasets"]["ka10080"].get("sessionInvalidRowCount") or 0) != 0:
                raise AssertionError(depth_summary["datasets"]["ka10080"])
            if depth_summary["datasets"]["ka10060"]["oldestValue"] != "2015-12-31":
                raise AssertionError(depth_summary["datasets"]["ka10060"])
    finally:
        contract_mod.parse_args = original_contract_parse_args
        contract_mod.KiwoomRestClient = original_contract_client
        depth_mod.parse_args = original_depth_parse_args
        depth_mod.KiwoomRestClient = original_depth_client

    print("ok smoke_kiwoom_rest_probes")


if __name__ == "__main__":
    main()
