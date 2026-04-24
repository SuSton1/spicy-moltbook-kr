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

import build_historical_shares_intervals as shares_builder  # noqa: E402
import build_historical_symbol_lifecycle as lifecycle_builder  # noqa: E402
from public_kr_historical_common import load_historical_lifecycle  # noqa: E402
from public_kr_historical_inputs_common import normalize_kind_market_code  # noqa: E402


def write_jsonl(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")))
            fh.write("\n")


def main():
    with TemporaryDirectory() as tmp_dir:
        if normalize_kind_market_code("유가") != "STK":
            raise AssertionError("expected '유가' alias to normalize to STK")
        root = Path(tmp_dir)
        data_dir = root / "data"
        data_dir.mkdir(parents=True, exist_ok=True)

        seed_row = {
            "symbol": "215580",
            "name": "대우스팩3호",
            "fullCode": "KR7215580002",
            "listedFrom": "2015-05-19",
            "effectiveFrom": "2016-01-01",
            "effectiveTo": "2016-01-04",
        }
        seed_calls = []

        def fake_delisted_fetch(*, full_code, date_from, date_to):
            seed_calls.append((full_code, date_from, date_to))
            if date_from >= "2015-12-24":
                raise RuntimeError("mock_zero_rows")
            return [
                {"TRD_DD": "2015/12/18", "LIST_SHRS": "100"},
                {"TRD_DD": "2016/01/04", "LIST_SHRS": "110"},
            ]

        seeded_intervals = shares_builder.fetch_krx_symbol_with_seed_lookback(
            seed_row,
            client=object(),
            fetch_range_fn=fake_delisted_fetch,
            source_prefix="delisted_price",
        )
        if [call[1] for call in seed_calls] != ["2015-12-25", "2015-12-18"]:
            raise AssertionError(seed_calls)
        if seeded_intervals != [
            {
                "symbol": "215580",
                "effectiveFrom": "2016-01-01",
                "effectiveTo": "2016-01-03",
                "sharesOutstanding": 100,
                "source": "krx.delisted_price:KR7215580002",
            },
            {
                "symbol": "215580",
                "effectiveFrom": "2016-01-04",
                "effectiveTo": "2016-01-04",
                "sharesOutstanding": 110,
                "source": "krx.delisted_price:KR7215580002",
            },
        ]:
            raise AssertionError(seeded_intervals)

        fake_kind_rows = [
            {"회사명": "Test A", "시장구분": "유가", "종목코드": "000005", "상장일": "2015-12-30"},
            {"회사명": "Ignored New", "시장구분": "코스닥", "종목코드": "123ABC", "상장일": "2016-01-02"},
            {"회사명": "Too Late", "시장구분": "코스닥", "종목코드": "000030", "상장일": "2020-05-01"},
        ]
        fake_delisting_rows = [
            {
                "Symbol": "000010",
                "Name": "Test B",
                "Market": "KOSDAQ",
                "SecuGroup": "주권",
                "ListingDate": "2015-01-01",
                "DelistingDate": "2016-01-04",
            },
            {
                "Symbol": "ETF001",
                "Name": "Ignored ETF",
                "Market": "KOSPI",
                "SecuGroup": "ETF",
                "ListingDate": "2015-01-01",
                "DelistingDate": "2016-01-04",
            },
        ]
        fake_finder_maps = {
            "listed": {"000005": {"fullCode": "KR7000005000"}},
            "delisted": {"000010": {"fullCode": "KR7000010000"}},
        }

        lifecycle_output = data_dir / "historical_symbol_lifecycle.jsonl"
        lifecycle_args = SimpleNamespace(
            date_from="2016-01-01",
            date_to="2016-01-04",
            output=str(lifecycle_output),
            summary_out=str(root / "lifecycle_summary.json"),
            audit_dir=str(root / "audit"),
            retries=1,
            sleep_ms=1,
        )
        original_kind_loader = lifecycle_builder.load_kind_current_list_rows
        original_fdr_loader = lifecycle_builder.load_fdr_delisting_rows
        original_finder_loader = lifecycle_builder.load_krx_finder_maps
        lifecycle_builder.load_kind_current_list_rows = lambda retries, sleep_ms: list(fake_kind_rows)
        lifecycle_builder.load_fdr_delisting_rows = lambda retries, sleep_ms: (
            list(fake_delisting_rows),
            {"name": "fake_delisting.csv", "downloadUrl": "https://example.com/fake_delisting.csv"},
        )
        lifecycle_builder.load_krx_finder_maps = lambda retries, sleep_ms: dict(fake_finder_maps)
        try:
            lifecycle_builder.main.__globals__["parse_args"] = lambda: lifecycle_args
            lifecycle_builder.main()
        finally:
            lifecycle_builder.load_kind_current_list_rows = original_kind_loader
            lifecycle_builder.load_fdr_delisting_rows = original_fdr_loader
            lifecycle_builder.load_krx_finder_maps = original_finder_loader
            lifecycle_builder.main.__globals__["parse_args"] = lifecycle_builder.parse_args

        with open(lifecycle_output, encoding="utf-8") as fh:
            lifecycle_rows = [json.loads(line) for line in fh if line.strip()]
        if len(lifecycle_rows) != 2:
            raise AssertionError(lifecycle_rows)
        active = next(row for row in lifecycle_rows if row["symbol"] == "000005")
        if active["listedFrom"] != "2015-12-30" or active["delistedOn"] is not None:
            raise AssertionError(active)
        if active["fullCode"] != "KR7000005000":
            raise AssertionError(active)
        delisted = next(row for row in lifecycle_rows if row["symbol"] == "000010")
        if delisted["delistedOn"] != "2016-01-04" or delisted["fullCode"] != "KR7000010000":
            raise AssertionError(delisted)

        same_day_lifecycle = load_historical_lifecycle(
            str(lifecycle_output),
            day_from=lifecycle_builder.parse_day("2016-01-04"),
            day_to=lifecycle_builder.parse_day("2016-01-04"),
            shard_index=None,
            shard_count=None,
            security_type="COMMON",
        )
        if "000010" in same_day_lifecycle:
            raise AssertionError(same_day_lifecycle)

        spanning_lifecycle = load_historical_lifecycle(
            str(lifecycle_output),
            day_from=lifecycle_builder.parse_day("2016-01-03"),
            day_to=lifecycle_builder.parse_day("2016-01-04"),
            shard_index=None,
            shard_count=None,
            security_type="COMMON",
        )
        spanning_delisted = spanning_lifecycle.get("000010")
        if spanning_delisted is None:
            raise AssertionError(spanning_lifecycle)
        if spanning_delisted["effectiveFrom"] != "2016-01-03" or spanning_delisted["effectiveTo"] != "2016-01-03":
            raise AssertionError(spanning_delisted)

        same_day_shares_rows = shares_builder.load_symbols(
            str(lifecycle_output),
            lifecycle_builder.parse_day("2016-01-04"),
            lifecycle_builder.parse_day("2016-01-04"),
        )
        if any(row["symbol"] == "000010" for row in same_day_shares_rows):
            raise AssertionError(same_day_shares_rows)

        failure_args = SimpleNamespace(
            date_from="2016-01-01",
            date_to="2016-01-04",
            lifecycle_path=str(lifecycle_output),
            output=str(data_dir / "historical_shares_intervals.jsonl"),
            summary_out=str(root / "shares_summary_failure.json"),
            audit_dir=str(root / "audit"),
            max_workers=1,
            krx_max_workers=1,
            krx_auth_mode="login-required",
            retries=1,
            sleep_ms=1,
            krx_min_interval_ms=1,
            krx_cooldown_ms=1,
            checkpoint_every=1,
        )
        original_fetcher = shares_builder.fetch_active_krx_symbol
        original_delisted_fetcher = shares_builder.fetch_delisted_krx_symbol
        original_build_client = shares_builder.build_krx_client
        shares_builder.build_krx_client = lambda **kwargs: object()
        shares_builder.fetch_active_krx_symbol = lambda row, client: [
            {
                "symbol": row["symbol"],
                "effectiveFrom": "2016-01-01",
                "effectiveTo": "2016-01-04",
                "sharesOutstanding": 100,
                "source": f"krx.active_price:{row['fullCode']}",
            }
        ]
        shares_builder.fetch_delisted_krx_symbol = lambda row, client: (_ for _ in ()).throw(
            RuntimeError("mock_delisted_failure")
        )
        try:
            shares_builder.main.__globals__["parse_args"] = lambda: failure_args
            try:
                shares_builder.main()
            except SystemExit as exc:
                if "missing source coverage" not in str(exc):
                    raise
            else:
                raise AssertionError("expected shares builder to fail on missing delisted symbols")
        finally:
            shares_builder.build_krx_client = original_build_client
            shares_builder.fetch_active_krx_symbol = original_fetcher
            shares_builder.fetch_delisted_krx_symbol = original_delisted_fetcher
            shares_builder.main.__globals__["parse_args"] = shares_builder.parse_args

        missing_audit = root / "audit" / "historical_shares_missing_symbols.json"
        if not missing_audit.exists():
            raise AssertionError("expected missing shares audit")

        full_lifecycle = data_dir / "historical_symbol_lifecycle_full.jsonl"
        write_jsonl(full_lifecycle, [active, delisted])
        shares_output = data_dir / "historical_shares_intervals_active_only.jsonl"
        success_args = SimpleNamespace(
            date_from="2016-01-01",
            date_to="2016-01-04",
            lifecycle_path=str(full_lifecycle),
            output=str(shares_output),
            summary_out=str(root / "shares_summary_success.json"),
            audit_dir=str(root / "audit"),
            max_workers=1,
            krx_max_workers=1,
            krx_auth_mode="login-required",
            retries=1,
            sleep_ms=1,
            krx_min_interval_ms=1,
            krx_cooldown_ms=1,
            checkpoint_every=1,
        )
        shares_builder.build_krx_client = lambda **kwargs: object()
        shares_builder.fetch_active_krx_symbol = lambda row, client: [
            {
                "symbol": row["symbol"],
                "effectiveFrom": "2016-01-01",
                "effectiveTo": "2016-01-02",
                "sharesOutstanding": 100,
                "source": f"krx.active_price:{row['fullCode']}",
            },
            {
                "symbol": row["symbol"],
                "effectiveFrom": "2016-01-03",
                "effectiveTo": "2016-01-04",
                "sharesOutstanding": 150,
                "source": f"krx.active_price:{row['fullCode']}",
            },
        ]
        shares_builder.fetch_delisted_krx_symbol = lambda row, client: [
            {
                "symbol": row["symbol"],
                "effectiveFrom": "2016-01-01",
                "effectiveTo": "2016-01-04",
                "sharesOutstanding": 200,
                "source": f"krx.delisted_price:{row['fullCode']}",
            }
        ]
        try:
            shares_builder.main.__globals__["parse_args"] = lambda: success_args
            shares_builder.main()
        finally:
            shares_builder.build_krx_client = original_build_client
            shares_builder.fetch_active_krx_symbol = original_fetcher
            shares_builder.fetch_delisted_krx_symbol = original_delisted_fetcher
            shares_builder.main.__globals__["parse_args"] = shares_builder.parse_args

        with open(shares_output, encoding="utf-8") as fh:
            share_rows = [json.loads(line) for line in fh if line.strip()]
        if len(share_rows) != 3:
            raise AssertionError(share_rows)
        if share_rows[0]["effectiveFrom"] != "2016-01-01" or share_rows[0]["effectiveTo"] != "2016-01-02":
            raise AssertionError(share_rows[0])
        if share_rows[1]["effectiveFrom"] != "2016-01-03" or share_rows[1]["sharesOutstanding"] != 150:
            raise AssertionError(share_rows[1])
        if share_rows[2]["symbol"] != "000010" or share_rows[2]["sharesOutstanding"] != 200:
            raise AssertionError(share_rows[2])

        for wrapper in (
            ROOT / "tools" / "run_public_kr_historical_inputs.sh",
            ROOT / "tools" / "server_run_public_kr_historical_inputs.sh",
        ):
            import subprocess

            subprocess.run(["bash", "-n", str(wrapper)], cwd=root, check=True)

    print("ok smoke_public_kr_historical_input_builders")


if __name__ == "__main__":
    main()
