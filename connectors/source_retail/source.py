"""Minimal Airbyte protocol source backed by the retail CSV landing zone."""

from __future__ import annotations

import argparse
import csv
import json
import time
from collections.abc import Iterator
from pathlib import Path


STREAM_FILES = {
    "products": "products.csv",
    "customers": "customers.csv",
    "customer_identities": "customer_identities.csv",
    "inventory": "stock.csv",
    "orders": "orders.csv",
    "payments": "payments.csv",
    "retail_events": "stream_events.csv",
    "price_history": "price_history.csv",
}


def _read_config(path: Path | None) -> dict:
    if path is None:
        return {"data_dir": "data/raw"}
    return json.loads(path.read_text(encoding="utf-8"))


def resolve_data_dir(config: dict, project_root: Path | None = None) -> Path:
    data_dir = Path(config.get("data_dir", "data/raw"))
    if not data_dir.is_absolute():
        data_dir = (project_root or Path.cwd()) / data_dir
    return data_dir.resolve()


def check_connection(data_dir: Path) -> tuple[bool, str]:
    missing = [filename for filename in STREAM_FILES.values() if not (data_dir / filename).is_file()]
    if missing:
        return False, f"Fichiers absents : {', '.join(missing)}"
    return True, f"{len(STREAM_FILES)} flux disponibles dans {data_dir}"


def discover_catalog(data_dir: Path) -> dict:
    streams = []
    for stream_name, filename in STREAM_FILES.items():
        with (data_dir / filename).open(encoding="utf-8") as source:
            fields = next(csv.reader(source))
        streams.append(
            {
                "name": stream_name,
                "json_schema": {
                    "$schema": "http://json-schema.org/draft-07/schema#",
                    "type": "object",
                    "properties": {field: {"type": ["null", "string"]} for field in fields},
                },
                "supported_sync_modes": ["full_refresh"],
                "source_defined_cursor": False,
            }
        )
    return {"streams": streams}


def stream_records(data_dir: Path, selected_streams: set[str] | None = None) -> Iterator[dict]:
    emitted_at = int(time.time() * 1000)
    for stream_name, filename in STREAM_FILES.items():
        if selected_streams is not None and stream_name not in selected_streams:
            continue
        with (data_dir / filename).open(encoding="utf-8") as source:
            for row in csv.DictReader(source):
                yield {
                    "type": "RECORD",
                    "record": {
                        "stream": stream_name,
                        "data": row,
                        "emitted_at": emitted_at,
                    },
                }


def source_inventory(data_dir: Path) -> dict:
    """Return the same source evidence used by Airflow without emitting JSONL."""
    counts = {}
    for stream_name, filename in STREAM_FILES.items():
        with (data_dir / filename).open(encoding="utf-8") as source:
            counts[stream_name] = sum(1 for _ in csv.DictReader(source))
    return {
        "status": "PASS",
        "protocol": "airbyte-message-compatible",
        "streams": len(counts),
        "records": sum(counts.values()),
        "record_counts": counts,
    }


def _selected_streams(catalog_path: Path | None) -> set[str] | None:
    if catalog_path is None:
        return None
    payload = json.loads(catalog_path.read_text(encoding="utf-8"))
    selected = set()
    for configured in payload.get("streams", []):
        stream = configured.get("stream", configured)
        if stream.get("name"):
            selected.add(stream["name"])
    return selected


def _emit(message: dict) -> None:
    print(json.dumps(message, ensure_ascii=False, separators=(",", ":")))


def main() -> None:
    parser = argparse.ArgumentParser(description="Source Airbyte compatible Retail Core")
    parser.add_argument("command", choices=["spec", "check", "discover", "read"])
    parser.add_argument("--config", type=Path)
    parser.add_argument("--catalog", type=Path)
    args = parser.parse_args()

    if args.command == "spec":
        _emit(
            {
                "type": "SPEC",
                "spec": {
                    "documentationUrl": "https://github.com/Ikel0/retail-core-lakehouse",
                    "connectionSpecification": {
                        "$schema": "http://json-schema.org/draft-07/schema#",
                        "title": "Retail Core local source",
                        "type": "object",
                        "required": ["data_dir"],
                        "properties": {
                            "data_dir": {
                                "type": "string",
                                "title": "Répertoire des fichiers CSV bruts",
                                "default": "data/raw",
                            }
                        },
                    },
                },
            }
        )
        return

    config = _read_config(args.config)
    data_dir = resolve_data_dir(config)
    ok, message = check_connection(data_dir)
    if args.command == "check":
        _emit(
            {
                "type": "CONNECTION_STATUS",
                "connectionStatus": {
                    "status": "SUCCEEDED" if ok else "FAILED",
                    "message": message,
                },
            }
        )
        return
    if not ok:
        raise FileNotFoundError(message)
    if args.command == "discover":
        _emit({"type": "CATALOG", "catalog": discover_catalog(data_dir)})
        return

    selected_streams = _selected_streams(args.catalog)
    state = {}
    for message_payload in stream_records(data_dir, selected_streams):
        stream_name = message_payload["record"]["stream"]
        state[stream_name] = state.get(stream_name, 0) + 1
        _emit(message_payload)
    _emit({"type": "STATE", "state": {"data": {"record_counts": state}}})


if __name__ == "__main__":
    main()
