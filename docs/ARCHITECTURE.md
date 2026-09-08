# Architecture — Retail Core Lakehouse

## Flux principal

```text
Produits · clients · identités · stocks
Commandes · paiements · événements · prix
                      │
                      ▼
             Airflow · retail_core_daily
                      │
          ┌───────────┼───────────┐
          ▼           ▼           ▼
       S3 Raw      Kinesis     Python / SQLite
     LocalStack    LocalStack   modèle de contrôle
          └───────────┬───────────┘
                      ▼
               dbt Core + DuckDB
      staging → identité → dimensions → faits
                      │
                      ▼
          tests + réconciliations + SCD2
                      │
                      ▼
             publication des data products
```

## Orchestration

Le DAG est planifié à 05:15, heure de Paris, avec deux reprises de cinq minutes et un seul run actif.

1. `extract_sources` produit et compte les huit sources.
2. `stage_local_aws` charge S3, valide les événements et alimente Kinesis.
3. `build_reference_warehouse` construit le modèle de contrôle Python/SQLite.
4. `dbt_build` exécute les transformations et tests dans DuckDB.
5. `reconcile_platform` compare événements, ventes et paiements.
6. `publish_kpis` publie uniquement si tous les contrôles passent.

## Data products

| Objet | Rôle |
|---|---|
| `fct_sales` / `fct_payments` | ventes et rapprochement financier |
| `fct_retail_event` | événements omnicanaux |
| `dim_customer` | Golden Record pseudonymisé |
| `dim_product_price_scd2` | historique des prix |
| `snp_inventory_state` | historique du stock |
| `fct_available_to_promise` | disponibilité promettable |
| `mart_customer_rfm` | segmentation client |

ATP :

```text
stock magasin + stock entrepôt + entrant - réservations - unités vendues
```

## Fiabilité

La publication est refusée si un test échoue, si les unités batch et Kinesis divergent ou si les ventes et paiements ne se rapprochent pas. Le projet local appelle les API S3, Kinesis et CloudWatch de LocalStack ; il n’utilise aucun compte AWS réel.
