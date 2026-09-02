import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from src.generate_data import generate
from src.pipeline import run

class PipelineTest(unittest.TestCase):
    def test_demo_pipeline(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            data_dir = root / "data"
            generate(data_dir / "raw")
            result = run(data_dir)
            self.assertEqual(result["quality"]["status"],"PASS")
            self.assertEqual(result["reconciliation"]["status"],"PASS")
            self.assertGreater(result["kpis"]["sales_amount"],0)
            self.assertTrue((data_dir / "warehouse.db").exists())
            self.assertEqual(result["quality"]["score"], 100.0)
            self.assertEqual(result["quality"]["total"], 24)
            self.assertEqual(result["reconciliation"]["delta"], 0)
            self.assertEqual(result["reconciliation"]["amount_delta"], 0.0)
            with closing(sqlite3.connect(data_dir / "warehouse.db")) as connection:
                versions = connection.execute("SELECT COUNT(*) FROM dim_product_price_scd2").fetchone()[0]
                self.assertEqual(versions, 24)
                identity_links = connection.execute("SELECT COUNT(*) FROM bridge_customer_identity").fetchone()[0]
                self.assertEqual(identity_links, 640)
                payments = connection.execute("SELECT COUNT(*) FROM fact_payment").fetchone()[0]
                self.assertEqual(payments, 960)
                negative_atp = connection.execute("SELECT COUNT(*) FROM fact_inventory WHERE atp < 0").fetchone()[0]
                self.assertEqual(negative_atp, 0)

if __name__ == "__main__": unittest.main()
