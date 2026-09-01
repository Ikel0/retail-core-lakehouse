# Guide entretien Data Engineer Retail

## Démonstration en 90 secondes

1. Je pars de six sources : produits, clients, stock, commandes, événements et historique de prix.
2. Je sépare les données brutes des données préparées et j’exécute les étapes dans un ordre déterministe.
3. Je construis les faits de ventes, les dimensions client/produit et l’inventaire.
4. Je calcule l’ATP et je vérifie que les événements streaming correspondent au batch.
5. Je publie les KPI et un rapport de qualité exploitable par les équipes data et métier.

## Questions à anticiper

- **Pourquoi SQLite ?** Pour rendre le prototype exécutable sans compte cloud ; la séparation des couches permet une migration vers S3, Snowflake ou Databricks.
- **Comment gérer les doublons Kinesis ?** Clé d’idempotence sur `event_id`, fenêtre de déduplication et réconciliation journalière.
- **Comment passer à l’échelle ?** Partitionnement par date et canal, traitements incrémentaux dbt, entrepôt séparé du stockage objet et limitation du compute.
- **Comment fiabiliser l’ATP ?** Contrats de schéma, tests de fraîcheur, contrôles de non-négativité et rapprochement quotidien avec la source comptable.
