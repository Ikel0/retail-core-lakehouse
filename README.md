# Retail Core Lakehouse

[![CI](https://github.com/Ikel0/retail-core-lakehouse/actions/workflows/ci.yml/badge.svg)](https://github.com/Ikel0/retail-core-lakehouse/actions/workflows/ci.yml)

J’ai conçu ce produit data pour réunir ventes omnicanales, identité client, catalogue, prix, paiements et stocks dans une source de vérité retail contrôlée. Le projet ne se limite pas à un dashboard : un DAG Apache Airflow exécute l’ingestion, les API AWS locales, le modèle de référence, `dbt build`, les rapprochements métier et le publishing gate.

**Démonstration interactive :** [Retail Core Command Center](https://ikel0.github.io/retail-core-lakehouse/)

## Résultat vérifié

| Indicateur | Résultat du profil complet |
|---|---:|
| Sources ingérées | 8 flux · 5 928 lignes |
| Ventes / paiements | 960 / 960 |
| Identités réconciliées | 640 liens vers 160 Golden Records |
| Événements retail | 3 160 publiés dans Kinesis local |
| Contrôles Python | 24 / 24 réussis |
| Build dbt | 19 modèles · 78 tests · 1 snapshot · 0 échec |
| Réconciliation | 0 unité · 0,00 € |
| Orchestration | DAG Airflow 3.3.1 · 6 tâches · succès |

Les données sont synthétiques, déterministes et sans information personnelle réelle.

## Architecture

```text
CRM / ERP / PLM / POS / e-commerce
              │
              ├── connecteur source compatible Airbyte ──> S3 Raw (LocalStack)
              │
              └── événements ──> validation Lambda ──> Kinesis (LocalStack)
                                                        │
Apache Airflow 3.3.1 ───────────────────────────────────┤
  05:15 Europe/Paris · retries · ordre · publishing gate│
                                                        ▼
                           DuckDB local ──> dbt Core ──> Retail Marts
                                              │
                           tests + snapshot SCD2 + documentation
                                              │
                                              ▼
                      ATP · Customer 360 · KPI · cockpit interactif

Cible de production : S3 / Kinesis / Lambda / CloudWatch + Snowflake
                      provisionnés par Terraform et orchestrés par Airflow/MWAA
```

## Ce qui est réellement exécuté

| Composant | Niveau de preuve |
|---|---|
| Apache Airflow 3.3.1 | Image officielle, DAG importé sans erreur et six tâches exécutées |
| dbt Core + DuckDB | `dbt build` réel : staging, intermédiaire, marts, tests et snapshot SCD2 |
| Airbyte | Source locale compatible avec les commandes `spec`, `check`, `discover` et `read` |
| AWS S3 | Huit fichiers Raw chargés par l’API S3 dans LocalStack |
| Amazon Kinesis | 3 160 événements écrits par lots et relus depuis un shard local |
| AWS Lambda | Validation de schéma, versionnement et clé d’idempotence appliqués aux événements |
| CloudWatch | Métriques, logs et alarme de latence créés via les API AWS locales |
| Terraform | Stack AWS cible : S3, Kinesis, Lambda, IAM et CloudWatch |
| Snowflake | Profil dbt cible fourni ; aucun compte Snowflake n’est simulé ni revendiqué |

LocalStack émule les API AWS sur la machine. DuckDB remplace Snowflake pour rendre le build gratuit et reproductible. Ces substitutions sont explicites dans le code, le cockpit et la documentation.

## Démarrage rapide

### Cockpit uniquement

```bash
docker compose up --build -d retail-core
```

Ouvrir [http://127.0.0.1:8042](http://127.0.0.1:8042).

### Plateforme complète avec Airflow et AWS local

```bash
docker compose --profile platform up --build -d
make airflow-test
```

- Cockpit : [http://127.0.0.1:8042](http://127.0.0.1:8042)
- Airflow : [http://127.0.0.1:8080](http://127.0.0.1:8080)
- Endpoint AWS local : `http://127.0.0.1:4566`

Le mode administrateur automatique d’Airflow est réservé à cette démonstration locale. Il ne doit pas être utilisé en production.

Pour arrêter les services :

```bash
docker compose --profile platform down
```

### Exécutions ciblées

```bash
make dbt-docker       # dbt build dans une image isolée
make aws-local        # S3, Kinesis, Lambda et CloudWatch via LocalStack
make test             # tests Python rapides
make terraform-validate
```

Sans Docker, le chemin de référence reste disponible avec `python3 run_demo.py`, puis `python3 serve.py`.

## DAG Airflow

Le DAG `retail_core_daily` est planifié à 05:15, heure de Paris, afin de conserver une fenêtre de reprise avant le SLA métier de 08:00. Il impose un seul run actif et deux retries espacés de cinq minutes.

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

La dernière tâche ne publie rien si un test, une étape activée, le rapprochement batch/Kinesis ou le rapprochement ventes/paiements échoue.

## Modèle retail

Les huit sources représentent le catalogue, les clients, les identités par canal, les stocks, les commandes, les paiements, les événements et l’historique des prix. Elles alimentent notamment :

- `dim_product` et ses hiérarchies produit ;
- `dim_customer` et le Golden Record pseudonymisé ;
- `dim_product_price_scd2` pour l’historique des prix ;
- `fct_sales`, `fct_payments` et leur rapprochement ;
- `fct_retail_event` pour le flux omnicanal ;
- `fct_available_to_promise` pour l’ATP ;
- `snp_inventory_state` pour l’historisation SCD2 des états de stock.

Le calcul ATP est :

```text
stock magasin + stock entrepôt + entrant - réservations - unités vendues
```

## Fiabilité et exploitation

Les contrôles couvrent l’unicité, les références, les domaines de valeurs, la résolution d’identité, la pseudonymisation, les paiements, la fraîcheur, les partitions Kinesis et les périodes SCD2. Les tests dbt complètent ces contrats au niveau staging et marts, avec notamment des assertions singulières sur l’ATP, les identités et les deux rapprochements.

Le cockpit présente sept angles : performance commerciale, événements, ATP, Customer 360, plateforme, qualité/SCD2 et FinOps. Les filtres canal/période recalculent les ventes, événements, clients, demande stock et rapprochements sur le même périmètre. Le stock physique reste volontairement un instantané réseau ; la vue ATP affiche séparément la demande filtrée et sa couverture estimée. Sur les vues Pipeline & Ops et FinOps, les sélecteurs sont remplacés par un indicateur « périmètre global », car un run complet et un scénario d’infrastructure ne dépendent pas d’un canal de vente.

## Structure du dépôt

```text
dags/                 DAG Airflow réel
connectors/           source compatible Airbyte
src/                  génération, pipeline, dbt runner, orchestration, AWS local
models/ dbt_tests/    modèles, tests et unité dbt
snapshots/            SCD2 des états de stock
lambda/               validation événementielle
infra/terraform/      infrastructure AWS cible
dashboard/            cockpit sombre et responsive
tests/                tests automatisés
docs/                 architecture, guide et déroulé de démonstration
```

## Documentation

- [Architecture et flux](docs/ARCHITECTURE.md)
- [Guide fonctionnel et technique](docs/PROJECT_GUIDE.md)
- [Matrice exigences / preuves](docs/IMPLEMENTATION_MATRIX.md)
- [Déroulé de démonstration](docs/DEMO_RUNBOOK.md)
- [Dossier professionnel](docs/Retail_Core_Lakehouse_Ikel_Ouedraogo.docx)

Ce projet montre une démarche de Data Engineer orientée produit : partir des décisions métier, définir les grains et les invariants, automatiser les preuves, puis rendre l’ensemble observable et déployable.
