import base64
import importlib.util
import json
import unittest
from pathlib import Path


def _load_lambda_module():
    path = Path(__file__).resolve().parents[1] / "lambda" / "validate_kinesis_event.py"
    spec = importlib.util.spec_from_file_location("retail_event_lambda", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class LambdaValidationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = _load_lambda_module()

    def test_valid_event_is_enriched_and_keeps_record_id(self):
        payload = {
            "event_id": "evt-001",
            "event_type": "purchase",
            "source_customer_id": "web-001",
            "product_id": "P001",
            "event_at": "2026-09-02T08:00:00Z",
        }
        encoded = base64.b64encode(json.dumps(payload).encode()).decode()

        result = self.module.handler(
            {"records": [{"recordId": "record-1", "data": encoded}]}, None
        )["records"][0]

        self.assertEqual(result["result"], "Ok")
        decoded = json.loads(base64.b64decode(result["data"]).decode())
        self.assertEqual(decoded["schema_version"], "retail-event/2.1")
        self.assertEqual(decoded["idempotency_key"], "evt-001")

    def test_invalid_event_is_rejected(self):
        payload = {
            "event_id": "evt-002",
            "event_type": "view",
            "product_id": "P001",
            "event_at": "2026-09-02T08:00:00Z",
        }
        encoded = base64.b64encode(json.dumps(payload).encode()).decode()

        result = self.module.handler(
            {"records": [{"recordId": "record-2", "data": encoded}]}, None
        )["records"][0]

        self.assertEqual(result["result"], "ProcessingFailed")


if __name__ == "__main__":
    unittest.main()
