#!/usr/bin/env python3


CANDLE_SOURCE_ACTIVE_YAHOO = "ACTIVE_YAHOO"
CANDLE_SOURCE_ACTIVE_KRX = "ACTIVE_KRX"
CANDLE_SOURCE_DELISTED_KRX = "DELISTED_KRX"
SHARES_SOURCE_ACTIVE_KRX = "ACTIVE_KRX"
SHARES_SOURCE_DELISTED_KRX = "DELISTED_KRX"

ACTIVE_CANDLE_PROVIDER_YAHOO = "yahoo"
ACTIVE_CANDLE_PROVIDER_KRX = "krx"


def is_delisted_lifecycle_row(row):
    return bool(str(row.get("delistedOn") or "").strip())


def resolve_active_candle_source(active_candle_provider):
    provider = str(active_candle_provider or ACTIVE_CANDLE_PROVIDER_YAHOO).strip().lower()
    if provider == ACTIVE_CANDLE_PROVIDER_YAHOO:
        return CANDLE_SOURCE_ACTIVE_YAHOO
    if provider == ACTIVE_CANDLE_PROVIDER_KRX:
        return CANDLE_SOURCE_ACTIVE_KRX
    raise ValueError(f"unsupported active candle provider: {active_candle_provider}")


def build_source_manifest_row(row, *, active_candle_provider=ACTIVE_CANDLE_PROVIDER_YAHOO):
    symbol = str(row.get("symbol") or "").strip()
    if not symbol:
        raise ValueError("missing lifecycle symbol for source manifest")
    delisted = is_delisted_lifecycle_row(row)
    return {
        "symbol": symbol,
        "fullCode": str(row.get("fullCode") or "").strip() or None,
        "marketCode": str(row.get("marketCode") or "").strip() or None,
        "type": str(row.get("type") or "COMMON").strip() or "COMMON",
        "isDelisted": delisted,
        "candleSource": CANDLE_SOURCE_DELISTED_KRX if delisted else resolve_active_candle_source(active_candle_provider),
        "sharesSource": SHARES_SOURCE_DELISTED_KRX if delisted else SHARES_SOURCE_ACTIVE_KRX,
        "requiresKrxLogin": True,
        "lifecycleSource": str(row.get("source") or "").strip() or None,
    }


def build_source_manifest_rows(rows, *, active_candle_provider=ACTIVE_CANDLE_PROVIDER_YAHOO):
    return [build_source_manifest_row(row, active_candle_provider=active_candle_provider) for row in rows or []]


def summarize_source_manifest(rows):
    counts = {
        "activeYahooCandleSymbols": 0,
        "activeKrxCandleSymbols": 0,
        "delistedKrxCandleSymbols": 0,
        "activeKrxSharesSymbols": 0,
        "delistedKrxSharesSymbols": 0,
    }
    for row in rows or []:
        if row["candleSource"] == CANDLE_SOURCE_ACTIVE_YAHOO:
            counts["activeYahooCandleSymbols"] += 1
        elif row["candleSource"] == CANDLE_SOURCE_ACTIVE_KRX:
            counts["activeKrxCandleSymbols"] += 1
        elif row["candleSource"] == CANDLE_SOURCE_DELISTED_KRX:
            counts["delistedKrxCandleSymbols"] += 1
        if row["sharesSource"] == SHARES_SOURCE_ACTIVE_KRX:
            counts["activeKrxSharesSymbols"] += 1
        elif row["sharesSource"] == SHARES_SOURCE_DELISTED_KRX:
            counts["delistedKrxSharesSymbols"] += 1
    return counts
