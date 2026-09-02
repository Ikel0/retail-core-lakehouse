"""Reusable orchestration stages called by Airflow and local validation commands."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from connectors.source_retail.source import discover_catalog, source_inventory

from .generate_data import generate
from .pipeline import run as run_reference_pipeline


def _write_report(project_root: Path, name: str, payload: dict) -> None:
    reports = project_root / "reports"
    reports.mkdir(exist_ok=True)
    (reports / name).write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def extract_sources(project_root: Path) -> dict:
    """Generate source data and exercise the Airbyte-compatible catalog contract."""
    raw_dir = project_root / "data" / "raw"
    generate(raw_dir)
    evidence = source_inventory(raw_dir)
    evidence["catalog"] = discover_catalog(raw_dir)
    evidence["generated_at"] = datetime.now(timezone.utc).isoformat()
    _write_report(project_root, "airbyte_source_report.json", evidence)
    return {
        "status": evidence["status"],
        "streams": evidence["streams"],
        "records": evidence["records"],
        "record_counts": evidence["record_counts"],
    }


def stage_local_aws(project_root: Path, extraction: dict) -> dict:
    """Optionally stage S3/Kinesis/CloudWatch when the local AWS profile is enabled."""
    if extraction.get("status") != "PASS":
        raise ValueError("L'extraction source n'est pas conforme")
    if os.getenv("RETAIL_CORE_AWS_MODE", "disabled") != "localstack":
        return {
            "status": "SKIPPED",
            "mode": "local_reference",
            "reason": "Activez RETAIL_CORE_AWS_MODE=localstack pour le profil AWS local.",
        }
    from .aws_local import sync_to_local_aws

    return sync_to_local_aws(project_root)


def build_reference_warehouse(project_root: Path, cloud_stage: dict) -> dict:
    """Build the independently testable SQLite reference model and quality gate."""
    if cloud_stage.get("status") not in {"PASS", "SKIPPED"}:
        raise ValueError("La zone d'atterrissage cloud n'est pas prête")
    result = run_reference_pipeline(project_root / "data")
    return {
        "status": result["quality"]["status"],
        "sales": result["sales_count"],
        "events": result["event_count"],
        "quality_checks": result["quality"]["total"],
        "unit_delta": result["reconciliation"]["delta"],
        "payment_delta": result["reconciliation"]["amount_delta"],
    }


def build_dbt_marts(project_root: Path, reference: dict) -> dict:
    """Execute dbt in its isolated runtime and return the real run-results summary."""
    if reference.get("status") != "PASS":
        raise ValueError("Le modèle de référence n'a pas passé le publishing gate")
    dbt_python = os.getenv("DBT_PYTHON")
    if not dbt_python:
        executable = os.getenv("DBT_EXECUTABLE", "dbt")
        resolved = Path(executable)
        dbt_python = str(resolved.with_name("python")) if resolved.parent != Path(".") else "python3"
    command = [
        dbt_python,
        "-m",
        "src.dbt_runner",
        "build",
        "--project-root",
        str(project_root),
        "--no-generate",
    ]
    completed = subprocess.run(
        command,
        cwd=project_root,
        env=os.environ.copy(),
        text=True,
        capture_output=True,
        check=False,
    )
    if completed.returncode != 0:
        tail = "\n".join((completed.stdout + completed.stderr).splitlines()[-35:])
        raise RuntimeError(f"La tâche dbt build a échoué.\n{tail}")
    report = json.loads((project_root / "reports" / "dbt_run_report.json").read_text())
    if report["status"] != "PASS":
        raise ValueError("Les tests dbt n'ont pas passé le publishing gate")
    return {
        "status": report["status"],
        "models": report["models"],
        "tests": report["tests"],
        "snapshots": report["snapshots"],
        "failed": len(report["failed"]),
    }


def reconcile_platform(project_root: Path, reference: dict, dbt_result: dict, cloud_stage: dict) -> dict:
    """Close the publishing gate only when every enabled execution path agrees."""
    quality_report = json.loads(
        (project_root / "reports" / "quality_report.json").read_text(encoding="utf-8")
    )
    reconciliation = quality_report["reconciliation"]
    statuses = [reference["status"], dbt_result["status"]]
    if cloud_stage["status"] != "SKIPPED":
        statuses.append(cloud_stage["status"])
    report = {
        "status": "PASS"
        if all(status == "PASS" for status in statuses)
        and reconciliation["delta"] == 0
        and abs(reconciliation["amount_delta"]) <= 0.005
        else "FAIL",
        "unit_delta": reconciliation["delta"],
        "payment_delta": reconciliation["amount_delta"],
        "quality_checks": quality_report["quality"]["total"],
        "dbt_tests": dbt_result["tests"],
        "aws_mode": cloud_stage.get("mode"),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    _write_report(project_root, "platform_reconciliation.json", report)
    if report["status"] != "PASS":
        raise ValueError(f"Publishing gate fermé : {report}")
    return report


def publish_kpis(project_root: Path, reconciliation: dict) -> dict:
    """Publish an auditable manifest after the quality and reconciliation gates."""
    if reconciliation.get("status") != "PASS":
        raise ValueError("Publication interdite : la réconciliation n'est pas conforme")
    manifest = {
        "status": "PUBLISHED",
        "published_at": datetime.now(timezone.utc).isoformat(),
        "sla": "08:00 Europe/Paris",
        "artifacts": [
            "data/curated/retail_kpis.json",
            "reports/quality_report.json",
            "reports/dbt_run_report.json",
            "reports/platform_reconciliation.json",
        ],
        "reconciliation": reconciliation,
    }
    _write_report(project_root, "publish_manifest.json", manifest)
    return manifest


def run_all(project_root: Path) -> dict:
    extraction = extract_sources(project_root)
    cloud_stage = stage_local_aws(project_root, extraction)
    reference = build_reference_warehouse(project_root, cloud_stage)
    dbt_result = build_dbt_marts(project_root, reference)
    reconciliation = reconcile_platform(project_root, reference, dbt_result, cloud_stage)
    return publish_kpis(project_root, reconciliation)


def main() -> None:
    parser = argparse.ArgumentParser(description="Exécuter toutes les étapes Retail Core")
    parser.add_argument("--project-root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    print(json.dumps(run_all(args.project_root), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
