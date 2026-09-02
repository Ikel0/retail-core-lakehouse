import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class PlatformContractTest(unittest.TestCase):
    def test_airflow_dag_calls_every_real_stage(self):
        source = (ROOT / "dags" / "retail_core_daily.py").read_text(encoding="utf-8")
        self.assertIn('schedule="15 5 * * *"', source)
        self.assertIn('tz="Europe/Paris"', source)
        self.assertIn('default_args={"retries": 2', source)
        for stage in (
            "extract_sources",
            "stage_local_aws",
            "build_reference_warehouse",
            "build_dbt_marts",
            "reconcile_platform",
            "publish_kpis",
        ):
            self.assertIn(stage, source)

    def test_docker_and_terraform_cover_the_target_platform(self):
        compose = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")
        airflow_image = (ROOT / "docker" / "airflow.Dockerfile").read_text(
            encoding="utf-8"
        )
        terraform = (ROOT / "infra" / "terraform" / "main.tf").read_text(
            encoding="utf-8"
        )

        self.assertIn("localstack/localstack:4.14.0", compose)
        self.assertIn("RETAIL_CORE_AWS_MODE: localstack", compose)
        self.assertIn("./reports:/app/reports", compose)
        self.assertIn("apache/airflow:3.3.1-python3.12", airflow_image)
        for resource in (
            'resource "aws_s3_bucket"',
            'resource "aws_kinesis_stream"',
            'resource "aws_lambda_function"',
            'resource "aws_cloudwatch_metric_alarm"',
            'resource "aws_iam_role"',
        ):
            self.assertIn(resource, terraform)


if __name__ == "__main__":
    unittest.main()
