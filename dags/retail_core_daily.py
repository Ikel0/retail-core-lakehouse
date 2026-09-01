"""Airflow DAG representative of a production retail workflow."""

from datetime import datetime, timedelta

try:
    from airflow.decorators import dag, task
except ImportError:  # Keeps the portfolio repository importable without Airflow.
    dag = task = None


if dag:
    @dag(
        dag_id="retail_core_daily",
        schedule="15 5 * * *",
        start_date=datetime(2026, 1, 1),
        catchup=False,
        default_args={"retries": 2, "retry_delay": timedelta(minutes=5)},
        tags=["retail", "core-model", "lakehouse"],
    )
    def retail_core_daily():
        @task
        def extract_sources():
            return {"airbyte_connections": 5, "status": "succeeded"}

        @task
        def validate_contracts(extraction):
            if extraction["status"] != "succeeded":
                raise ValueError("Source extraction failed")
            return {"contracts": 10, "failed": 0}

        @task
        def transform_core_model(contracts):
            if contracts["failed"]:
                raise ValueError("Publishing gate closed")
            return {"dbt_models": 8, "tests": 10}

        @task
        def reconcile_stream(transformation):
            return {"batch_units": 1247, "stream_units": 1247, "delta": 0}

        @task
        def publish_kpis(reconciliation):
            if reconciliation["delta"] != 0:
                raise ValueError("Batch/stream reconciliation failed")
            return {"dashboard_ready": True, "sla": "08:00 Europe/Paris"}

        publish_kpis(reconcile_stream(transform_core_model(validate_contracts(extract_sources()))))

    retail_core_daily()
