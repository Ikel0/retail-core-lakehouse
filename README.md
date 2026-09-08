# Retail Core Lakehouse

[![CI](https://github.com/Ikel0/retail-core-lakehouse/actions/workflows/ci.yml/badge.svg)](https://github.com/Ikel0/retail-core-lakehouse/actions/workflows/ci.yml)

Plateforme data retail omnicanale de bout en bout. Elle rapproche les ventes, les paiements, les stocks, les événements digitaux et les identités client, puis ne publie les data products que si les contrôles métier et techniques sont conformes.

**Application :** [Retail Core Command Center](https://ikel0.github.io/retail-core-lakehouse/)

## Finalité

- consolider une source de vérité ventes/paiements ;
- calculer un stock disponible à la promesse (`ATP`) ;
- réunifier les identités CRM, web, POS et marketplace en Golden Records ;
- historiser les prix et les états de stock en SCD2 ;
- piloter qualité, fraîcheur, capacité et coûts depuis un cockpit interactif.

Toutes les données sont synthétiques, déterministes et sans information personnelle réelle.

## Architecture

```text
CRM · ERP · PLM · POS · e-commerce
                 │
                 ├── batch ──> connecteur compatible Airbyte ──> S3 Raw local
                 │
                 └── événements ──> validation ──> Kinesis local
                                                        │
Apache Airflow ─────────────────────────────────────────┤
  ingestion · reprise · ordre · publishing gate        │
                                                        ▼
                            DuckDB ──> dbt Core ──> Retail Marts
                                           │
                             tests · SCD2 · réconciliations
                                           │
                                           ▼
                   KPI · ATP · Customer 360 · RFM · repricing
```

Le profil local utilise LocalStack pour appeler de vraies API compatibles S3, Kinesis et CloudWatch sans compte AWS. DuckDB exécute les transformations dbt à la place du warehouse Snowflake cible.

## Exécution de référence

| Contrôle | Résultat |
|---|---:|
| Sources | 8 flux · 5 928 lignes |
| Ventes / paiements | 960 / 960 |
| Résolution d’identité | 640 identités · 160 Golden Records |
| Flux événementiel | 3 160 événements |
| Contrôles Python | 24 / 24 |
| Build dbt | 19 modèles · 78 tests · 1 snapshot · 0 échec |
| Réconciliation | 0 unité · 0,00 € |
| Airflow | 1 DAG · 6 tâches · succès |

## Périmètre technique

| Niveau | Composants |
|---|---|
| Exécuté | Airflow, dbt Core, DuckDB, pipeline Python/SQLite, tests, rapprochements, application web |
| Émulé localement | API S3, Kinesis et CloudWatch via LocalStack |
| Compatible | protocole source Airbyte, handler de validation Lambda |
| Préparé pour la cible | profil Snowflake et infrastructure AWS Terraform |

Snowflake, AWS et MWAA ne sont pas déployés par ce dépôt. Terraform est validé sans `apply`. Le détail se trouve dans [l’état d’implémentation](docs/IMPLEMENTATION_STATUS.md).

## Orchestration

Le DAG `retail_core_daily` est planifié à 05:15 (`Europe/Paris`), avec deux reprises espacées de cinq minutes et un seul run actif.

```text
extract_sources
      ↓
stage_local_aws
      ↓
build_reference_warehouse
      ↓
dbt_build
      ↓
reconcile_platform
      ↓
publish_kpis
```

La publication est bloquée si une étape échoue ou si les rapprochements batch/Kinesis et ventes/paiements ne retombent pas à zéro.

## Modèles principaux

| Data product | Usage |
|---|---|
| `fct_sales` / `fct_payments` | source de vérité commerciale et rapprochement financier |
| `fct_retail_event` | parcours omnicanal et contrôle du flux temps réel |
| `dim_customer` | Golden Record pseudonymisé |
| `dim_product_price_scd2` | historique des prix |
| `snp_inventory_state` | historique des états de stock |
| `fct_available_to_promise` | stock promettable et niveau de risque |
| `mart_customer_rfm` | segmentation récence, fréquence, montant |
| `mart_repricing_candidates` | recommandations tarifaires explicables et bornées |

Formule ATP :

```text
stock magasin + stock entrepôt + entrant - réservations - unités vendues
```

## Démarrage

Cockpit seul :

```bash
docker compose up --build -d retail-core
```

Plateforme locale complète :

```bash
docker compose --profile platform up --build -d
make airflow-test
```

- cockpit : [http://127.0.0.1:8042](http://127.0.0.1:8042)
- Airflow : [http://127.0.0.1:8080](http://127.0.0.1:8080)
- API AWS locale : `http://127.0.0.1:4566`

Sans Docker :

```bash
python3 run_demo.py
python3 serve.py
```

## Qualité et CI

La CI exécute le pipeline de référence, les tests Python et JavaScript, `dbt build`, la validation Docker Compose, le build de l’image et la validation Terraform. Les règles couvrent notamment unicité, intégrité référentielle, domaines de valeurs, pseudonymisation, fraîcheur, SCD2, ATP et rapprochements financiers.

## Structure

```text
dags/                 orchestration Airflow
connectors/           source compatible Airbyte
src/                  ingestion, qualité, AWS local et publication
models/ dbt_tests/    transformations et contrôles dbt
snapshots/            historisation SCD2 des stocks
lambda/               validation événementielle compatible Lambda
infra/terraform/      infrastructure AWS cible
dashboard/            cockpit interactif sombre
tests/                tests automatisés
docs/                 architecture et état d’implémentation
```

## Documentation

- [Architecture et flux](docs/ARCHITECTURE.md)
- [État d’implémentation](docs/IMPLEMENTATION_STATUS.md)
