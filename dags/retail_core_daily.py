"""Airflow DAG executing the complete local Retail Core data product."""

from __future__ import annotations

import os
from datetime import timedelta
from pathlib import Path

try:
    import pendulum
    from airflow.sdk import dag, task
except ImportError:  # Keeps the repository importable outside the Airflow runtime.
    try:
        import pendulum
        from airflow.decorators import dag, task
    except ImportError:
        dag = task = pendulum = None


def _project_root() -> Path:
    return Path(os.getenv("RETAIL_CORE_ROOT", Path(__file__).resolve().parents[1]))


if dag is not None:

    @dag(
        dag_id="retail_core_daily",
        description="Ingestion, AWS local, modèle dbt, réconciliation et publication retail.",
        schedule="15 5 * * *",
        start_date=pendulum.datetime(2026, 1, 1, tz="Europe/Paris"),
        catchup=False,
        max_active_runs=1,
        default_args={"retries": 2, "retry_delay": timedelta(minutes=5)},
        tags=["retail", "dbt", "aws", "data-product"],
        doc_md="""
        # Retail Core daily

        Le DAG exécute réellement le connecteur source, le profil AWS local quand il est
        activé, le modèle de référence, `dbt build`, la réconciliation batch/stream/paiement
        et le publishing gate. La planification à 05:15 laisse une fenêtre contrôlée avant
        le SLA métier de 08:00 Europe/Paris.
        """,
    )
    def retail_core_daily():
        from src.orchestration import (
            build_dbt_marts,
            build_reference_warehouse,
            extract_sources,
            publish_kpis,
            reconcile_platform,
            stage_local_aws,
        )

        @task
        def extract_sources_task() -> dict:
            return extract_sources(_project_root())

        @task
        def stage_local_aws_task(extraction: dict) -> dict:
            return stage_local_aws(_project_root(), extraction)

        @task
        def build_reference_warehouse_task(cloud_stage: dict) -> dict:
            return build_reference_warehouse(_project_root(), cloud_stage)

        @task
        def dbt_build_task(reference: dict) -> dict:
            return build_dbt_marts(_project_root(), reference)

        @task
        def reconcile_platform_task(
            reference: dict, dbt_result: dict, cloud_stage: dict
        ) -> dict:
            return reconcile_platform(
                _project_root(), reference, dbt_result, cloud_stage
            )

        @task
        def publish_kpis_task(reconciliation: dict) -> dict:
            return publish_kpis(_project_root(), reconciliation)

        extraction = extract_sources_task()
        cloud_stage = stage_local_aws_task(extraction)
        reference = build_reference_warehouse_task(cloud_stage)
        dbt_result = dbt_build_task(reference)
        reconciliation = reconcile_platform_task(reference, dbt_result, cloud_stage)
        publish_kpis_task(reconciliation)

    retail_core_daily_dag = retail_core_daily()
