"""Local lakehouse pipeline mirroring a production-grade retail architecture."""

import csv
import json
import math
import sqlite3
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter

from .quality import run_checks


def read_csv(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as stream:
        return list(csv.DictReader(stream))


def _percentile(values: list[int], percentile: float) -> int:
    if not values:
        return 0
    ordered = sorted(values)
    index = max(0, math.ceil(percentile * len(ordered)) - 1)
    return ordered[min(len(ordered) - 1, index)]


def run(data_dir: Path) -> dict:
    pipeline_started = perf_counter()
    phases: list[dict] = []
    raw = data_dir / "raw"
    curated = data_dir / "curated"
    reports = data_dir.parent / "reports"
    curated.mkdir(exist_ok=True)
    reports.mkdir(exist_ok=True)

    phase_started = perf_counter()
    products = read_csv(raw / "products.csv")
    customers = read_csv(raw / "customers.csv")
    stock = read_csv(raw / "stock.csv")
    orders = read_csv(raw / "orders.csv")
    events = read_csv(raw / "stream_events.csv")
    price_history = read_csv(raw / "price_history.csv")
    phases.append(
        {
            "name": "extract_sources",
            "label": "Lecture des 6 sources CSV",
            "duration_ms": round((perf_counter() - phase_started) * 1000, 1),
            "status": "PASS",
        }
    )

    phase_started = perf_counter()
    quality = run_checks(
        {
            "orders": orders,
            "events": events,
            "customers": customers,
            "product_ids": {product["product_id"] for product in products},
            "customer_ids": {customer["customer_id"] for customer in customers},
            "price_history": price_history,
        }
    )
    if quality["status"] != "PASS":
        raise ValueError(f"Publishing gate failed: {quality['failed']} quality checks")
    phases.append(
        {
            "name": "validate_contracts",
            "label": f"{quality['passed']}/{quality['total']} contrats validés",
            "duration_ms": round((perf_counter() - phase_started) * 1000, 1),
            "status": quality["status"],
        }
    )

    phase_started = perf_counter()
    db_path = data_dir / "warehouse.db"
    connection = sqlite3.connect(db_path)
    cursor = connection.cursor()
    cursor.executescript(
        """
        DROP TABLE IF EXISTS fact_sales;
        DROP TABLE IF EXISTS dim_product;
        DROP TABLE IF EXISTS dim_customer;
        DROP TABLE IF EXISTS dim_product_price_scd2;
        DROP TABLE IF EXISTS fact_inventory;
        DROP TABLE IF EXISTS fact_web_event;
        DROP TABLE IF EXISTS fact_retail_event;
        CREATE TABLE dim_product(
          product_id TEXT PRIMARY KEY, name TEXT, category TEXT,
          department TEXT, collection_name TEXT, current_price REAL
        );
        CREATE TABLE dim_customer(
          customer_id TEXT PRIMARY KEY, email_hash TEXT, loyalty_id TEXT,
          country TEXT, acquisition_channel TEXT, consent_marketing INTEGER
        );
        CREATE TABLE dim_product_price_scd2(
          product_id TEXT, price REAL, valid_from TEXT, valid_to TEXT,
          is_current INTEGER, PRIMARY KEY(product_id, valid_from)
        );
        CREATE TABLE fact_sales(
          order_id TEXT PRIMARY KEY, customer_id TEXT, product_id TEXT,
          channel TEXT, store_id TEXT, quantity INTEGER, unit_price REAL,
          discount_rate REAL, sales_amount REAL, ordered_at TEXT
        );
        CREATE TABLE fact_inventory(
          product_id TEXT PRIMARY KEY, store_stock INTEGER, warehouse_stock INTEGER,
          reserved INTEGER, incoming INTEGER, safety_stock INTEGER,
          units_sold INTEGER, atp INTEGER, risk_level TEXT
        );
        CREATE TABLE fact_retail_event(
          event_id TEXT PRIMARY KEY, event_type TEXT, order_id TEXT,
          customer_id TEXT, product_id TEXT, channel TEXT, quantity INTEGER,
          event_at TEXT, latency_ms INTEGER, partition_key TEXT
        );
        """
    )
    cursor.executemany(
        "INSERT INTO dim_product VALUES(?,?,?,?,?,?)",
        [
            (
                row["product_id"], row["name"], row["category"], row["department"],
                row["collection"], float(row["price"]),
            )
            for row in products
        ],
    )
    cursor.executemany(
        "INSERT INTO dim_customer VALUES(?,?,?,?,?,?)",
        [
            (
                row["customer_id"], row["email_hash"], row["loyalty_id"], row["country"],
                row["acquisition_channel"], row["consent_marketing"] == "true",
            )
            for row in customers
        ],
    )
    cursor.executemany(
        "INSERT INTO dim_product_price_scd2 VALUES(?,?,?,?,?)",
        [
            (
                row["product_id"], float(row["price"]), row["valid_from"], row["valid_to"],
                row["is_current"] == "true",
            )
            for row in price_history
        ],
    )
    cursor.executemany(
        "INSERT INTO fact_sales VALUES(?,?,?,?,?,?,?,?,?,?)",
        [
            (
                row["order_id"], row["customer_id"], row["product_id"], row["channel"],
                row["store_id"], int(row["quantity"]), float(row["unit_price"]),
                float(row["discount_rate"]), int(row["quantity"]) * float(row["unit_price"]),
                row["ordered_at"],
            )
            for row in orders
        ],
    )
    cursor.executemany(
        "INSERT INTO fact_retail_event VALUES(?,?,?,?,?,?,?,?,?,?)",
        [
            (
                row["event_id"], row["event_type"], row["order_id"], row["customer_id"],
                row["product_id"], row["channel"], int(row["quantity"]), row["event_at"],
                int(row["latency_ms"]), row["partition_key"],
            )
            for row in events
        ],
    )

    units_sold: dict[str, int] = defaultdict(int)
    for order in orders:
        units_sold[order["product_id"]] += int(order["quantity"])
    inventory_rows = []
    for row in stock:
        sold = units_sold[row["product_id"]]
        atp = (
            int(row["store_stock"]) + int(row["warehouse_stock"]) + int(row["incoming"])
            - int(row["reserved"]) - sold
        )
        safety = int(row["safety_stock"])
        risk = "critical" if atp < safety else "watch" if atp < safety * 2 else "healthy"
        inventory_rows.append(
            (
                row["product_id"], int(row["store_stock"]), int(row["warehouse_stock"]),
                int(row["reserved"]), int(row["incoming"]), safety, sold, atp, risk,
            )
        )
    cursor.executemany("INSERT INTO fact_inventory VALUES(?,?,?,?,?,?,?,?,?)", inventory_rows)
    connection.commit()
    phases.append(
        {
            "name": "build_core_model",
            "label": "6 tables dimensionnelles et de faits",
            "duration_ms": round((perf_counter() - phase_started) * 1000, 1),
            "status": "PASS",
        }
    )

    phase_started = perf_counter()
    batch_units = sum(int(order["quantity"]) for order in orders)
    purchase_events = [event for event in events if event["event_type"] == "purchase"]
    stream_units = sum(int(event["quantity"]) for event in purchase_events)
    reconciliation = {
        "batch_units": batch_units,
        "stream_units": stream_units,
        "delta": batch_units - stream_units,
        "status": "PASS" if batch_units == stream_units else "FAIL",
    }
    phases.append(
        {
            "name": "reconcile_stream",
            "label": f"Écart batch/stream : {reconciliation['delta']}",
            "duration_ms": round((perf_counter() - phase_started) * 1000, 1),
            "status": reconciliation["status"],
        }
    )
    sales_amount = sum(int(order["quantity"]) * float(order["unit_price"]) for order in orders)
    latencies = [int(event["latency_ms"]) for event in events]
    kpis = {
        "sales_amount": round(sales_amount, 2),
        "orders": len(orders),
        "customers": len({order["customer_id"] for order in orders}),
        "products": len(products),
        "events": len(events),
        "total_atp": sum(row[7] for row in inventory_rows),
        "latency_p95_ms": _percentile(latencies, 0.95),
        "quality_score": quality["score"],
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    run_metrics = {
        "status": "PASS",
        "duration_ms": 0,
        "phases": phases,
        "row_counts": {
            "products": len(products),
            "customers": len(customers),
            "orders": len(orders),
            "events": len(events),
            "price_versions": len(price_history),
        },
    }
    report = {
        "quality": quality,
        "reconciliation": reconciliation,
        "kpis": kpis,
        "run": run_metrics,
    }
    phase_started = perf_counter()
    (curated / "retail_kpis.json").write_text(json.dumps(kpis, indent=2), encoding="utf-8")
    (reports / "quality_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    phases.append(
        {
            "name": "publish_report",
            "label": "KPI et rapport de qualité publiés",
            "duration_ms": round((perf_counter() - phase_started) * 1000, 1),
            "status": "PASS",
        }
    )
    run_metrics["duration_ms"] = round((perf_counter() - pipeline_started) * 1000, 1)
    (reports / "quality_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    connection.close()
    return {
        "sales_count": len(orders),
        "event_count": len(events),
        "quality": quality,
        "reconciliation": reconciliation,
        "kpis": kpis,
        "run": run_metrics,
    }
