#!/usr/bin/env python3

import argparse
from datetime import datetime

from kiwoom_intraday_1m_common import is_regular_session_ts_kst, normalize_minute_timestamp
from public_kr_historical_inputs_common import iso_now_utc, write_json
from kiwoom_rest_client import KIWOOM_DEFAULT_BASE_URL, KiwoomContractError, KiwoomRestClient, normalize_date_key


PROBE_KIND = "kiwoom_rest_depth_probe_v1"


def parse_args():
    parser = argparse.ArgumentParser(description="Probe Kiwoom continuation depth for TP12 intraday inputs.")
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
    parser.add_argument("--minute-max-pages", type=int, default=8)
    parser.add_argument("--side-max-pages", type=int, default=8)
    parser.add_argument("--minute-required-floor", default="")
    parser.add_argument("--investor-date", default="2016-01-04")
    parser.add_argument("--program-date", default="2016-01-04")
    return parser.parse_args()


def normalize_dt(raw):
    text = str(raw or "").strip()
    if not text:
        return None
    for fmt in ("%Y%m%d", "%Y-%m-%d", "%Y/%m/%d"):
        try:
            return datetime.strptime(text, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def walk_pages(*, fetch_page, value_normalizer, max_pages):
    page_count = 0
    total_rows = 0
    cont_yn = None
    next_key = None
    oldest_value = None
    newest_value = None
    while True:
        page_count += 1
        result = fetch_page(cont_yn=cont_yn, next_key=next_key, page_index=page_count)
        rows = result.get("rows") or []
        total_rows += len(rows)
        values = [value_normalizer((row or {})) for row in rows]
        values = [value for value in values if value]
        if values:
            page_oldest = min(values)
            page_newest = max(values)
            oldest_value = page_oldest if oldest_value is None else min(oldest_value, page_oldest)
            newest_value = page_newest if newest_value is None else max(newest_value, page_newest)
        cont_yn = str(result.get("contYn") or "").strip()
        next_key = str(result.get("nextKey") or "").strip()
        if page_count >= int(max_pages or 0):
            break
        if cont_yn != "Y" or not next_key:
            break
    return {
        "pageCount": page_count,
        "rowCount": total_rows,
        "oldestValue": oldest_value,
        "newestValue": newest_value,
        "lastContYn": cont_yn or None,
        "lastNextKey": next_key or None,
    }


def walk_minute_pages(*, fetch_page, max_pages):
    page_count = 0
    total_rows = 0
    cont_yn = None
    next_key = None
    oldest_value = None
    newest_value = None
    session_invalid_row_count = 0
    while True:
        page_count += 1
        result = fetch_page(cont_yn=cont_yn, next_key=next_key, page_index=page_count)
        rows = result.get("rows") or []
        total_rows += len(rows)
        values = []
        for row in rows:
            raw_value = (row or {}).get("cntr_tm")
            if str(raw_value or "").strip():
                normalized = normalize_minute_timestamp(raw_value)
                values.append(normalized["tsKst"])
                if not is_regular_session_ts_kst(normalized["tsKst"]):
                    session_invalid_row_count += 1
        if values:
            page_oldest = min(values)
            page_newest = max(values)
            oldest_value = page_oldest if oldest_value is None else min(oldest_value, page_oldest)
            newest_value = page_newest if newest_value is None else max(newest_value, page_newest)
        cont_yn = str(result.get("contYn") or "").strip()
        next_key = str(result.get("nextKey") or "").strip()
        if page_count >= int(max_pages or 0):
            break
        if cont_yn != "Y" or not next_key:
            break
    return {
        "pageCount": page_count,
        "rowCount": total_rows,
        "oldestValue": oldest_value,
        "newestValue": newest_value,
        "lastContYn": cont_yn or None,
        "lastNextKey": next_key or None,
        "sessionInvalidRowCount": session_invalid_row_count,
    }


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
        "minuteRequiredFloor": normalize_date_key(args.minute_required_floor) if str(args.minute_required_floor or "").strip() else None,
        "datasets": {},
        "failureReason": None,
    }
    try:
        token_info = client.issue_token(trace_step="token_issue")
        summary["tokenStatus"] = token_info.get("status")
        summary["tokenExpiresAt"] = token_info.get("expiresAt")

        direct_old_anchor = client.fetch_minute_chart(
            symbol=args.sample_symbol,
            base_date=args.minute_direct_old_date,
            trace_step="ka10080_direct_old_anchor",
        )
        direct_old_rows = direct_old_anchor.get("rows") or []
        direct_old_normalized = []
        direct_old_session_invalid = 0
        for row in direct_old_rows:
            raw_value = (row or {}).get("cntr_tm")
            if not str(raw_value or "").strip():
                continue
            normalized = normalize_minute_timestamp(raw_value)
            direct_old_normalized.append(normalized["tsKst"])
            if not is_regular_session_ts_kst(normalized["tsKst"]):
                direct_old_session_invalid += 1
        summary["datasets"]["ka10080_direct_old_anchor"] = {
            "rowCount": len(direct_old_rows),
            "contYn": str(direct_old_anchor.get("contYn") or "").strip() or None,
            "nextKey": str(direct_old_anchor.get("nextKey") or "").strip() or None,
            "requestBody": dict(direct_old_anchor.get("requestBody") or {}),
            "normalizedOldestValue": min(direct_old_normalized) if direct_old_normalized else None,
            "normalizedNewestValue": max(direct_old_normalized) if direct_old_normalized else None,
            "sessionInvalidRowCount": direct_old_session_invalid,
        }

        minute_summary = walk_minute_pages(
            fetch_page=lambda cont_yn, next_key, page_index: client.fetch_minute_chart(
                symbol=args.sample_symbol,
                base_date=args.minute_base_date,
                cont_yn=cont_yn,
                next_key=next_key,
                trace_step=f"ka10080_page_{page_index}",
            ),
            max_pages=args.minute_max_pages,
        )
        if int(minute_summary["rowCount"] or 0) <= 0:
            raise KiwoomContractError("ka10080 depth probe returned zero rows")
        if int(minute_summary["sessionInvalidRowCount"] or 0) > 0:
            raise KiwoomContractError("ka10080 depth probe returned minute rows outside regular session")
        summary["datasets"]["ka10080"] = minute_summary

        investor_summary = walk_pages(
            fetch_page=lambda cont_yn, next_key, page_index: client.fetch_investor_daily(
                symbol=args.sample_symbol,
                date_key=args.investor_date,
                cont_yn=cont_yn,
                next_key=next_key,
                trace_step=f"ka10060_page_{page_index}",
            ),
            value_normalizer=lambda row: normalize_dt((row or {}).get("dt")),
            max_pages=args.side_max_pages,
        )
        if int(investor_summary["rowCount"] or 0) <= 0:
            raise KiwoomContractError("ka10060 depth probe returned zero rows")
        summary["datasets"]["ka10060"] = investor_summary

        program_summary = walk_pages(
            fetch_page=lambda cont_yn, next_key, page_index: client.fetch_program_daily(
                symbol=args.sample_symbol,
                date_key=args.program_date,
                cont_yn=cont_yn,
                next_key=next_key,
                trace_step=f"ka90013_page_{page_index}",
            ),
            value_normalizer=lambda row: normalize_dt((row or {}).get("dt")),
            max_pages=args.side_max_pages,
        )
        if int(program_summary["rowCount"] or 0) <= 0:
            raise KiwoomContractError("ka90013 depth probe returned zero rows")
        summary["datasets"]["ka90013"] = program_summary

        trade_strength_summary = walk_pages(
            fetch_page=lambda cont_yn, next_key, page_index: client.fetch_trade_strength_daily(
                symbol=args.sample_symbol,
                cont_yn=cont_yn,
                next_key=next_key,
                trace_step=f"ka10047_page_{page_index}",
            ),
            value_normalizer=lambda row: normalize_dt((row or {}).get("dt")),
            max_pages=args.side_max_pages,
        )
        if int(trade_strength_summary["rowCount"] or 0) <= 0:
            raise KiwoomContractError("ka10047 depth probe returned zero rows")
        summary["datasets"]["ka10047"] = trade_strength_summary

        required_floor = summary["minuteRequiredFloor"]
        oldest_minute = str(minute_summary.get("oldestValue") or "").strip()
        if required_floor and oldest_minute:
            if oldest_minute[:10] > datetime.strptime(required_floor, "%Y%m%d").strftime("%Y-%m-%d"):
                raise KiwoomContractError(
                    f"minute depth probe did not reach required floor: required={required_floor} observed={oldest_minute}"
                )
        summary["status"] = "ok"
    except Exception as exc:
        summary["failureReason"] = f"{type(exc).__name__}:{exc}"
        write_json(args.output, summary)
        raise SystemExit(f"kiwoom depth probe failed: {type(exc).__name__}:{exc}") from exc

    write_json(args.output, summary)


if __name__ == "__main__":
    main()
