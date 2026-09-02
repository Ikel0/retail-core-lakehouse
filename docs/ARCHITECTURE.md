# Architecture — Retail Core Lakehouse

## Vue d’ensemble

J’ai structuré le projet autour de frontières proches d’une plateforme retail de production, tout en gardant une exécution locale gratuite et démontrable.

```text
                                  ┌─────────────────────────────────────┐
CRM · ERP · PLM · POS · e-commerce│  Sources synthétiques déterministes│
                                  └───────────────┬─────────────────────┘
                                                  │
                              ┌───────────────────▼───────────────────┐
                              │ Source compatible Airbyte             │
                              │ spec · check · discover · read        │
                              └───────────────┬───────────────────────┘
                                              │
                   ┌──────────────────────────┴──────────────────────────┐
                   │                                                     │
          ┌────────▼─────────┐                                 ┌────────▼─────────┐
          │ S3 Raw local     │                                 │ Validateur Lambda │
          │ partitions date  │                                 │ schéma + idempot. │
          └────────┬─────────┘                                 └────────┬─────────┘
                   │                                                    │
                   │                                           ┌────────▼─────────┐
                   │                                           │ Kinesis local     │
                   │                                           │ batch + relecture │
                   │                                           └────────┬─────────┘
                   └──────────────────────────┬──────────────────────────┘
                                              │
                              ┌───────────────▼────────────────┐
                              │ Apache Airflow 3.3.1           │
                              │ 6 tâches · retries · SLA 08:00 │
                              └───────────────┬────────────────┘
                                              │
                   ┌──────────────────────────┴──────────────────────────┐
                   │                                                     │
          ┌────────▼──────────┐                                ┌────────▼──────────┐
          │ Modèle référence  │                                │ dbt Core + DuckDB │
          │ Python + SQLite   │                                │ 19 modèles        │
          │ 24 contrôles      │                                │ 78 tests + SCD2   │
          └────────┬──────────┘                                └────────┬──────────┘
                   └──────────────────────────┬──────────────────────────┘
                                              │
                              ┌───────────────▼────────────────┐
                              │ Double réconciliation          │
                              │ unités : 0 · paiements : 0 €  │
                              └───────────────┬────────────────┘
                                              │
                              ┌───────────────▼────────────────┐
                              │ Retail Data Product            │
                              │ KPI · ATP · RFM · repricing    │
                              └────────────────────────────────┘
```

LocalStack fournit les API S3, Kinesis et CloudWatch. La validation Lambda-compatible est exécutée dans le chemin événementiel local. DuckDB est l’adapter dbt d’exécution ; le profil Snowflake fourni représente le warehouse cible.

## Séquence orchestrée

Le DAG `retail_core_daily` impose l’ordre suivant :

1. `extract_sources_task` génère les sources puis vérifie le contrat Airbyte-compatible.
2. `stage_local_aws_task` archive les huit sources dans S3 local, valide les événements, les publie dans Kinesis et alimente CloudWatch.
3. `build_reference_warehouse_task` construit un modèle de contrôle indépendant dans SQLite et exécute 24 règles.
4. `dbt_build_task` prépare huit vues Raw dans DuckDB et lance réellement `dbt build`.
5. `reconcile_platform_task` compare batch/Kinesis et ventes/paiements, puis agrège les statuts des chemins activés.
6. `publish_kpis_task` publie le manifeste uniquement si tous les invariants sont conformes.

Le DAG est planifié à 05:15 Europe/Paris, avec deux retries de cinq minutes, `catchup=False` et un seul run actif. Cette configuration laisse une fenêtre de reprise avant le SLA de mise à disposition à 08:00.

## Couches dbt

```text
raw (8 vues CSV)
  └── staging
      ├── commandes · produits · clients · identités
      └── stocks · paiements · événements · prix
          └── intermediate
              └── résolution source_customer_id → customer_id
                  └── marts
                      ├── dimensions produit, client et prix SCD2
                      ├── ventes, paiements et événements
                      ├── ATP et rapprochement des paiements
                      ├── segmentation RFM
                      └── candidats au repricing
```

Les faits de ventes et d’événements sont incrémentaux avec stratégie `merge`. Le snapshot `snp_inventory_state` conserve l’évolution des états de stock. Les tests génériques, singuliers et unitaires constituent un second niveau de contrôle indépendant du pipeline Python.

## Grains et clés

| Objet | Grain | Clé ou invariant |
|---|---|---|
| `fct_sales` | Une commande | `order_id` unique |
| `fct_payments` | Une transaction | un paiement soldé par commande |
| `fct_retail_event` | Un événement | `event_id` unique |
| `bridge_customer_identity` | Une identité source | `source_customer_id` résolu |
| `dim_product_price_scd2` | Une version de prix | une seule version courante par produit |
| `snp_inventory_state` | Une version d’état de stock | période dbt valide |
| `fct_available_to_promise` | Un produit | ATP non négatif |

La clé de partition Kinesis est `source_customer_id`. Elle conserve l’ordre du parcours dans chaque système source avant la résolution vers le Golden Record `customer_id`. `event_id` est la clé d’idempotence.

## Sécurité et gouvernance

- les emails ne sont pas exposés en clair dans les données analytiques ;
- le compte AWS réel est bloqué par défaut dans le code local ;
- S3 cible est privé, versionné, chiffré et doté d’un lifecycle ;
- le rôle Lambda Terraform applique une politique d’accès limitée aux ressources nécessaires ;
- les secrets Snowflake sont lus par variables d’environnement ;
- l’accès administrateur automatique d’Airflow est limité au profil local ;
- aucun KPI n’est publié si le publishing gate échoue.

## Observabilité et FinOps

L’exécution locale publie trois métriques CloudWatch : objets Raw, événements publiés et latence p95. Elle crée également un log de run et une alarme de latence. La stack Terraform ajoute des alarmes sur le throttling Kinesis et les erreurs Lambda.

Les leviers FinOps documentés sont le lifecycle S3, le dimensionnement des shards, les modèles dbt incrémentaux, l’auto-suspend Snowflake et le right-sizing Lambda. Le cockpit sépare les mesures exécutées des hypothèses de coût : il ne présente jamais une estimation comme une facture réelle.

## Passage en production

| Local démontrable | Cible de production |
|---|---|
| CSV Raw | Connecteurs SaaS/ERP et S3 |
| LocalStack | Compte AWS cloisonné par environnement |
| DuckDB | Snowflake |
| Airflow standalone | MWAA ou plateforme Airflow supervisée |
| identifiants de test | IAM, Secrets Manager et KMS dédiés |
| exécution sur un poste | CI/CD, réseau privé, alerting et astreinte |

Les transformations métier restent dans dbt et les étapes restent appelées par le même DAG. Le passage en production concerne donc principalement les adapters, les connexions, la sécurité, le dimensionnement et les procédures d’exploitation.
