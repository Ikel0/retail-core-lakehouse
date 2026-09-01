import math
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest import mock

import serve
from src.generate_data import generate
from src.pipeline import run


class DashboardConsistencyTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.project_dir = Path(self.temp_dir.name)
        self.data_dir = self.project_dir / "data"
        generate(self.data_dir / "raw")
        run(self.data_dir)
        self.db_path = self.data_dir / "warehouse.db"
        self.quality_path = self.project_dir / "reports" / "quality_report.json"
        self.db_patch = mock.patch.object(serve, "DB_PATH", self.db_path)
        self.quality_patch = mock.patch.object(serve, "QUALITY_PATH", self.quality_path)
        self.db_patch.start()
        self.quality_patch.start()

    def tearDown(self):
        self.quality_patch.stop()
        self.db_patch.stop()
        self.temp_dir.cleanup()

    def test_dashboard_totals_reconcile_with_series_and_mix(self):
        dashboard = serve.build_dashboard("all", 30)
        kpis = dashboard["kpis"]

        self.assertAlmostEqual(sum(row["revenue"] for row in dashboard["series"]), kpis["revenue"], places=2)
        self.assertEqual(sum(row["orders"] for row in dashboard["series"]), kpis["orders"])
        self.assertEqual(sum(row["units"] for row in dashboard["series"]), kpis["units"])
        self.assertAlmostEqual(sum(row["revenue"] for row in dashboard["channel_mix"]), kpis["revenue"], places=2)
        self.assertEqual(dashboard["reconciliation"]["batch_units"], kpis["units"])
        self.assertEqual(dashboard["reconciliation"]["stream_units"], kpis["units"])
        self.assertEqual(dashboard["reconciliation"]["delta"], 0)

        with closing(sqlite3.connect(self.db_path)) as connection:
            latencies = [
                row[0]
                for row in connection.execute(
                    "SELECT latency_ms FROM fact_retail_event WHERE event_at >= ?",
                    [dashboard["meta"]["cutoff"]],
                )
            ]
        expected_p95 = sorted(latencies)[math.ceil(0.95 * len(latencies)) - 1]
        self.assertEqual(kpis["latency_p95_ms"], expected_p95)

    def test_filters_apply_to_sales_events_mix_and_reconciliation(self):
        web_week = serve.build_dashboard("web", 7)
        all_month = serve.build_dashboard("all", 30)

        self.assertTrue(web_week["channel_mix"])
        self.assertEqual({row["channel"] for row in web_week["channel_mix"]}, {"web"})
        self.assertLessEqual(web_week["kpis"]["orders"], all_month["kpis"]["orders"])
        self.assertLessEqual(web_week["event_metrics"]["events"], all_month["event_metrics"]["events"])
        self.assertEqual(web_week["reconciliation"]["delta"], 0)

        with closing(sqlite3.connect(self.db_path)) as connection:
            expected_events = connection.execute(
                "SELECT COUNT(*) FROM fact_retail_event WHERE event_at >= ? AND channel = 'web'",
                [web_week["meta"]["cutoff"]],
            ).fetchone()[0]
        self.assertEqual(web_week["event_metrics"]["events"], expected_events)

    def test_inventory_scd_and_cost_model_are_internally_consistent(self):
        dashboard = serve.build_dashboard("all", 30)

        for item in dashboard["inventory"]:
            expected_atp = (
                item["store_stock"]
                + item["warehouse_stock"]
                + item["incoming"]
                - item["reserved"]
                - item["units_sold"]
            )
            self.assertEqual(item["atp"], expected_atp)
            expected_risk = "critical" if expected_atp < item["safety_stock"] else "watch" if expected_atp < item["safety_stock"] * 2 else "healthy"
            self.assertEqual(item["risk_level"], expected_risk)

        self.assertEqual(len(dashboard["price_scd"]), 24)
        with closing(sqlite3.connect(self.db_path)) as connection:
            invalid_products = connection.execute(
                """
                SELECT COUNT(*) FROM (
                  SELECT product_id, COUNT(*) versions, SUM(is_current) current_versions
                  FROM dim_product_price_scd2 GROUP BY product_id
                  HAVING versions != 2 OR current_versions != 1
                )
                """
            ).fetchone()[0]
        self.assertEqual(invalid_products, 0)

        costs = dashboard["costs"]
        self.assertAlmostEqual(sum(item["amount"] for item in costs["components"]), costs["monthly_total"], places=2)
        self.assertAlmostEqual(sum(item["share"] for item in costs["components"]), 100.0, delta=0.2)
        expected_unit_cost = costs["monthly_total"] / (costs["monthly_event_volume"] / 1000)
        self.assertAlmostEqual(costs["cost_per_1k_events"], expected_unit_cost, places=2)

    def test_capacity_model_is_explicit_and_bounded(self):
        scenario = serve.simulate_black_friday(5)
        self.assertEqual(scenario["simulated_rps"], 210)
        self.assertGreater(scenario["shards_after"], scenario["shards_before"])
        self.assertEqual(scenario["assumptions"]["model"], "deterministic_capacity_estimate")
        self.assertIn("Aucun trafic cloud réel", scenario["message"])
        self.assertEqual(serve.simulate_black_friday(99)["multiplier"], 12)


if __name__ == "__main__":
    unittest.main()
