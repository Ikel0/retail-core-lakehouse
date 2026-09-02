# Retail Core Lakehouse

## Dossier fonctionnel et technique

**Auteur : Ikel Ouedraogo — Data Engineer**  
**Nature : produit data retail omnicanal, exécutable localement et transposable vers AWS/Snowflake**

## 1. Résumé exécutif

J’ai construit ce projet pour résoudre un problème fréquent dans le retail : les commandes, paiements, clients, produits, stocks et événements digitaux vivent dans des systèmes différents et ne produisent pas toujours le même chiffre.

La plateforme rassemble huit flux dans un Retail Core Model, résout les identités clients entre quatre systèmes, calcule le stock disponible à la vente, rapproche le temps réel avec le batch et les paiements avec les ventes, puis bloque toute publication si une preuve de qualité échoue.

Le profil complet est réellement orchestré par Apache Airflow 3.3.1. Il exerce les API S3, Kinesis et CloudWatch dans LocalStack, applique un validateur Lambda-compatible, exécute `dbt build` sur DuckDB et produit un manifeste de publication auditable.

Résultat de référence :

- 8 flux et 5 928 lignes sources ;
- 960 commandes et 960 paiements ;
- 3 160 événements retail ;
- 640 identités sources rattachées à 160 Golden Records ;
- 24 contrôles Python réussis ;
- 19 modèles, 78 tests et 1 snapshot dbt, sans échec ;
- 0 unité d’écart entre batch et Kinesis ;
- 0,00 € d’écart entre ventes et paiements.

Toutes les données sont synthétiques. Aucune donnée client ou entreprise réelle n’est utilisée.

## 2. Problème métier

Un retailer omnicanal doit pouvoir répondre rapidement et sans ambiguïté à cinq questions :

1. Combien avons-nous vendu, sur quel canal et dans quelle catégorie ?
2. Les achats visibles dans le flux événementiel correspondent-ils au batch comptable ?
3. Les montants encaissés correspondent-ils aux commandes enregistrées ?
4. Quel stock pouvons-nous encore promettre au client ?
5. Un identifiant CRM, web, POS et marketplace représente-t-il la même personne ?

Le projet traite ces questions comme les responsabilités d’un produit data : grains explicites, contrats, SLA, observabilité, reprise, coût et documentation.

## 3. Données

| Source | Volume | Grain | Champs clés | Rôle métier |
|---|---:|---|---|---|
| `products.csv` | 12 | un produit | catégorie, département, collection, prix | hiérarchie et catalogue |
| `customers.csv` | 160 | un Golden Record | hash email, fidélité, pays, consentement | Customer 360 |
| `customer_identities.csv` | 640 | une identité par système | source, source customer ID, hash | résolution CRM/web/POS/marketplace |
| `stock.csv` | 12 | un état de stock produit | magasin, entrepôt, réservé, entrant, sécurité | ATP et risque de rupture |
| `orders.csv` | 960 | une commande | canal, produit, quantité, prix, remise | performance commerciale |
| `payments.csv` | 960 | une transaction | commande, montant, statut, moyen | rapprochement financier |
| `stream_events.csv` | 3 160 | un événement | type, partition, latence, horodatage | parcours et quasi temps réel |
| `price_history.csv` | 24 | une version de prix | début, fin, prix, version courante | SCD Type 2 et repricing |

Les commandes et événements portent d’abord `source_customer_id`. La table de correspondance utilise le hash email pour les rattacher au `customer_id` canonique. Cela sépare correctement l’identité opérationnelle de l’identité analytique.

## 4. Parcours de la donnée

### 4.1 Ingestion compatible Airbyte

La source `connectors/source_retail` implémente les opérations essentielles du protocole :

- `spec` décrit la configuration ;
- `check` vérifie les huit fichiers attendus ;
- `discover` expose le catalogue et les schémas JSON ;
- `read` émet des messages `RECORD` et un état final au format JSON Lines.

Le DAG réutilise le même inventaire de source. La logique testée par la commande locale n’est donc pas une maquette séparée de l’orchestration.

### 4.2 Zone Raw S3

Quand le profil AWS local est activé, chaque fichier est envoyé par l’API S3 dans une clé de la forme :

```text
raw/<source>/ingestion_date=YYYY-MM-DD/<source>.csv
```

Ce partitionnement rend les reprises et la rétention explicites. Le module refuse tout endpoint AWS non local, sauf autorisation volontaire, ce qui évite un envoi accidentel vers un compte réel.

### 4.3 Validation Lambda-compatible et Kinesis

Le validateur vérifie les champs obligatoires, le timestamp, la version de schéma et la clé d’idempotence. Les événements conformes sont ensuite publiés par lots de 500 dans Kinesis avec `source_customer_id` comme clé de partition.

Cette clé conserve l’ordre du parcours dans un système source. La résolution vers le Golden Record intervient après ingestion. Dix enregistrements sont relus depuis le shard afin de vérifier que le flux n’est pas seulement déclaré mais utilisable.

### 4.4 Modèle de référence

Le pipeline Python/SQLite fournit un oracle simple, rapide et indépendant de dbt. Il construit huit tables cœur, calcule les KPI, exécute 24 contrôles et écrit un rapport JSON. Cette double implémentation permet de comparer les résultats au lieu de faire dépendre toutes les preuves du même moteur.

### 4.5 Transformation dbt

`src/dbt_runner.py` crée huit vues Raw persistantes dans DuckDB, puis lance le vrai exécutable dbt. Le résumé est calculé depuis `target/run_results.json`, pas depuis une valeur codée dans l’interface.

Le projet dbt comprend :

- 8 modèles staging typés ;
- 1 modèle intermédiaire de résolution d’identité ;
- 10 modèles métier ;
- 78 tests génériques, singuliers et unitaires ;
- 1 snapshot SCD2 sur l’état du stock.

Les faits de ventes et d’événements sont incrémentaux avec une stratégie `merge`. Les clés `order_id` et `event_id` rendent les reprises idempotentes.

## 5. Orchestration Airflow

Le DAG `retail_core_daily` exécute six tâches dans un ordre strict :

```text
extract_sources_task
  → stage_local_aws_task
  → build_reference_warehouse_task
  → dbt_build_task
  → reconcile_platform_task
  → publish_kpis_task
```

Paramètres opérationnels :

| Paramètre | Valeur | Justification |
|---|---|---|
| Planification | 05:15 Europe/Paris | marge avant le SLA de 08:00 |
| Retries | 2 | absorber une indisponibilité temporaire |
| Délai de retry | 5 minutes | éviter une boucle agressive |
| Runs actifs | 1 maximum | prévenir les écritures concurrentes |
| Catchup | désactivé | démonstration quotidienne contrôlée |

Chaque tâche appelle une fonction réutilisable de `src/orchestration.py`. Je peux donc la tester hors Airflow, puis vérifier le même chemin dans Airflow. Le publishing gate agrège les statuts du modèle Python, de dbt et du profil AWS activé.

## 6. Modèle de données

### Dimensions

- `dim_product` : produit, catégorie, département, collection et prix courant ;
- `dim_customer` : Golden Record pseudonymisé et nombre d’identités résolues ;
- `dim_product_price_scd2` : historique des prix avec périodes non chevauchantes.

### Faits

- `fct_sales` : une commande omnicanale ;
- `fct_payments` : une transaction ;
- `fct_payment_reconciliation` : comparaison commande par commande ;
- `fct_retail_event` : un événement enrichi du client canonique ;
- `fct_available_to_promise` : disponibilité et niveau de risque par produit.

### Marts de décision

- `mart_customer_rfm` calcule récence, fréquence, montant, scores quartiles et segment ;
- `mart_repricing_candidates` combine demande, ATP, couverture, remise et prix réalisé pour produire une action explicable.

## 7. KPI et règles métier

| KPI | Définition | Décision soutenue |
|---|---|---|
| Chiffre d’affaires | somme de `sales_amount` | piloter la performance |
| Commandes | nombre d’`order_id` | mesurer l’activité |
| Panier moyen | CA / commandes | suivre la valeur d’achat |
| Clients actifs | clients distincts ayant commandé | mesurer l’engagement |
| ATP | magasin + entrepôt + entrant - réservé - vendu | éviter la survente |
| Risque de rupture | ATP comparé au stock de sécurité | prioriser le réassort |
| Latence p95 | 95 % des événements sous le seuil | suivre le SLA streaming |
| Écart unités | batch - achats Kinesis | garantir l’exhaustivité |
| Écart paiements | ventes - paiements soldés | garantir le chiffre encaissé |
| Score qualité | contrôles réussis / exécutés | ouvrir ou fermer la publication |

### Available to Promise

```text
ATP = stock magasin + stock entrepôt + réapprovisionnement entrant
      - réservations - unités vendues
```

- `critical` si l’ATP est inférieur au stock de sécurité ;
- `watch` s’il est inférieur à deux fois ce seuil ;
- `healthy` sinon.

### Repricing

La recommandation reste volontairement lisible :

- `protect_margin` : +3 % si la demande est élevée et l’ATP critique ;
- `accelerate_sell_through` : -5 % si la couverture est forte et la demande faible ;
- `hold` : maintien du prix dans les autres cas.

Un test singulier interdit toute recommandation en dehors de ces garde-fous. Ce mart fournit une base contrôlable ; il ne prétend pas remplacer un moteur de pricing ou une validation métier.

### RFM

La récence, la fréquence et le montant sont chacun scorés de 1 à 4 avec des quartiles. La somme et la combinaison des scores produisent les segments `champions`, `loyal`, `promising`, `at_risk` et `developing`.

## 8. Qualité et gouvernance

Les 24 contrôles Python couvrent :

- unicité des commandes, événements, paiements et identités ;
- intégrité produit, identité et paiement ;
- quantités, montants et taux de remise ;
- égalité du nombre, des identifiants et des unités entre batch et flux ;
- cohérence des clés de partition ;
- un paiement soldé par commande et égalité des montants ;
- format des hashes d’email ;
- version courante et périodes SCD2 ;
- fraîcheur du dernier événement.

dbt réexécute des garanties au plus près des modèles : contraintes de clés, relations, valeurs acceptées, ATP non négatif, identité complète, paiements exacts, batch/stream exact et prix recommandé borné.

Une seule non-conformité ferme le publishing gate. La publication n’est donc jamais un simple effet visuel du dashboard.

## 9. AWS local et infrastructure cible

Le profil LocalStack appelle les mêmes SDK et formes d’API que la cible pour :

- créer un bucket et charger les partitions Raw ;
- créer un stream Kinesis et écrire les événements ;
- relire des messages depuis un shard ;
- publier trois métriques CloudWatch ;
- créer une alarme et un log de pipeline.

Terraform décrit la cible AWS avec :

- bucket S3 privé, versionné, chiffré et lifecycle ;
- stream Kinesis chiffré et métriques par shard ;
- fonction Lambda Python 3.12 ;
- rôle et politique IAM à privilèges limités ;
- rétention des logs et alarmes CloudWatch.

Snowflake est traité honnêtement comme la cible de warehouse : un profil dbt d’exemple utilise uniquement des variables d’environnement. L’exécution de démonstration reste sur DuckDB.

## 10. Cockpit interactif

Le cockpit sombre et responsive propose sept vues :

1. performance commerciale et mix omnicanal ;
2. événements, latence et résilience ;
3. ATP, risque et export stock ;
4. Customer 360, consentement et segmentation ;
5. preuves Airflow/dbt/AWS et architecture cible ;
6. qualité, double rapprochement et SCD2 ;
7. FinOps et simulation Black Friday.

Les filtres de canal et de période recalculent ventes, événements, clients, séries et rapprochements sur le même périmètre. La version GitHub Pages embarque les combinaisons nécessaires pour conserver cette interaction sans backend.

## 11. FinOps et capacité

Le scénario FinOps est un modèle pédagogique explicite, jamais présenté comme une facture. Il additionne compute, streaming, orchestration et stockage, puis le compare à un budget.

La simulation Black Friday applique un multiplicateur de 2 à 12 à une hypothèse nominale de 42 événements par seconde. Elle estime la capacité avec 25 % de marge, la latence p95 et le surcoût, tout en conservant l’invariant de rapprochement. Aucun trafic cloud réel n’est lancé par cette simulation.

## 12. Exécution

### Cockpit

```bash
docker compose up --build -d retail-core
```

### Plateforme complète

```bash
docker compose --profile platform up --build -d
make airflow-test
```

### Contrôles ciblés

```bash
make test
make dbt-docker
make aws-local
make terraform-validate
```

Les points d’accès sont `8042` pour le cockpit, `8080` pour Airflow et `4566` pour les API AWS locales.

## 13. Rapports produits

| Rapport | Contenu |
|---|---|
| `quality_report.json` | 24 contrôles, KPI, phases et rapprochements |
| `airbyte_source_report.json` | catalogue, volumes et schémas des huit flux |
| `aws_local_report.json` | objets S3, événements Kinesis, validation et métriques |
| `dbt_run_report.json` | résultat lu depuis `run_results.json` |
| `platform_reconciliation.json` | décision globale du publishing gate |
| `publish_manifest.json` | artefacts publiés et SLA |

Ces fichiers sont des artefacts d’exécution locaux et ne sont pas versionnés. La version statique du cockpit embarque uniquement les valeurs utiles à la démonstration.

## 14. Tests et CI

La suite rapide vérifie le pipeline, les règles métier, les filtres et graphiques, la formule ATP, le modèle de coût, la source Airbyte-compatible, le handler Lambda, le contrat du DAG et les ressources Terraform. La CI ajoute le `dbt build` complet, le formatage/validation Terraform et la génération du site statique.

Cette séparation garde les tests unitaires rapides tout en conservant une preuve d’intégration plus complète.

## 15. Limites assumées

- LocalStack émule AWS ; il ne reproduit pas toutes les contraintes d’un compte de production.
- DuckDB exécute dbt localement ; Snowflake reste à connecter avec des secrets et un réseau réels.
- La source Airbyte-compatible lit des fichiers synthétiques ; les connecteurs CRM/ERP réels nécessitent leurs API et leur authentification.
- La simulation de capacité n’est pas un test de charge distribué.
- Le repricing fournit une recommandation contrôlée, pas une décision automatique de mise en rayon.

Ces limites sont visibles et documentées. Elles permettent de démontrer les choix techniques sans inventer une exploitation cloud qui n’a pas eu lieu.

## 16. Passage en production

Pour industrialiser la plateforme, je connecterais les sources réelles, isolerais les environnements AWS, stockerais les secrets dans un gestionnaire dédié, brancherais dbt sur Snowflake, déploierais Airflow sur MWAA ou une plateforme supervisée, puis ajouterais DLQ, registry de schémas, alerting, tests de charge et procédures d’astreinte.

La logique métier, les modèles, les contrôles et l’ordre du DAG resteraient stables. Le projet démontre ainsi non seulement une architecture, mais une trajectoire d’industrialisation réaliste.

## 17. Synthèse personnelle

J’ai voulu montrer que je sais relier architecture cloud, SQL, Python et enjeux retail. Je ne déplace pas seulement des données : je définis ce qu’elles représentent, comment elles sont rapprochées, quand elles peuvent être publiées et comment prouver que le résultat est fiable.
