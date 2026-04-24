#!/usr/bin/env python3

import json
from pathlib import Path
from tempfile import TemporaryDirectory


def write_jsonl(path, rows):
    with open(path, "w", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False))
            fh.write("\n")


def load_pairs(path, date_field):
    out = set()
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            row = json.loads(line)
            out.add((str(row.get("symbol") or "").strip(), str(row.get(date_field) or "").strip()))
    return out


def main():
    with TemporaryDirectory() as tmp_dir:
        root = Path(tmp_dir)
        candle_path = root / "candle_daily.jsonl"
        universe_path = root / "universe_daily.jsonl"
        nontrading_path = root / "nontrading_symbol_daily.jsonl"

        write_jsonl(
            candle_path,
            [
                {
                    "symbol": "005930",
                    "dateKey": "2026-03-23",
                    "open": 1000,
                    "high": 1100,
                    "low": 990,
                    "close": 1080,
                    "volume": 120000,
                }
            ],
        )
        write_jsonl(
            universe_path,
            [
                {
                    "symbol": "005930",
                    "tradingDateKey": "2026-03-23",
                    "avgTradingValue20d": 100,
                    "marketCapKrw": 1000,
                }
            ],
        )
        write_jsonl(
            nontrading_path,
            [
                {
                    "symbol": "005930",
                    "dateKey": "2026-03-24",
                    "status": "nontrading_status",
                    "reason": "close_only_placeholder",
                }
            ],
        )

        candle_pairs = load_pairs(candle_path, "dateKey")
        universe_pairs = load_pairs(universe_path, "tradingDateKey")
        nontrading_pairs = load_pairs(nontrading_path, "dateKey")

        overlap_candle = sorted(candle_pairs & nontrading_pairs)
        overlap_universe = sorted(universe_pairs & nontrading_pairs)
        if overlap_candle:
            raise AssertionError(f"nontrading pairs overlap candle rows: {overlap_candle!r}")
        if overlap_universe:
            raise AssertionError(f"nontrading pairs overlap universe rows: {overlap_universe!r}")

    print("ok smoke_fill_public_kr_nontrading_invariants")


if __name__ == "__main__":
    main()
