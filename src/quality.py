"""Data-contract checks used as a publishing gate."""

import re
from collections import defaultdict
from datetime import datetime, timezone


def _is_unique(rows: list[dict], key: str) -> bool:
    values = [row[key] for row in rows]
    return len(values) == len(set(values))


def _scd_groups(rows: list[dict]) -> dict[str, list[dict]]:
    groups: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        groups[row["product_id"]].append(row)
    return groups


def _scd_ranges_do_not_overlap(rows: list[dict]) -> bool:
    for versions in _scd_groups(rows).values():
        ordered = sorted(versions, key=lambda row: row["valid_from"])
        for current, following in zip(ordered, ordered[1:]):
            if current["valid_to"] >= following["valid_from"]:
                return False
    return True


def run_checks(data: dict) -> dict:
    orders = data["orders"]
    events = data["events"]
    purchase_events = [event for event in events if event["event_type"] == "purchase"]
    price_history = data["price_history"]
    scd_groups = _scd_groups(price_history)
    latest_event = max(datetime.fromisoformat(event["event_at"]) for event in events)
    freshness_minutes = max(0, (datetime.now(timezone.utc) - latest_event).total_seconds() / 60)

    checks = {
        "contract.orders.order_id_unique": _is_unique(orders, "order_id"),
        "contract.events.event_id_unique": _is_unique(events, "event_id"),
        "integrity.orders_product_fk": all(row["product_id"] in data["product_ids"] for row in orders),
        "integrity.orders_customer_fk": all(row["customer_id"] in data["customer_ids"] for row in orders),
        "business.positive_quantities": all(int(row["quantity"]) > 0 for row in orders),
        "business.positive_sales_amount": all(float(row["quantity"]) * float(row["unit_price"]) > 0 for row in orders),
        "business.discount_rate_in_range": all(0 <= float(row["discount_rate"]) < 1 for row in orders),
        "stream.purchase_count_matches_batch": len(purchase_events) == len(orders),
        "stream.purchase_units_match_batch": sum(int(row["quantity"]) for row in purchase_events)
        == sum(int(row["quantity"]) for row in orders),
        "stream.purchase_order_ids_match_batch": {row["order_id"] for row in purchase_events}
        == {row["order_id"] for row in orders},
        "stream.partition_key_matches_customer": all(
            row["partition_key"] == row["customer_id"] for row in events
        ),
        "privacy.email_hash_shape": all(
            re.fullmatch(r"[0-9a-f]{16}", row["email_hash"]) is not None
            for row in data["customers"]
        ),
        "scd.one_current_version_per_product": all(
            sum(row["is_current"] == "true" for row in versions) == 1
            for versions in scd_groups.values()
        ),
        "scd.current_version_is_open_ended": all(
            row["valid_to"] == "9999-12-31"
            for row in price_history
            if row["is_current"] == "true"
        ),
        "scd.version_ranges_do_not_overlap": _scd_ranges_do_not_overlap(price_history),
        "freshness.latest_event_under_24h": freshness_minutes < 24 * 60,
    }
    failed = [name for name, passed in checks.items() if not passed]
    return {
        "status": "PASS" if not failed else "FAIL",
        "score": round(100 * (len(checks) - len(failed)) / len(checks), 1),
        "total": len(checks),
        "passed": len(checks) - len(failed),
        "failed": len(failed),
        "freshness_minutes": round(freshness_minutes, 1),
        "checks": checks,
    }
