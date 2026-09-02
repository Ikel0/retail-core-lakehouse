import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src.orchestration import (
    build_reference_warehouse,
    extract_sources,
    publish_kpis,
    reconcile_platform,
    stage_local_aws,
)


class OrchestrationTest(unittest.TestCase):
    def test_local_reference_path_closes_the_publishing_gate(self):
        with tempfile.TemporaryDirectory() as directory:
            project_root = Path(directory)
            extraction = extract_sources(project_root)

            with mock.patch.dict(os.environ, {"RETAIL_CORE_AWS_MODE": "disabled"}):
                cloud_stage = stage_local_aws(project_root, extraction)

            reference = build_reference_warehouse(project_root, cloud_stage)
            reconciliation = reconcile_platform(
                project_root,
                reference,
                {"status": "PASS", "tests": 78},
                cloud_stage,
            )
            manifest = publish_kpis(project_root, reconciliation)

            self.assertEqual(extraction["streams"], 8)
            self.assertEqual(cloud_stage["status"], "SKIPPED")
            self.assertEqual(reference["quality_checks"], 24)
            self.assertEqual(reconciliation["status"], "PASS")
            self.assertEqual(reconciliation["unit_delta"], 0)
            self.assertEqual(reconciliation["payment_delta"], 0.0)
            self.assertEqual(manifest["status"], "PUBLISHED")

            stored = json.loads(
                (project_root / "reports" / "publish_manifest.json").read_text()
            )
            self.assertEqual(stored["reconciliation"]["dbt_tests"], 78)


if __name__ == "__main__":
    unittest.main()
