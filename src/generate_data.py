"""Deterministic synthetic data generator for the local retail demo."""

import csv
import hashlib
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path


PRODUCTS = [
    ("P100", "T-shirt thermique", "Thermique", "Femme", "Hiver 2026", 34.99),
    ("P101", "Pull col roulé confort", "Maille", "Femme", "Hiver 2026", 49.99),
    ("P102", "Jean coupe confort", "Pantalons", "Femme", "Permanent", 69.99),
    ("P103", "Manteau matelassé", "Manteaux", "Femme", "Hiver 2026", 129.99),
    ("P104", "Polo maille piquée", "Polos", "Homme", "Permanent", 39.99),
    ("P105", "Pantalon chino stretch", "Pantalons", "Homme", "Permanent", 59.99),
    ("P106", "Veste légère déperlante", "Vestes", "Homme", "Automne 2026", 89.99),
    ("P107", "Chemise coton doux", "Chemises", "Homme", "Permanent", 44.99),
    ("P108", "Baskets amortissantes", "Chaussures", "Mixte", "Automne 2026", 79.99),
    ("P109", "Pyjama douceur", "Nuit", "Femme", "Hiver 2026", 42.99),
    ("P110", "Gilet zippé", "Maille", "Homme", "Hiver 2026", 54.99),
    ("P111", "Écharpe chaude", "Accessoires", "Mixte", "Hiver 2026", 24.99),
]


def _email_hash(email: str) -> str:
    return hashlib.sha256(email.lower().encode("utf-8")).hexdigest()[:16]


def _write_csv(path: Path, rows: list[dict]) -> None:
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)


def generate(out: Path, seed: int = 42, order_count: int = 960) -> None:
    random.seed(seed)
    out.mkdir(parents=True, exist_ok=True)

    products = [
        {
            "product_id": product_id,
            "name": name,
            "category": category,
            "department": department,
            "collection": collection,
            "price": price,
            "currency": "EUR",
        }
        for product_id, name, category, department, collection, price in PRODUCTS
    ]
    customers = []
    for index in range(1, 161):
        email = f"client{index:03}@retail-demo.fr"
        customers.append(
            {
                "customer_id": f"C{index:04}",
                "email_hash": _email_hash(email),
                "loyalty_id": f"L{10000 + index}" if index % 5 else "",
                "country": random.choices(["FR", "BE", "LU"], [88, 9, 3])[0],
                "acquisition_channel": random.choice(["web", "store", "catalog"]),
                "consent_marketing": "true" if index % 4 else "false",
            }
        )

    stock = []
    for product in products:
        stock.append(
            {
                "product_id": product["product_id"],
                "store_stock": random.randint(260, 680),
                "warehouse_stock": random.randint(500, 1250),
                "reserved": random.randint(12, 65),
                "incoming": random.randint(80, 300),
                "safety_stock": random.randint(65, 140),
            }
        )

    now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    start = now - timedelta(days=29)
    orders: list[dict] = []
    events: list[dict] = []
    for index in range(1, order_count + 1):
        product = random.choices(products, weights=[14, 10, 13, 6, 9, 8, 5, 8, 7, 8, 6, 6])[0]
        customer = random.choice(customers)
        channel = random.choices(["web", "store", "marketplace"], [48, 44, 8])[0]
        quantity = random.choices([1, 2, 3, 4], [70, 22, 7, 1])[0]
        ordered_at = start + timedelta(seconds=random.randint(0, 29 * 86400))
        discount = random.choice([0, 0, 0, 0.10, 0.15, 0.20])
        unit_price = round(float(product["price"]) * (1 - discount), 2)
        order_id = f"O{index:06}"
        orders.append(
            {
                "order_id": order_id,
                "customer_id": customer["customer_id"],
                "product_id": product["product_id"],
                "channel": channel,
                "store_id": f"S{random.randint(1, 18):03}" if channel == "store" else "ONLINE",
                "quantity": quantity,
                "unit_price": unit_price,
                "discount_rate": discount,
                "ordered_at": ordered_at.isoformat(),
                "payment_status": "paid",
            }
        )
        latency_ms = random.randint(180, 2400)
        events.append(
            {
                "event_id": f"E{index:07}",
                "event_type": "purchase",
                "order_id": order_id,
                "customer_id": customer["customer_id"],
                "product_id": product["product_id"],
                "channel": channel,
                "quantity": quantity,
                "event_at": (ordered_at + timedelta(milliseconds=latency_ms)).isoformat(),
                "latency_ms": latency_ms,
                "partition_key": customer["customer_id"],
            }
        )

    # High-frequency web events demonstrate Kinesis traffic beyond purchases.
    for index in range(1, 2201):
        customer = random.choice(customers)
        product = random.choice(products)
        event_at = start + timedelta(seconds=random.randint(0, 29 * 86400))
        events.append(
            {
                "event_id": f"W{index:07}",
                "event_type": random.choices(["product_view", "add_to_cart"], [78, 22])[0],
                "order_id": "",
                "customer_id": customer["customer_id"],
                "product_id": product["product_id"],
                "channel": "web",
                "quantity": 0,
                "event_at": event_at.isoformat(),
                "latency_ms": random.randint(90, 900),
                "partition_key": customer["customer_id"],
            }
        )

    price_history = []
    for product in products:
        current = float(product["price"])
        previous = round(current * 1.08, 2)
        price_history.extend(
            [
                {
                    "product_id": product["product_id"],
                    "price": previous,
                    "valid_from": (start - timedelta(days=90)).date().isoformat(),
                    "valid_to": (start - timedelta(days=1)).date().isoformat(),
                    "is_current": "false",
                },
                {
                    "product_id": product["product_id"],
                    "price": current,
                    "valid_from": start.date().isoformat(),
                    "valid_to": "9999-12-31",
                    "is_current": "true",
                },
            ]
        )

    _write_csv(out / "products.csv", products)
    _write_csv(out / "customers.csv", customers)
    _write_csv(out / "stock.csv", stock)
    _write_csv(out / "orders.csv", sorted(orders, key=lambda item: item["ordered_at"]))
    _write_csv(out / "stream_events.csv", sorted(events, key=lambda item: item["event_at"]))
    _write_csv(out / "price_history.csv", price_history)
