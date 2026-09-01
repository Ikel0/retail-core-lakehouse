"""Local API and static server for the interactive Retail Core cockpit."""

import argparse
import json
import math
import mimetypes
import sqlite3
from contextlib import closing
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


ROOT = Path(__file__).parent
DB_PATH = ROOT / "data" / "warehouse.db"
QUALITY_PATH = ROOT / "reports" / "quality_report.json"
DASHBOARD_DIR = ROOT / "dashboard"


def _connect() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def _rows(cursor) -> list[dict]:
    return [dict(row) for row in cursor.fetchall()]


def _segment(spend: float, order_count: int) -> str:
    if spend >= 1200 or order_count >= 14:
        return "Champions"
    if spend >= 650 or order_count >= 8:
        return "Fidèles"
    if spend >= 300:
        return "Prometteurs"
    return "Nouveaux"


def _percentile(values: list[int], percentile: float) -> int:
    if not values:
        return 0
    ordered = sorted(values)
    index = max(0, math.ceil(percentile * len(ordered)) - 1)
    return ordered[min(index, len(ordered) - 1)]


def _cost_scenario() -> dict:
    """Return an internally consistent, explicitly hypothetical FinOps model."""
    event_volume = 3_200_000
    budget = 650.0
    forecast = 512.4
    baseline = 536.0
    components = [
        {"name": "Snowflake compute", "amount": 228.40},
        {"name": "Kinesis", "amount": 92.20},
        {"name": "MWAA / Airflow", "amount": 78.10},
        {"name": "S3 + Lambda", "amount": 88.00},
    ]
    monthly_total = round(sum(item["amount"] for item in components), 2)
    for component in components:
        component["share"] = round(component["amount"] / monthly_total * 100, 1)
    return {
        "kind": "scenario",
        "monthly_event_volume": event_volume,
        "monthly_total": monthly_total,
        "budget": budget,
        "forecast": forecast,
        "baseline_without_optimizations": baseline,
        "savings_percent": round((baseline - monthly_total) / baseline * 100, 1),
        "forecast_under_budget_percent": round((budget - forecast) / budget * 100, 1),
        "cost_per_1k_events": round(monthly_total / (event_volume / 1000), 2),
        "components": components,
        "assumptions": [
            "3,2 millions d’événements par mois",
            "services managés dans une architecture cible",
            "ordre de grandeur pédagogique, pas une facture fournisseur",
        ],
    }


def build_dashboard(channel: str = "all", period: int = 30) -> dict:
    if channel not in {"all", "web", "store", "marketplace"}:
        channel = "all"
    period = max(7, min(period, 30))
    cutoff = (datetime.now(timezone.utc) - timedelta(days=period)).isoformat()
    sales_conditions = ["s.ordered_at >= ?"]
    sales_params: list = [cutoff]
    event_conditions = ["e.event_at >= ?"]
    event_params: list = [cutoff]
    if channel != "all":
        sales_conditions.append("s.channel = ?")
        sales_params.append(channel)
        event_conditions.append("e.channel = ?")
        event_params.append(channel)
    sales_where = "WHERE " + " AND ".join(sales_conditions)
    event_where = "WHERE " + " AND ".join(event_conditions)

    with closing(_connect()) as connection:
        kpi = dict(
            connection.execute(
                f"""
                SELECT ROUND(SUM(sales_amount), 2) revenue, COUNT(*) orders,
                       COUNT(DISTINCT customer_id) customers, SUM(quantity) units,
                       ROUND(AVG(sales_amount), 2) avg_basket
                FROM fact_sales s {sales_where}
                """,
                sales_params,
            ).fetchone()
        )
        for key in ("revenue", "orders", "customers", "units", "avg_basket"):
            kpi[key] = kpi[key] or 0
        series = _rows(
            connection.execute(
                f"""
                SELECT SUBSTR(ordered_at, 1, 10) day, ROUND(SUM(sales_amount), 2) revenue,
                       COUNT(*) orders, SUM(quantity) units
                FROM fact_sales s {sales_where}
                GROUP BY SUBSTR(ordered_at, 1, 10) ORDER BY day
                """,
                sales_params,
            )
        )
        channel_mix = _rows(
            connection.execute(
                f"""
                SELECT channel, ROUND(SUM(sales_amount), 2) revenue, COUNT(*) orders
                FROM fact_sales s {sales_where}
                GROUP BY channel ORDER BY revenue DESC
                """,
                sales_params,
            )
        )
        categories = _rows(
            connection.execute(
                f"""
                SELECT p.category, ROUND(SUM(s.sales_amount), 2) revenue, SUM(s.quantity) units
                FROM fact_sales s JOIN dim_product p USING(product_id)
                {sales_where}
                GROUP BY p.category ORDER BY revenue DESC LIMIT 7
                """,
                sales_params,
            )
        )
        inventory = _rows(
            connection.execute(
                """
                SELECT i.product_id, p.name, p.category, i.store_stock, i.warehouse_stock,
                       i.reserved, i.incoming, i.safety_stock, i.units_sold, i.atp, i.risk_level
                FROM fact_inventory i JOIN dim_product p USING(product_id)
                ORDER BY CASE risk_level WHEN 'critical' THEN 0 WHEN 'watch' THEN 1 ELSE 2 END,
                         atp ASC
                """
            )
        )
        customer_rows = _rows(
            connection.execute(
                f"""
                SELECT c.customer_id, c.country, c.acquisition_channel, c.consent_marketing,
                       ROUND(SUM(s.sales_amount), 2) spend, COUNT(*) order_count,
                       MAX(s.ordered_at) last_order,
                       GROUP_CONCAT(DISTINCT s.channel) channels
                FROM fact_sales s JOIN dim_customer c USING(customer_id)
                {sales_where}
                GROUP BY c.customer_id ORDER BY spend DESC LIMIT 20
                """,
                sales_params,
            )
        )
        for customer in customer_rows:
            customer["segment"] = _segment(customer["spend"], customer["order_count"])

        live_events = _rows(
            connection.execute(
                f"""
                SELECT e.event_id, e.event_type, e.channel, e.event_at, e.latency_ms,
                       p.name product_name
                FROM fact_retail_event e JOIN dim_product p USING(product_id)
                {event_where}
                ORDER BY event_at DESC LIMIT 12
                """,
                event_params,
            )
        )
        event_metrics = dict(
            connection.execute(
                f"""
                SELECT COUNT(*) events, ROUND(AVG(latency_ms), 0) avg_latency_ms,
                       MAX(latency_ms) max_latency_ms,
                       SUM(CASE WHEN event_type='purchase' THEN 1 ELSE 0 END) purchase_events,
                       SUM(CASE WHEN event_type='add_to_cart' THEN 1 ELSE 0 END) cart_events
                FROM fact_retail_event e {event_where}
                """,
                event_params,
            ).fetchone()
        )
        for key in ("events", "avg_latency_ms", "max_latency_ms", "purchase_events", "cart_events"):
            event_metrics[key] = event_metrics[key] or 0
        latency_values = [
            row[0]
            for row in connection.execute(
                f"SELECT latency_ms FROM fact_retail_event e {event_where}", event_params
            ).fetchall()
        ]
        price_scd = _rows(
            connection.execute(
                """
                SELECT p.name, h.price, h.valid_from, h.valid_to, h.is_current
                FROM dim_product_price_scd2 h JOIN dim_product p USING(product_id)
                ORDER BY p.name, h.valid_from DESC
                """
            )
        )
        reconciliation = dict(
            connection.execute(
                f"""
                SELECT COALESCE(SUM(s.quantity), 0) batch_units,
                       COALESCE(SUM(e.quantity), 0) stream_units
                FROM fact_sales s
                LEFT JOIN fact_retail_event e
                  ON e.order_id = s.order_id AND e.event_type = 'purchase'
                {sales_where}
                """,
                sales_params,
            ).fetchone()
        )

    quality = json.loads(QUALITY_PATH.read_text(encoding="utf-8"))
    reconciliation["delta"] = reconciliation["batch_units"] - reconciliation["stream_units"]
    reconciliation["status"] = "PASS" if reconciliation["delta"] == 0 else "FAIL"
    total_atp = sum(item["atp"] for item in inventory)
    latency_p95 = _percentile(latency_values, 0.95)
    kpi.update(
        {
            "total_atp": total_atp,
            "quality_score": quality["quality"]["score"],
            "latency_p95_ms": latency_p95,
            "event_count": event_metrics["events"],
        }
    )
    checks = [
        {"name": name, "status": "PASS" if passed else "FAIL", "domain": name.split(".")[0]}
        for name, passed in quality["quality"]["checks"].items()
    ]
    return {
        "meta": {
            "environment": "DEMO LOCALE",
            "generated_at": quality["kpis"]["generated_at"],
            "channel": channel,
            "period": period,
            "data_contract": "retail-core/v2.1",
            "dataset": "synthetic",
            "scope": f"{period} jours · {channel}",
            "cutoff": cutoff,
        },
        "kpis": kpi,
        "series": series,
        "channel_mix": channel_mix,
        "categories": categories,
        "inventory": inventory,
        "customers": customer_rows,
        "live_events": live_events,
        "event_metrics": event_metrics,
        "quality": {**quality["quality"], "checks": checks},
        "reconciliation": reconciliation,
        "price_scd": price_scd,
        "pipeline_run": quality.get("run", {"status": "UNKNOWN", "duration_ms": 0, "phases": [], "row_counts": {}}),
        "pipeline": [
            {"name": "Airbyte", "role": "Ingestion SaaS / ERP / CRM", "status": "target", "metric": "BATCH"},
            {"name": "Amazon S3", "role": "Zone Raw partitionnée", "status": "target", "metric": "STOCKAGE"},
            {"name": "AWS Lambda", "role": "Validation événementielle", "status": "target", "metric": "SERVERLESS"},
            {"name": "Kinesis", "role": "Flux d’événements retail", "status": "target", "metric": "STREAM"},
            {"name": "dbt Core", "role": "Modèle cœur et tests", "status": "target", "metric": "SQL"},
            {"name": "Snowflake", "role": "Single Source of Truth", "status": "target", "metric": "WAREHOUSE"},
            {"name": "Airflow", "role": "Orchestration et reprises", "status": "target", "metric": "DAG"},
        ],
        "costs": _cost_scenario(),
        "capacity_preview": simulate_black_friday(5),
    }


def simulate_black_friday(multiplier: float) -> dict:
    multiplier = max(1.0, min(multiplier, 12.0))
    baseline_rps = 42
    simulated_rps = round(baseline_rps * multiplier)
    safe_events_per_shard = 150
    headroom_ratio = 1.25
    shards_before = max(1, math.ceil(baseline_rps * headroom_ratio / safe_events_per_shard))
    shards_after = max(
        shards_before,
        math.ceil(simulated_rps * headroom_ratio / safe_events_per_shard),
    )
    p95_latency_ms = round(620 + multiplier * 85)
    return {
        "status": "PASS" if p95_latency_ms < 3000 else "WATCH",
        "multiplier": multiplier,
        "baseline_rps": baseline_rps,
        "simulated_rps": simulated_rps,
        "shards_before": shards_before,
        "shards_after": shards_after,
        "p95_latency_ms": p95_latency_ms,
        "error_rate": 0.0,
        "reconciliation_delta": 0,
        "estimated_cost_delta": round((multiplier - 1) * 18.40, 2),
        "message": "Estimation de capacité : le modèle conserve 25 % de marge, une latence p95 sous 3 s et l’invariant de réconciliation à zéro. Aucun trafic cloud réel n’est généré.",
        "assumptions": {
            "safe_events_per_shard": safe_events_per_shard,
            "headroom_ratio": headroom_ratio,
            "model": "deterministic_capacity_estimate",
        },
    }


class RetailHandler(BaseHTTPRequestHandler):
    def _json(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _download_json(self, payload: dict, filename: str) -> None:
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        if parsed.path == "/api/health":
            return self._json({"status": "healthy", "warehouse": DB_PATH.exists()})
        if parsed.path == "/api/dashboard":
            try:
                period = int(query.get("period", ["30"])[0])
                return self._json(build_dashboard(query.get("channel", ["all"])[0], period))
            except Exception as error:
                return self._json({"status": "error", "message": str(error)}, 500)
        if parsed.path == "/api/quality-report":
            return self._download_json(
                json.loads(QUALITY_PATH.read_text(encoding="utf-8")),
                "retail-core-quality-report.json",
            )
        if parsed.path == "/api/simulate":
            try:
                multiplier = float(query.get("multiplier", ["5"])[0])
                return self._json(simulate_black_friday(multiplier))
            except ValueError:
                return self._json({"status": "error", "message": "Invalid multiplier"}, 400)

        relative = "index.html" if parsed.path in {"", "/"} else parsed.path.lstrip("/")
        file_path = (DASHBOARD_DIR / relative).resolve()
        if DASHBOARD_DIR.resolve() not in file_path.parents and file_path != DASHBOARD_DIR.resolve():
            self.send_error(403)
            return
        if not file_path.exists() or not file_path.is_file():
            file_path = DASHBOARD_DIR / "index.html"
        content = file_path.read_bytes()
        content_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", f"{content_type}; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def log_message(self, format: str, *args) -> None:
        return


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve the Retail Core cockpit")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8042, type=int)
    args = parser.parse_args()
    if not DB_PATH.exists():
        raise SystemExit("Warehouse missing. Run `python3 run_demo.py` first.")
    server = ThreadingHTTPServer((args.host, args.port), RetailHandler)
    print(f"Retail Core cockpit: http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
