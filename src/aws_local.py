"""Exercise S3, Kinesis and CloudWatch APIs against a local AWS emulator."""

from __future__ import annotations

import argparse
import csv
import importlib.util
import json
import math
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse


LOCAL_ENDPOINT_HOSTS = {"localhost", "127.0.0.1", "localstack", "host.docker.internal"}


def _load_event_validator(project_root: Path):
    module_path = project_root / "lambda" / "validate_kinesis_event.py"
    spec = importlib.util.spec_from_file_location("retail_event_validator", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Impossible de charger {module_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module._validate


def _require_local_endpoint(endpoint_url: str) -> None:
    hostname = urlparse(endpoint_url).hostname
    if hostname not in LOCAL_ENDPOINT_HOSTS and os.getenv("RETAIL_CORE_ALLOW_REAL_AWS") != "1":
        raise RuntimeError(
            "Exécution AWS réelle bloquée. Utilisez LocalStack ou définissez explicitement "
            "RETAIL_CORE_ALLOW_REAL_AWS=1."
        )


def _percentile(values: list[int], percentile: float) -> int:
    ordered = sorted(values)
    if not ordered:
        return 0
    index = max(0, math.ceil(percentile * len(ordered)) - 1)
    return ordered[min(index, len(ordered) - 1)]


def _chunks(rows: list[dict], size: int):
    for start in range(0, len(rows), size):
        yield rows[start : start + size]


def _client_kwargs(endpoint_url: str, region: str) -> dict:
    return {
        "endpoint_url": endpoint_url,
        "region_name": region,
        "aws_access_key_id": os.getenv("AWS_ACCESS_KEY_ID", "test"),
        "aws_secret_access_key": os.getenv("AWS_SECRET_ACCESS_KEY", "test"),
    }


def _wait_for_stream(kinesis, stream_name: str, timeout_seconds: int = 30) -> dict:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        description = kinesis.describe_stream(StreamName=stream_name)["StreamDescription"]
        if description["StreamStatus"] == "ACTIVE":
            return description
        time.sleep(0.5)
    raise TimeoutError(f"Le stream {stream_name} n'est pas devenu actif")


def sync_to_local_aws(project_root: Path, endpoint_url: str | None = None) -> dict:
    """Load the raw zone and stream through AWS-compatible APIs, then publish evidence."""
    try:
        import boto3
        from botocore.exceptions import ClientError
    except ImportError as exc:  # pragma: no cover - explicit CLI guidance
        raise RuntimeError(
            "Boto3 est requis. Installez requirements-platform.txt ou utilisez Docker."
        ) from exc

    project_root = project_root.resolve()
    endpoint_url = endpoint_url or os.getenv("AWS_ENDPOINT_URL", "http://localhost:4566")
    _require_local_endpoint(endpoint_url)
    region = os.getenv("AWS_DEFAULT_REGION", "eu-west-3")
    bucket_name = os.getenv("RETAIL_CORE_RAW_BUCKET", "retail-core-raw-local")
    stream_name = os.getenv("RETAIL_CORE_STREAM", "retail-events-local")
    namespace = "RetailCore/Local"
    raw_dir = project_root / "data" / "raw"
    report_dir = project_root / "reports"
    report_dir.mkdir(exist_ok=True)
    client_kwargs = _client_kwargs(endpoint_url, region)
    s3 = boto3.client("s3", **client_kwargs)
    kinesis = boto3.client("kinesis", **client_kwargs)
    cloudwatch = boto3.client("cloudwatch", **client_kwargs)
    logs = boto3.client("logs", **client_kwargs)

    try:
        s3.head_bucket(Bucket=bucket_name)
    except ClientError:
        create_args = {"Bucket": bucket_name}
        if region != "us-east-1":
            create_args["CreateBucketConfiguration"] = {"LocationConstraint": region}
        s3.create_bucket(**create_args)

    ingestion_date = datetime.now(timezone.utc).date().isoformat()
    uploaded = []
    for source_path in sorted(raw_dir.glob("*.csv")):
        source_name = source_path.stem
        key = f"raw/{source_name}/ingestion_date={ingestion_date}/{source_path.name}"
        s3.upload_file(str(source_path), bucket_name, key)
        uploaded.append({"key": key, "bytes": source_path.stat().st_size})

    try:
        kinesis.create_stream(StreamName=stream_name, ShardCount=1)
    except kinesis.exceptions.ResourceInUseException:
        pass
    stream_description = _wait_for_stream(kinesis, stream_name)

    with (raw_dir / "stream_events.csv").open(encoding="utf-8") as source:
        events = list(csv.DictReader(source))
    validate_event = _load_event_validator(project_root)
    validated_events = [validate_event(dict(event)) for event in events]
    failed_records = 0
    for batch in _chunks(validated_events, 500):
        response = kinesis.put_records(
            StreamName=stream_name,
            Records=[
                {
                    "Data": (json.dumps(event, ensure_ascii=False) + "\n").encode("utf-8"),
                    "PartitionKey": event["partition_key"],
                }
                for event in batch
            ],
        )
        failed_records += response.get("FailedRecordCount", 0)
    if failed_records:
        raise RuntimeError(f"{failed_records} événements Kinesis n'ont pas été écrits")

    first_shard = stream_description["Shards"][0]["ShardId"]
    iterator = kinesis.get_shard_iterator(
        StreamName=stream_name,
        ShardId=first_shard,
        ShardIteratorType="TRIM_HORIZON",
    )["ShardIterator"]
    sample_records = kinesis.get_records(ShardIterator=iterator, Limit=10)["Records"]
    if not sample_records:
        time.sleep(0.5)
        sample_records = kinesis.get_records(ShardIterator=iterator, Limit=10)["Records"]

    latency_p95 = _percentile([int(event["latency_ms"]) for event in events], 0.95)
    cloudwatch.put_metric_data(
        Namespace=namespace,
        MetricData=[
            {"MetricName": "RawObjectsUploaded", "Value": len(uploaded), "Unit": "Count"},
            {"MetricName": "EventsPublished", "Value": len(events), "Unit": "Count"},
            {"MetricName": "EventLatencyP95", "Value": latency_p95, "Unit": "Milliseconds"},
        ],
    )
    cloudwatch.put_metric_alarm(
        AlarmName="retail-core-event-latency-p95",
        Namespace=namespace,
        MetricName="EventLatencyP95",
        Statistic="Maximum",
        Period=60,
        EvaluationPeriods=1,
        Threshold=3000,
        ComparisonOperator="GreaterThanThreshold",
        TreatMissingData="notBreaching",
    )

    log_group = "/retail-core/pipeline"
    log_stream = f"local-{ingestion_date}"
    try:
        logs.create_log_group(logGroupName=log_group)
    except logs.exceptions.ResourceAlreadyExistsException:
        pass
    try:
        logs.create_log_stream(logGroupName=log_group, logStreamName=log_stream)
    except logs.exceptions.ResourceAlreadyExistsException:
        pass
    logs.put_log_events(
        logGroupName=log_group,
        logStreamName=log_stream,
        logEvents=[
            {
                "timestamp": int(time.time() * 1000),
                "message": json.dumps(
                    {
                        "status": "PASS",
                        "objects": len(uploaded),
                        "events": len(events),
                        "latency_p95_ms": latency_p95,
                    }
                ),
            }
        ],
    )

    report = {
        "status": "PASS",
        "mode": "localstack_emulation",
        "endpoint": endpoint_url,
        "region": region,
        "s3": {
            "bucket": bucket_name,
            "objects_uploaded": len(uploaded),
            "bytes_uploaded": sum(item["bytes"] for item in uploaded),
        },
        "kinesis": {
            "stream": stream_name,
            "events_published": len(events),
            "failed_records": failed_records,
            "sample_records_read": len(sample_records),
        },
        "lambda_preprocessing": {
            "validated_events": len(validated_events),
            "schema_version": "retail-event/2.1",
        },
        "cloudwatch": {
            "namespace": namespace,
            "metrics_published": 3,
            "alarm": "retail-core-event-latency-p95",
            "log_group": log_group,
        },
        "latency_p95_ms": latency_p95,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    (report_dir / "aws_local_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description="Charger le jeu retail dans LocalStack")
    parser.add_argument("--project-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--endpoint-url")
    args = parser.parse_args()
    report = sync_to_local_aws(args.project_root, args.endpoint_url)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
