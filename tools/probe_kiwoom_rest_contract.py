#!/usr/bin/env python3

import argparse

from kiwoom_intraday_1m_common import is_regular_session_ts_kst, normalize_minute_timestamp
from public_kr_historical_inputs_common import iso_now_utc, write_json
from kiwoom_rest_client import KIWOOM_DEFAULT_BASE_URL, KiwoomContractError, KiwoomRestClient


PROBE_KIND = "kiwoom_rest_contract_probe_v1"


def parse_args():
    parser = argparse.ArgumentParser(description="Probe Kiwoom REST contract for TP12 intraday patching.")
    parser.add_argument("--output", required=True)
    parser.add_argument("--trace-dir", default="")
    parser.add_argument("--base-url", default=KIWOOM_DEFAULT_BASE_URL)
    parser.add_argument("--retries", type=int, default=2)
    parser.add_argument("--sleep-ms", type=int, default=400)
    parser.add_argument("--min-interval-ms", type=int, default=1200)
    parser.add_argument("--cooldown-429-ms", type=int, default=30000)
    parser.add_argument("--sample-symbol", default="005930")
    parser.add_argument("--minute-base-date", default="2026-04-03")
    parser.add_argument("--minute-direct-old-date", default="2016-01-04")
    parser.add_argument("--investor-date", default="2016-01-04")
    parser.add_argument("--program-date", default="2016-01-04")
    return parser.parse_args()


def row_range(rows, key_name):
    if not rows:
        return {"rowCount": 0, "first": None, "last": None}
    keys = [str((row or {}).get(key_name) or "").strip() for row in rows if str((row or {}).get(key_name) or "").strip()]
    if not keys:
        return {"rowCount": len(rows), "first": None, "last": None}
    return {
        "rowCount": len(rows),
        "first": min(keys),
        "last": max(keys),
    }


def minute_range(rows):
    if not rows:
        return {
            "rowCount": 0,
            "first": None,
            "last": None,
            "normalizedFirst": None,
            "normalizedLast": None,
            "sessionInvalidRowCount": 0,
        }
    raw_keys = [str((row or {}).get("cntr_tm") or "").strip() for row in rows if str((row or {}).get("cntr_tm") or "").strip()]
    normalized_keys = []
    session_invalid_row_count = 0
    for raw_key in raw_keys:
        normalized = normalize_minute_timestamp(raw_key)
        normalized_keys.append(normalized["tsKst"])
        if not is_regular_session_ts_kst(normalized["tsKst"]):
            session_invalid_row_count += 1
    return {
        "rowCount": len(rows),
        "first": min(raw_keys) if raw_keys else None,
        "last": max(raw_keys) if raw_keys else None,
        "normalizedFirst": min(normalized_keys) if normalized_keys else None,
        "normalizedLast": max(normalized_keys) if normalized_keys else None,
        "sessionInvalidRowCount": session_invalid_row_count,
    }


def append_step(summary, *, step, result, key_name):
    stats = minute_range(result.get("rows") or []) if key_name == "cntr_tm" else row_range(result.get("rows") or [], key_name)
    entry = {
        "step": step,
        "status": "ok",
        "rowCount": stats["rowCount"],
        "firstKey": stats["first"],
        "lastKey": stats["last"],
        "contYn": str(result.get("contYn") or "").strip() or None,
        "nextKey": str(result.get("nextKey") or "").strip() or None,
        "requestBody": dict(result.get("requestBody") or {}),
    }
    if key_name == "cntr_tm":
        entry["normalizedFirstKey"] = stats["normalizedFirst"]
        entry["normalizedLastKey"] = stats["normalizedLast"]
        entry["sessionInvalidRowCount"] = int(stats["sessionInvalidRowCount"] or 0)
        if int(stats["sessionInvalidRowCount"] or 0) > 0:
            raise KiwoomContractError(f"{step} returned minute rows outside regular session")
    summary["steps"].append(entry)


def main():
    args = parse_args()
    client = KiwoomRestClient(
        retries=args.retries,
        sleep_ms=args.sleep_ms,
        trace_dir=args.trace_dir,
        base_url=args.base_url,
        min_interval_ms=args.min_interval_ms,
        cooldown_429_ms=args.cooldown_429_ms,
    )
    summary = {
        "kind": PROBE_KIND,
        "generatedAt": iso_now_utc(),
        "status": "failed",
        "baseUrl": str(args.base_url or "").strip(),
        "sampleSymbol": str(args.sample_symbol or "").strip(),
        "steps": [],
        "failureReason": None,
    }
    try:
        token_info = client.issue_token(trace_step="token_issue")
        summary["steps"].append(
            {
                "step": "token_issue",
                "status": "ok",
                "tokenStatus": token_info.get("status"),
                "expiresAt": token_info.get("expiresAt"),
            }
        )
        minute_recent = client.fetch_minute_chart(
            symbol=args.sample_symbol,
            base_date=args.minute_base_date,
            trace_step="ka10080_recent_anchor",
        )
        if not minute_recent.get("rows"):
            raise KiwoomContractError("ka10080 recent-anchor probe returned zero rows")
        append_step(summary, step="ka10080_recent_anchor", result=minute_recent, key_name="cntr_tm")

        minute_old_anchor = client.fetch_minute_chart(
            symbol=args.sample_symbol,
            base_date=args.minute_direct_old_date,
            trace_step="ka10080_direct_old_anchor",
        )
        append_step(summary, step="ka10080_direct_old_anchor", result=minute_old_anchor, key_name="cntr_tm")

        investor_daily = client.fetch_investor_daily(
            symbol=args.sample_symbol,
            date_key=args.investor_date,
            trace_step="ka10060_historical_anchor",
        )
        if not investor_daily.get("rows"):
            raise KiwoomContractError("ka10060 historical-anchor probe returned zero rows")
        append_step(summary, step="ka10060_historical_anchor", result=investor_daily, key_name="dt")

        program_daily = client.fetch_program_daily(
            symbol=args.sample_symbol,
            date_key=args.program_date,
            trace_step="ka90013_historical_anchor",
        )
        if not program_daily.get("rows"):
            raise KiwoomContractError("ka90013 historical-anchor probe returned zero rows")
        append_step(summary, step="ka90013_historical_anchor", result=program_daily, key_name="dt")

        trade_strength_daily = client.fetch_trade_strength_daily(
            symbol=args.sample_symbol,
            trace_step="ka10047_recent_block",
        )
        if not trade_strength_daily.get("rows"):
            raise KiwoomContractError("ka10047 recent-block probe returned zero rows")
        append_step(summary, step="ka10047_recent_block", result=trade_strength_daily, key_name="dt")
        summary["status"] = "ok"
    except Exception as exc:
        summary["failureReason"] = f"{type(exc).__name__}:{exc}"
        write_json(args.output, summary)
        raise SystemExit(f"kiwoom contract probe failed: {type(exc).__name__}:{exc}") from exc

    write_json(args.output, summary)


if __name__ == "__main__":
    main()
