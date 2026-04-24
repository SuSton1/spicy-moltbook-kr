#!/usr/bin/env python3

from datetime import datetime, timezone
from pathlib import Path

from kiwoom_rest_client import normalize_date_key
from public_kr_historical_common import iter_jsonl, sort_rows, stable_symbol_shard


SIDE_DAILY_STAGE_KIND = "kiwoom_side_daily_stage_v1"
SIDE_DAILY_STAGE_QC_KIND = "kiwoom_side_daily_stage_qc_v1"
SIDE_DAILY_STAGE_MERGE_KIND = "kiwoom_side_daily_stage_merge_journal_v1"
SIDE_DAILY_STAGE_ROWSET_KIND = "rows"
SIDE_DAILY_SOURCE = "KIWOOM"

SIDE_DAILY_DATASET_SPECS = {
    "investor_daily": {
        "apiId": "ka10060",
        "fetchMethod": "fetch_investor_daily",
        "rowDateField": "dt",
        "anchorDateArg": "date_key",
        "canonicalRelPath": "intraday_side/investor_daily.jsonl",
    },
    "program_daily": {
        "apiId": "ka90013",
        "fetchMethod": "fetch_program_daily",
        "rowDateField": "dt",
        "anchorDateArg": "date_key",
        "canonicalRelPath": "intraday_side/program_daily.jsonl",
    },
    "trade_strength_daily": {
        "apiId": "ka10047",
        "fetchMethod": "fetch_trade_strength_daily",
        "rowDateField": "dt",
        "anchorDateArg": None,
        "canonicalRelPath": "intraday_side/trade_strength_daily.jsonl",
    },
}


def supported_side_daily_datasets():
    return sorted(SIDE_DAILY_DATASET_SPECS.keys())


def resolve_side_daily_dataset_spec(dataset):
    key = str(dataset or "").strip()
    spec = SIDE_DAILY_DATASET_SPECS.get(key)
    if spec:
        return dict(spec)
    supported = ", ".join(supported_side_daily_datasets())
    raise SystemExit(f"unsupported side-daily dataset={dataset!r}. supported={supported}")


def to_dash_date_key(raw):
    compact = normalize_date_key(raw)
    if not compact:
        raise ValueError(f"missing or invalid date key: {raw!r}")
    return f"{compact[:4]}-{compact[4:6]}-{compact[6:8]}"


def canonical_side_daily_path(data_dir, dataset):
    spec = resolve_side_daily_dataset_spec(dataset)
    return Path(data_dir) / spec["canonicalRelPath"]


def stage_row_key(row):
    return (
        str((row or {}).get("symbol") or "").strip(),
        str((row or {}).get("dateKey") or "").strip(),
    )


def sort_side_daily_rows(rows):
    return sort_rows(rows, "dateKey")


def normalize_stage_row(dataset, symbol, raw_row):
    spec = resolve_side_daily_dataset_spec(dataset)
    payload = dict(raw_row or {})
    date_key = to_dash_date_key(payload.get(spec["rowDateField"]))
    normalized_symbol = str(symbol or "").strip()
    if not normalized_symbol:
        raise ValueError("missing symbol for side-daily row")
    return {
        "dataset": str(dataset).strip(),
        "apiId": spec["apiId"],
        "source": SIDE_DAILY_SOURCE,
        "symbol": normalized_symbol,
        "dateKey": date_key,
        "rawRow": payload,
    }


def fetch_side_daily_page(
    client,
    *,
    dataset,
    symbol,
    anchor_date_key="",
    cont_yn=None,
    next_key=None,
    trace_step="",
):
    spec = resolve_side_daily_dataset_spec(dataset)
    kwargs = {
        "symbol": str(symbol or "").strip(),
        "cont_yn": cont_yn,
        "next_key": next_key,
        "trace_step": str(trace_step or spec["apiId"]).strip() or spec["apiId"],
    }
    anchor_arg = spec.get("anchorDateArg")
    if anchor_arg:
        kwargs[anchor_arg] = str(anchor_date_key or "").strip()
    method = getattr(client, spec["fetchMethod"], None)
    if method is None:
        raise RuntimeError(f"client missing fetch method for dataset={dataset}: {spec['fetchMethod']}")
    return method(**kwargs)


def build_side_daily_request_index(
    manifest_path,
    *,
    decision_from=None,
    decision_to=None,
    shard_index=None,
    shard_count=None,
):
    input_path = Path(manifest_path)
    if not input_path.exists():
        raise SystemExit(f"missing manifest path: {input_path}")
    normalized_from = to_dash_date_key(decision_from) if str(decision_from or "").strip() else None
    normalized_to = to_dash_date_key(decision_to) if str(decision_to or "").strip() else None
    by_symbol = {}
    manifest_row_count = 0
    filtered_manifest_row_count = 0
    requested_date_keys = set()
    for row in iter_jsonl(input_path):
        manifest_row_count += 1
        symbol = str(row.get("symbol") or "").strip()
        if not symbol or not symbol.isdigit() or len(symbol) != 6:
            raise ValueError(f"invalid manifest symbol: {symbol or '<empty>'}")
        decision_date_key = to_dash_date_key(row.get("decisionDateKey"))
        if normalized_from and decision_date_key < normalized_from:
            continue
        if normalized_to and decision_date_key > normalized_to:
            continue
        if shard_count is not None and shard_index is not None:
            if stable_symbol_shard(symbol, shard_count) != int(shard_index):
                continue
        window_date_keys = sorted({to_dash_date_key(value) for value in list(row.get("windowDateKeys") or [])})
        if not window_date_keys:
            raise ValueError(f"manifest row missing windowDateKeys for symbol={symbol} decision={decision_date_key}")
        filtered_manifest_row_count += 1
        entry = by_symbol.setdefault(
            symbol,
            {
                "requestedDateKeys": set(),
                "decisionDateKeys": set(),
                "requestIds": [],
            },
        )
        entry["requestedDateKeys"].update(window_date_keys)
        entry["decisionDateKeys"].add(decision_date_key)
        request_id = str(row.get("requestId") or "").strip()
        if request_id:
            entry["requestIds"].append(request_id)
        requested_date_keys.update(window_date_keys)
    finalized = {}
    requested_pairs = set()
    for symbol, meta in sorted(by_symbol.items()):
        sorted_dates = sorted(meta["requestedDateKeys"])
        finalized[symbol] = {
            "requestedDateKeys": sorted_dates,
            "oldestRequestedDateKey": sorted_dates[0],
            "latestRequestedDateKey": sorted_dates[-1],
            "decisionDateKeys": sorted(meta["decisionDateKeys"]),
            "requestIdCount": len(meta["requestIds"]),
            "decisionCount": len(meta["decisionDateKeys"]),
        }
        for date_key in sorted_dates:
            requested_pairs.add((symbol, date_key))
    return {
        "manifestPath": str(input_path.resolve()),
        "manifestRowCount": manifest_row_count,
        "filteredManifestRowCount": filtered_manifest_row_count,
        "symbolCount": len(finalized),
        "requestedPairCount": len(requested_pairs),
        "requestedDateFrom": min(requested_date_keys) if requested_date_keys else None,
        "requestedDateTo": max(requested_date_keys) if requested_date_keys else None,
        "bySymbol": finalized,
        "requestedPairs": requested_pairs,
    }


def normalize_raw_row_date_for_dataset(dataset, raw_row):
    spec = resolve_side_daily_dataset_spec(dataset)
    return to_dash_date_key(dict(raw_row or {}).get(spec["rowDateField"]))


def normalize_iso_now():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()
