# Architecture cible — Retail Core Lakehouse

Le prototype local conserve les mêmes frontières que la cible cloud afin que chaque composant puisse être remplacé sans réécrire la logique métier.

```text
CRM / ERP / PLM ── Airbyte ───────────────┐
POS / E-commerce ─ Kinesis ─ Lambda ─────┼── S3 Raw ─ dbt ─ Snowflake ─ Retail Marts
Fichiers Supply ── Airbyte ───────────────┘                  │
                                                            ├── ATP / Stock
Airflow / MWAA : orchestration, retries, backfill ──────────┤
CloudWatch : logs, métriques, alertes ──────────────────────┤
Data contracts + réconciliation batch/stream ──────────────┘
```

## Décisions structurantes

- Grain de `fct_sales` : une commande omnicanale.
- Clé Kinesis : `customer_id` pour conserver l’ordre des événements d’un client.
- Clé d’idempotence : `event_id` pour sécuriser les reprises et les doublons.
- SCD Type 2 : historique de prix avec `valid_from`, `valid_to`, `is_current`.
- Publishing gate : aucune exposition si un contrôle critique échoue.
- ATP : stock magasin + entrepôt + entrant - réservations - ventes.
- FinOps : dbt incrémental, auto-suspend warehouse, lifecycle S3 et right-sizing Lambda.
