import tempfile
import unittest
from pathlib import Path

from connectors.source_retail.source import (
    check_connection,
    discover_catalog,
    source_inventory,
    stream_records,
)
from src.generate_data import generate


class AirbyteSourceTest(unittest.TestCase):
    def test_source_contract_catalog_and_records(self):
        with tempfile.TemporaryDirectory() as directory:
            raw_dir = Path(directory) / "raw"
            generate(raw_dir)

            connected, message = check_connection(raw_dir)
            self.assertTrue(connected, message)

            inventory = source_inventory(raw_dir)
            self.assertEqual(inventory["status"], "PASS")
            self.assertEqual(inventory["streams"], 8)
            self.assertEqual(inventory["records"], 5928)
            self.assertEqual(inventory["record_counts"]["orders"], 960)
            self.assertEqual(inventory["record_counts"]["customer_identities"], 640)

            catalog = discover_catalog(raw_dir)
            names = {stream["name"] for stream in catalog["streams"]}
            self.assertEqual(
                names,
                {
                    "products",
                    "customers",
                    "customer_identities",
                    "inventory",
                    "orders",
                    "payments",
                    "retail_events",
                    "price_history",
                },
            )

            payments = list(stream_records(raw_dir, {"payments"}))
            self.assertEqual(len(payments), 960)
            self.assertTrue(all(message["type"] == "RECORD" for message in payments))
            self.assertTrue(all(message["record"]["stream"] == "payments" for message in payments))


if __name__ == "__main__":
    unittest.main()
