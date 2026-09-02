# Déroulé de démonstration — Retail Core Lakehouse

## Objectif

Mon fil conducteur est simple : **partir d’un problème retail, montrer la décision métier, puis prouver que la chaîne data qui l’alimente est fiable**. Je présente le projet comme un produit data exécutable, pas comme une collection de technologies.

## Préparation avant l’échange

```bash
docker compose --profile platform up --build -d
make airflow-test
```

Je vérifie ensuite :

- le cockpit sur `http://127.0.0.1:8042` ;
- Airflow sur `http://127.0.0.1:8080` ;
- le DAG `retail_core_daily` en succès ;
- les filtres canal/période et la vue Pipeline & Ops ;
- l’absence d’erreur dans la console du navigateur.

Je garde deux onglets ouverts : le cockpit en premier, Airflow en second. Le dépôt GitHub reste disponible si l’interlocuteur souhaite approfondir le code.

## Introduction en 90 secondes

> J’ai construit un Retail Core Lakehouse qui rassemble huit flux : catalogue, clients, identités par canal, stocks, commandes, paiements, événements et historique de prix. Mon objectif était de produire une source de vérité omnicanale réellement contrôlée.
>
> Le pipeline est orchestré par Airflow. Il charge la zone Raw dans S3 local, valide et publie 3 160 événements dans Kinesis local, construit un modèle de référence, puis exécute un vrai dbt build sur DuckDB. La publication est bloquée si un contrôle échoue ou si les ventes ne retombent pas exactement sur le streaming et les paiements.
>
> Le résultat de référence compte 24 contrôles Python, 78 tests dbt, un snapshot SCD2 et deux rapprochements à zéro. Le cockpit rend ensuite ces données utiles pour la performance commerciale, l’ATP, le Customer 360, le RFM, le repricing et le pilotage FinOps.

## Démonstration guidée en 7 minutes

### 1. Vue d’ensemble — 45 secondes

Je montre le chiffre d’affaires, les commandes, l’ATP et le score qualité.

Formulation :

> Cette page répond d’abord aux questions métier. Tous les graphiques et les rapprochements utilisent le même filtre de canal et de période. Je peux donc passer du global au web ou au magasin sans comparer des périmètres différents.

Je change une fois le canal ou la période pour montrer que les KPI et les graphes réagissent réellement.

### 2. Double rapprochement — 45 secondes

Je descends sur la carte de réconciliation.

> Je contrôle deux invariants. Les unités des commandes batch doivent être égales aux unités des événements d’achat Kinesis. Le montant des ventes doit aussi être égal aux paiements soldés. Ici les deux écarts sont à zéro ; sinon le publishing gate ferme la publication.

### 3. Stock & ATP — 50 secondes

Je passe dans **Stock & ATP**, puis je recherche un produit.

> L’ATP ne correspond pas au stock physique brut. Je prends le magasin, l’entrepôt et les arrivages, puis je retire les réservations et les unités vendues. Le niveau de risque compare ensuite cet ATP au stock de sécurité. Cette vue sert à éviter la survente et à prioriser le réassort.

Je peux exporter le snapshot CSV pour montrer l’usage opérationnel.

### 4. Customer 360 — 50 secondes

> Chaque canal possède son identifiant client. Je les résous vers un Golden Record à partir d’un hash, sans exposer l’email dans les marts. Le modèle dbt calcule aussi un RFM par récence, fréquence et montant. Je conserve le consentement afin que les usages CRM restent gouvernés.

J’insiste sur la distinction entre `source_customer_id` et `customer_id`.

### 5. Temps réel — 45 secondes

> Les événements portent une clé d’idempotence et sont partitionnés par identifiant client source. Le profil complet envoie réellement 3 160 messages dans Kinesis via LocalStack et relit un échantillon du shard. La latence p95 alimente CloudWatch et une alarme locale.

Je précise que la liste dans GitHub Pages est un replay statique, tandis que le profil Docker exerce les API.

### 6. Pipeline & Ops — 1 minute 30

C’est la partie technique centrale.

> Le DAG Airflow 3.3.1 comporte six tâches séquentielles : source, AWS local, modèle de référence, dbt, rapprochement et publication. Il est planifié à 05:15 avec deux retries et un seul run actif, ce qui laisse une fenêtre avant le SLA de 08:00.
>
> dbt exécute 19 modèles, 78 tests et un snapshot. S3, Kinesis et CloudWatch sont appelés via LocalStack ; Snowflake reste volontairement marqué comme cible. Cette légende évite de confondre ce que j’ai exécuté, ce que j’ai émulé et ce que je déploierais en production.

J’ouvre ensuite l’onglet Airflow et montre le graphe ou le run en succès. Je n’ai pas besoin d’ouvrir tous les logs, sauf si l’on me le demande.

### 7. Qualité et SCD2 — 45 secondes

> La qualité n’est pas une note décorative. Les 24 contrats Python et les 78 tests dbt couvrent clés, relations, valeurs, identités, paiements, partitions et historique. Le SCD2 conserve les versions de prix et le snapshot dbt historise aussi l’état de stock.

### 8. Repricing et FinOps — 50 secondes

> Le mart de repricing combine demande et couverture ATP. Il protège la marge de 3 % en cas de forte demande avec stock critique, propose une baisse bornée à 5 % si le stock est élevé et maintient le prix sinon. Une assertion interdit de sortir de ces garde-fous.
>
> La vue FinOps est explicitement un scénario. Elle sert à discuter auto-suspend Snowflake, incrémental dbt, lifecycle S3, dimensionnement Kinesis et right-sizing Lambda. Je ne la présente jamais comme une facture réelle.

## Si l’on dispose seulement de 3 minutes

1. Vue d’ensemble et double rapprochement.
2. Stock & ATP ou Customer 360 selon le profil de l’interlocuteur.
3. Pipeline & Ops avec Airflow, dbt et la distinction exécuté/émulé/cible.
4. Conclusion sur le publishing gate.

## Questions techniques à anticiper

### Pourquoi DuckDB et pas Snowflake ?

> Je voulais que le build soit reproductible sans compte cloud. DuckDB exécute réellement les modèles et les tests dbt. Le profil Snowflake cible est fourni et les transformations restent dans dbt ; le passage à Snowflake concerne surtout la connexion, le dimensionnement, les rôles et l’optimisation du warehouse.

### Est-ce le vrai Airflow ?

> Oui. L’image repose sur Apache Airflow 3.3.1 et le DAG appelle les fonctions réelles. J’ai vérifié l’import sans erreur puis exécuté les six tâches dans Docker. Le mode standalone et l’accès admin simplifié sont réservés à la démonstration locale.

### Est-ce le vrai AWS ?

> Ce sont les SDK et API AWS exercés contre LocalStack. S3, Kinesis et CloudWatch sont donc réellement appelés, mais sur un endpoint local. Je ne revendique pas un déploiement sur un compte AWS réel. Terraform décrit la cible sécurisée.

### Comment gérez-vous les doublons ?

> `event_id` est la clé d’idempotence, `order_id` la clé du fait de vente, et les modèles incrémentaux utilisent `merge`. La réconciliation des identifiants et des unités détecte aussi une perte ou une duplication entre batch et streaming.

### Pourquoi partitionner par `source_customer_id` ?

> Au moment de l’ingestion, le Golden Record n’est pas toujours résolu. La clé source permet de préserver l’ordre dans le système émetteur. La couche d’identité convertit ensuite cette clé vers le `customer_id` canonique.

### Comment fiabiliser l’ATP ?

> Je contrôle la fraîcheur, les valeurs non négatives, l’intégrité produit et la formule. En production, j’ajouterais la réservation en temps réel, des événements compensatoires, une mesure de dérive par magasin et un rapprochement régulier avec le WMS.

### Que se passe-t-il si dbt échoue ?

> La tâche Airflow échoue et bénéficie des retries. La réconciliation n’est pas exécutée avec un faux succès et le manifeste n’est pas publié. Le rapport dbt liste les ressources en échec depuis `run_results.json`.

### Comment passer à l’échelle ?

> Je sépare stockage et compute, partitionne la Raw par date, garde les modèles lourds incrémentaux, dimensionne Kinesis avec marge, règle l’auto-suspend Snowflake et pilote le coût par domaine. J’ajouterais également des tests de charge et des SLO par flux.

### Qu’amélioreriez-vous en production ?

> Je brancherais les connecteurs réels, Secrets Manager, KMS et un réseau privé ; je déploierais Airflow sur MWAA ou une plateforme supervisée ; j’ajouterais DLQ, schema registry, alerting, lineage, data ownership et procédures d’astreinte.

## Ce qu’il faut dire avec précision

- **Exécuté** : Airflow, dbt, DuckDB, pipeline Python, tests et cockpit.
- **Émulé localement** : API S3, Kinesis et CloudWatch avec LocalStack.
- **Compatible** : source Airbyte et validation Lambda.
- **Cible** : compte AWS réel, Snowflake et MWAA.

Cette précision renforce la crédibilité. Elle montre que je sais distinguer prototype, preuve technique et exploitation de production.

## Conclusion en 20 secondes

> Ce projet montre ma façon de travailler : je pars d’un problème retail, je définis les grains et les invariants, j’automatise les contrôles, puis j’expose un produit utile et observable. La stack locale prouve le fonctionnement ; les profils Snowflake et Terraform montrent comment je l’industrialiserais.

## Plan de secours

Si Docker ou le réseau de démonstration pose problème, j’utilise la version GitHub Pages. Elle conserve les filtres, les KPI, les graphiques et les preuves du dernier profil complet. Je peux ensuite montrer les fichiers `dags/`, `models/`, `src/orchestration.py` et `infra/terraform/` directement dans GitHub.
