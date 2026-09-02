"""Prepare the local raw zone and execute the dbt Core project."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from .generate_data import generate


RAW_TABLES = {
    "orders": "orders.csv",
    "products": "products.csv",
    "customers": "customers.csv",
    "customer_identities": "customer_identities.csv",
    "inventory": "stock.csv",
    "payments": "payments.csv",
    "retail_events": "stream_events.csv",
    "price_history": "price_history.csv",
}


def _sql_literal(value: str) -> str:
    return value.replace("'", "''")


def prepare_raw_views(project_root: Path, warehouse_path: Path) -> dict:
    """Create persistent DuckDB views over the raw CSV landing zone."""
    try:
        import duckdb
    except ImportError as exc:  # pragma: no cover - explicit CLI guidance
        raise RuntimeError(
            "DuckDB est requis. Installez requirements-dbt.txt ou utilisez Docker."
        ) from exc

    raw_dir = project_root / "data" / "raw"
    missing = [filename for filename in RAW_TABLES.values() if not (raw_dir / filename).exists()]
    if missing:
        raise FileNotFoundError(f"Sources brutes absentes : {', '.join(missing)}")

    warehouse_path.parent.mkdir(parents=True, exist_ok=True)
    connection = duckdb.connect(str(warehouse_path))
    try:
        connection.execute("create schema if not exists raw")
        for table_name, filename in RAW_TABLES.items():
            csv_path = _sql_literal(str((raw_dir / filename).resolve()))
            connection.execute(
                f"""
                create or replace view raw.{table_name} as
                select *, current_timestamp as _ingested_at
                from read_csv_auto('{csv_path}', header=true, sample_size=-1)
                """
            )
    finally:
        connection.close()
    return {"status": "PASS", "views": len(RAW_TABLES), "warehouse": str(warehouse_path)}


def _dbt_executable() -> str:
    configured = os.getenv("DBT_EXECUTABLE")
    if configured:
        return configured
    sibling = Path(sys.executable).with_name("dbt")
    if sibling.exists():
        return str(sibling)
    executable = shutil.which("dbt")
    if executable:
        return executable
    raise RuntimeError(
        "dbt est introuvable. Installez requirements-dbt.txt ou utilisez le service Docker dbt."
    )


def _summarize_results(run_results_path: Path) -> dict:
    payload = json.loads(run_results_path.read_text(encoding="utf-8"))
    counts = {"models": 0, "tests": 0, "snapshots": 0}
    failed = []
    for result in payload.get("results", []):
        unique_id = result.get("unique_id", "")
        resource_type = unique_id.split(".", 1)[0]
        if resource_type == "model":
            counts["models"] += 1
        elif resource_type in {"test", "unit_test"}:
            counts["tests"] += 1
        elif resource_type == "snapshot":
            counts["snapshots"] += 1
        if result.get("status") not in {"success", "pass"}:
            failed.append({"unique_id": unique_id, "status": result.get("status")})
    return {**counts, "failed": failed, "total": len(payload.get("results", []))}


def run_dbt_build(project_root: Path, full_refresh: bool = False) -> dict:
    """Run dbt build against DuckDB and persist a compact evidence report."""
    project_root = project_root.resolve()
    warehouse_path = Path(
        os.getenv("RETAIL_CORE_DUCKDB_PATH", project_root / "data" / "retail_core.duckdb")
    ).resolve()
    prepare_report = prepare_raw_views(project_root, warehouse_path)
    command = [
        _dbt_executable(),
        "build",
        "--project-dir",
        str(project_root),
        "--profiles-dir",
        str(project_root / "profiles"),
    ]
    if full_refresh:
        command.append("--full-refresh")
    environment = os.environ.copy()
    environment["RETAIL_CORE_DUCKDB_PATH"] = str(warehouse_path)
    completed = subprocess.run(
        command,
        cwd=project_root,
        env=environment,
        text=True,
        capture_output=True,
        check=False,
    )
    results_path = project_root / "target" / "run_results.json"
    summary = _summarize_results(results_path) if results_path.exists() else {
        "models": 0,
        "tests": 0,
        "snapshots": 0,
        "failed": [{"unique_id": "dbt.build", "status": "missing_run_results"}],
        "total": 0,
    }
    report = {
        "status": "PASS" if completed.returncode == 0 and not summary["failed"] else "FAIL",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "dbt_command": "dbt build",
        "adapter": "duckdb",
        "warehouse": str(warehouse_path),
        "raw": prepare_report,
        **summary,
    }
    reports_dir = project_root / "reports"
    reports_dir.mkdir(exist_ok=True)
    (reports_dir / "dbt_run_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    if completed.returncode != 0 or summary["failed"]:
        tail = "\n".join((completed.stdout + completed.stderr).splitlines()[-35:])
        raise RuntimeError(f"dbt build a échoué.\n{tail}")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description="Exécuter le projet dbt Retail Core")
    parser.add_argument("command", nargs="?", default="build", choices=["build", "prepare"])
    parser.add_argument("--project-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--full-refresh", action="store_true")
    parser.add_argument("--no-generate", action="store_true")
    args = parser.parse_args()
    if not args.no_generate:
        generate(args.project_root / "data" / "raw")
    warehouse_path = Path(
        os.getenv(
            "RETAIL_CORE_DUCKDB_PATH",
            args.project_root / "data" / "retail_core.duckdb",
        )
    ).resolve()
    if args.command == "prepare":
        report = prepare_raw_views(args.project_root, warehouse_path)
    else:
        report = run_dbt_build(args.project_root, full_refresh=args.full_refresh)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
