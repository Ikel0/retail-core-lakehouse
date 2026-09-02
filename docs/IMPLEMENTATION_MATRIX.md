# Matrice exigences / preuves

Cette matrice distingue les fonctions exécutées, les API émulées localement et les composants préparés pour la cible. Elle permet de retrouver rapidement chaque preuve dans le dépôt.

| Capacité | Niveau | Preuve dans le projet | Résultat vérifiable |
|---|---|---|---|
| Lakehouse AWS | Émulé localement + cible IaC | `src/aws_local.py`, `infra/terraform/` | Raw S3 partitionnée ; bucket cible privé, chiffré, versionné et lifecycle |
| Ingestion Airbyte | Compatible et exécutée | `connectors/source_retail/` | `spec`, `check`, `discover`, `read` ; 8 flux, 5 928 lignes |
| Prétraitement Lambda | Exécuté localement + cible IaC | `lambda/validate_kinesis_event.py` | 3 160 événements validés, versionnés et dotés d’une clé d’idempotence |
| Streaming Kinesis | API émulée localement | `src/aws_local.py` | 3 160 écritures par lots, 0 échec et relecture du shard |
| Snowflake / Databricks | Snowflake cible | `profiles/snowflake.example.yml` | profil sécurisé par variables d’environnement ; aucune fausse exécution cloud |
| dbt Core | Exécuté | `models/`, `dbt_tests/`, `snapshots/`, `src/dbt_runner.py` | 19 modèles, 78 tests, 1 snapshot, 0 échec |
| Tests unitaires dbt | Exécuté | `models/marts/schema.yml` | formule ATP vérifiée sur un cas contrôlé |
| Documentation dbt | Implémentée | descriptions YAML dans `models/` | sources, modèles, colonnes et tests documentés |
| Versionnement Git | Implémenté | historique Git et workflow CI | changements traçables et contrôles automatiques |
| SCD des prix | Exécuté | `dim_product_price_scd2.sql` | 24 versions ; une seule version courante par produit |
| SCD des stocks | Exécuté | `snapshots/snp_inventory_state.sql` | snapshot check-strategy sur l’état d’inventaire |
| Airflow DAG | Exécuté | `dags/retail_core_daily.py` | 6 tâches réelles, import sans erreur et run en succès |
| Ordre et retries | Implémenté | DAG Airflow | séquence stricte, 2 retries, délai 5 minutes, 1 run actif |
| KPI disponibles avant 08:00 | Implémenté | DAG + manifeste | départ 05:15 Europe/Paris, SLA déclaré 08:00 |
| Réconciliation Kinesis / batch | Exécutée | `quality.py`, test dbt singulier | écart de commandes, identifiants et unités égal à zéro |
| Réconciliation paiements / ventes | Exécutée | `fct_payment_reconciliation.sql` | 960 paiements soldés, écart 0,00 € |
| S3 / IAM / CloudWatch | Émulé + cible IaC | `src/aws_local.py`, Terraform | objets Raw, 3 métriques, log, alarme et rôle à privilèges limités |
| Hiérarchies produit | Exécuté | `dim_product.sql` | produit, catégorie, département et collection |
| Identité omnicanale | Exécutée | `int_customer_identity_resolution.sql`, `dim_customer.sql` | 640 identités CRM/web/POS/marketplace vers 160 Golden Records |
| Protection PII | Exécutée | génération, qualité, modèle client | email hashé et contrat de forme du hash |
| Available to Promise | Exécuté | `fct_available_to_promise.sql` | ATP et niveau de risque pour 12 produits |
| Segmentation RFM | Exécutée | `mart_customer_rfm.sql` | scores R/F/M et cinq segments contrôlés |
| Repricing | Exécuté | `mart_repricing_candidates.sql` | recommandation explicable, bornée entre -5 % et +3 % |
| SQL avancé | Exécuté | modèles dbt | incrémental, fenêtres, CTE, SCD, rapprochements et marts |
| Python Data Engineering | Exécuté | `src/`, `connectors/`, `lambda/` | génération, ingestion, qualité, orchestration, API AWS et serveur |
| Monitoring de latence | Exécuté localement | pipeline + CloudWatch local | p95 calculée, métrique et alarme à 3 secondes |
| FinOps | Modèle contrôlé + IaC | cockpit, Terraform, dbt incrémental | budget explicite, lifecycle S3, capacity planning et leviers d’optimisation |
| Dockerisation | Exécutée | cinq Dockerfiles et Compose | cockpit, Airflow, dbt, outils AWS et connecteur source isolés |
| CI/CD | Implémentée | `.github/workflows/ci.yml` | tests Python, dbt, Terraform et build statique |

## Légende

- **Exécuté** : le composant ou la règle tourne réellement dans le profil local.
- **Émulé localement** : le code appelle une API compatible AWS fournie par LocalStack.
- **Compatible** : l’interface ou le protocole attendu est implémenté et testé localement.
- **Cible** : la configuration de production est fournie, mais aucun compte externe n’est présenté comme exécuté.

## Limites importantes

Le dépôt ne contient ni credentials, ni données d’entreprise, ni preuve inventée d’un déploiement AWS/Snowflake. Les optimisations de coût Lambda et Snowflake sont des décisions de cible ; elles devront être mesurées avec les volumes et tarifs du futur environnement.
