#!/usr/bin/env python3

import argparse

from public_kr_historical_inputs_common import iso_now_utc, write_json
from public_kr_krx_curl_client import (
    KRX_AUTH_MODE_ANONYMOUS,
    KRX_AUTH_MODE_AUTO,
    KRX_AUTH_MODE_LOGIN_REQUIRED,
    KrxContractError,
    KrxCurlClient,
)


def parse_args():
    parser = argparse.ArgumentParser(description="Probe KRX finder/price HTTP contract for historical backfill.")
    parser.add_argument("--output", required=True)
    parser.add_argument("--trace-dir", default="")
    parser.add_argument("--retries", type=int, default=2)
    parser.add_argument("--sleep-ms", type=int, default=250)
    parser.add_argument(
        "--auth-mode",
        choices=(KRX_AUTH_MODE_AUTO, KRX_AUTH_MODE_ANONYMOUS, KRX_AUTH_MODE_LOGIN_REQUIRED),
        default=KRX_AUTH_MODE_AUTO,
    )
    parser.add_argument("--active-short-code", default="005930")
    parser.add_argument("--active-full-code", default="KR7005930003")
    parser.add_argument("--active-from", default="2020-01-02")
    parser.add_argument("--active-to", default="2020-01-31")
    parser.add_argument("--delisted-short-code", default="194510")
    parser.add_argument("--delisted-full-code", default="KR7194510004")
    parser.add_argument("--delisted-from", default="2019-09-10")
    parser.add_argument("--delisted-to", default="2020-09-09")
    return parser.parse_args()


def main():
    args = parse_args()
    client = KrxCurlClient(
        retries=args.retries,
        sleep_ms=args.sleep_ms,
        trace_dir=args.trace_dir,
        auth_mode=args.auth_mode,
    )
    summary = {
        "kind": "public_kr_krx_contract_probe_v1",
        "generatedAt": iso_now_utc(),
        "status": "failed",
        "authMode": args.auth_mode,
        "loginStatus": "not_attempted",
        "activeSample": {
            "shortCode": args.active_short_code,
            "fullCode": args.active_full_code,
            "from": args.active_from,
            "to": args.active_to,
        },
        "delistedSample": {
            "shortCode": args.delisted_short_code,
            "fullCode": args.delisted_full_code,
            "from": args.delisted_from,
            "to": args.delisted_to,
        },
        "steps": [],
        "failureReason": None,
    }

    try:
        bundle = client.warm_root_session()
        summary["steps"].append(
            {
                "step": "root_session",
                "status": "ok",
                "cookieCount": bundle.get("cookieCount"),
            }
        )
        if args.auth_mode == KRX_AUTH_MODE_LOGIN_REQUIRED:
            client.login()
            summary["loginStatus"] = "ok"
            summary["steps"].append({"step": "login", "status": "ok"})
        listed_rows = client.fetch_listed_finder(search_text=args.active_short_code)
        listed_match = next(
            (
                row
                for row in listed_rows
                if str(row.get("short_code") or "").strip() == str(args.active_short_code).strip()
            ),
            None,
        )
        if listed_match is None:
            raise KrxContractError(f"finder_listed missing active short_code={args.active_short_code}")
        summary["steps"].append(
            {
                "step": "finder_listed",
                "status": "ok",
                "match": {
                    "shortCode": listed_match.get("short_code"),
                    "fullCode": listed_match.get("full_code"),
                    "name": listed_match.get("codeName"),
                },
            }
        )
        delisted_rows = client.fetch_delisted_finder(search_text=args.delisted_short_code)
        delisted_match = next(
            (
                row
                for row in delisted_rows
                if str(row.get("short_code") or "").strip() == str(args.delisted_short_code).strip()
            ),
            None,
        )
        if delisted_match is None:
            raise KrxContractError(f"finder_delisted missing short_code={args.delisted_short_code}")
        summary["steps"].append(
            {
                "step": "finder_delisted",
                "status": "ok",
                "match": {
                    "shortCode": delisted_match.get("short_code"),
                    "fullCode": delisted_match.get("full_code"),
                    "name": delisted_match.get("codeName"),
                },
            }
        )
        active_rows = client.fetch_active_price(
            full_code=args.active_full_code,
            date_from=args.active_from,
            date_to=args.active_to,
        )
        summary["steps"].append(
            {
                "step": "price_active",
                "status": "ok",
                "rowCount": len(active_rows),
                "firstDate": (active_rows[0] or {}).get("TRD_DD"),
                "lastDate": (active_rows[-1] or {}).get("TRD_DD"),
            }
        )
        delisted_price_rows = client.fetch_delisted_price(
            full_code=args.delisted_full_code,
            date_from=args.delisted_from,
            date_to=args.delisted_to,
        )
        summary["steps"].append(
            {
                "step": "price_delisted",
                "status": "ok",
                "rowCount": len(delisted_price_rows),
                "firstDate": (delisted_price_rows[0] or {}).get("TRD_DD"),
                "lastDate": (delisted_price_rows[-1] or {}).get("TRD_DD"),
            }
        )
        summary["status"] = "ok"
    except Exception as exc:
        if summary["loginStatus"] == "not_attempted" and args.auth_mode == KRX_AUTH_MODE_LOGIN_REQUIRED:
            summary["loginStatus"] = "failed"
        summary["failureReason"] = f"{type(exc).__name__}:{exc}"
        write_json(args.output, summary)
        raise SystemExit(f"krx contract probe failed: {type(exc).__name__}:{exc}") from exc

    write_json(args.output, summary)


if __name__ == "__main__":
    main()
