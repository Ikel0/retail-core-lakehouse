"""AWS Lambda handler: schema validation and idempotent Kinesis preprocessing."""

import base64
import json
from datetime import datetime

REQUIRED_FIELDS = {"event_id", "event_type", "customer_id", "product_id", "event_at"}


def _validate(payload: dict) -> dict:
    missing = REQUIRED_FIELDS - payload.keys()
    if missing:
        raise ValueError(f"Missing required fields: {sorted(missing)}")
    datetime.fromisoformat(payload["event_at"].replace("Z", "+00:00"))
    payload["schema_version"] = "retail-event/2.1"
    payload["idempotency_key"] = payload["event_id"]
    return payload


def handler(event, _context):
    output = []
    for record in event["records"]:
        try:
            decoded = base64.b64decode(record["data"])
            validated = _validate(json.loads(decoded))
            encoded = base64.b64encode((json.dumps(validated) + "\n").encode()).decode()
            output.append({"recordId": record["recordId"], "result": "Ok", "data": encoded})
        except (ValueError, KeyError, json.JSONDecodeError):
            output.append({"recordId": record.get("recordId", "unknown"), "result": "ProcessingFailed", "data": record.get("data", "")})
    return {"records": output}
