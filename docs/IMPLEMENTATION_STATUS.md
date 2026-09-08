# État d’implémentation

Cette page sépare explicitement ce qui tourne dans le projet local de ce qui constitue une cible de déploiement.

## Composants

| Capacité | Statut | Implémentation et résultat |
|---|---|---|
| Ingestion batch | Exécuté | Source compatible Airbyte (`spec`, `check`, `discover`, `read`) ; 8 flux et 5 928 lignes |
| Stockage Raw | Émulé localement | 8 objets partitionnés chargés par l’API S3 de LocalStack |
| Streaming | Émulé localement | 3 160 événements publiés par lots dans Kinesis puis relus depuis le shard |
| Validation événementielle | Compatible et exécuté | Le handler Lambda-compatible contrôle schéma, version et idempotence dans le processus local |
| Orchestration | Exécuté | DAG Airflow de 6 tâches, reprises, ordre strict et barrière de publication |
| Transformations | Exécuté | dbt Core sur DuckDB : 19 modèles, 78 tests et 1 snapshot SCD2 |
| Modèle de contrôle | Exécuté | Pipeline Python/SQLite indépendant et 24 règles de qualité |
| Identité client | Exécuté | 640 identités de canal rattachées à 160 Golden Records pseudonymisés |
| Stock et ATP | Exécuté | ATP par produit, couverture de demande et niveau de risque |
| Marketing et pricing | Exécuté | segmentation RFM et recommandations de prix bornées de -5 % à +3 % |
| Réconciliations | Exécuté | écart batch/Kinesis de 0 unité et écart ventes/paiements de 0,00 € |
| Observabilité | Émulé localement | métriques, journal de run et alarme de latence via CloudWatch LocalStack |
| Application | Exécuté | 7 vues, 12 combinaisons canal/période et simulateur de capacité déterministe |
| Conteneurisation et CI | Exécuté | images Docker, Compose et quality gate automatisé |
| Infrastructure AWS | Cible validée | Terraform décrit S3, Kinesis, Lambda, IAM et CloudWatch ; validation sans déploiement |
| Snowflake | Cible configurée | profil dbt par variables d’environnement ; aucun compte ni crédit Snowflake requis localement |
| MWAA | Cible d’exploitation | le DAG est portable vers un Airflow managé, mais MWAA n’est pas provisionné |

## Définitions

- **Exécuté** : le composant tourne réellement dans le profil local ou dans la CI.
- **Émulé localement** : le code appelle une API compatible fournie par LocalStack.
- **Compatible** : l’interface cible est implémentée et testée sans service cloud déployé.
- **Cible** : la configuration est présente, mais aucun environnement externe n’est revendiqué comme exécuté.

## Limites connues

- les sources sont synthétiques et couvrent 30 jours ;
- l’exécution locale est mono-nœud ;
- les coûts affichés sont des scénarios de capacité, pas des factures cloud ;
- un déploiement réel nécessiterait secrets, réseau, observabilité et procédures propres à l’organisation.
