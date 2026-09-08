# État d’implémentation

| Capacité | Statut | Résultat |
|---|---|---|
| Sources retail | Exécuté | 8 fichiers · 5 928 lignes |
| Orchestration Airflow | Exécuté | 6 tâches, reprises et barrière de publication |
| Transformations dbt | Exécuté | 19 modèles · 78 tests · 1 snapshot |
| Warehouse local | Exécuté | DuckDB pour dbt, SQLite pour le contrôle indépendant |
| Identité client | Exécuté | 640 identités vers 160 Golden Records |
| Stock et ATP | Exécuté | disponibilité et risque pour 12 produits |
| Réconciliation | Exécuté | 0 unité et 0,00 € d’écart |
| S3 / Kinesis / CloudWatch | Émulé localement | API appelées via LocalStack |
| Validation Lambda-compatible | Exécuté localement | 3 160 événements contrôlés |
| Application | Exécuté | 4 vues · 12 combinaisons canal/période |
| Docker et CI | Exécuté | tests, build dbt, image et validation Compose |
| Terraform AWS | Cible validée | configuration vérifiée, non déployée |

**Exécuté** signifie que le composant tourne dans le profil local ou la CI.

**Émulé localement** signifie que le code appelle une API compatible fournie par LocalStack.

**Cible** signifie que la configuration existe sans revendiquer un déploiement externe.
