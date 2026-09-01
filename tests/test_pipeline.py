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
            with closing(sqlite3.connect(data_dir / "warehouse.db")) as connection:
                versions = connection.execute("SELECT COUNT(*) FROM dim_product_price_scd2").fetchone()[0]
                self.assertEqual(versions, 24)
                negative_atp = connection.execute("SELECT COUNT(*) FROM fact_inventory WHERE atp < 0").fetchone()[0]
                self.assertEqual(negative_atp, 0)

if __name__ == "__main__": unittest.main()
