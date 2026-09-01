# Retail Core Lakehouse

## Projet Data Engineering retail omnicanal

**Auteur : Ikel Ouedraogo — Data Engineer**  
**Contexte : démonstrateur de compétences pour un poste Data Engineer spécialisé retail**

## 1. Résumé du projet

J’ai conçu ce projet pour démontrer ma capacité à construire un Retail Core Model moderne, fiable et orienté produit. Mon objectif est de réunir les données provenant du CRM, du catalogue produit, des points de vente, de l’e-commerce et des stocks dans une même source de vérité.

La plateforme traite à la fois des données batch et des événements quasi temps réel. Elle calcule les indicateurs nécessaires au pilotage commercial, mesure le stock disponible à la vente, réconcilie les ventes streaming avec les agrégats batch et bloque la publication si un contrôle critique échoue.

Le démonstrateur contient 960 ventes, 160 clients pseudonymisés, 12 produits, 24 versions de prix SCD Type 2 et 3 160 événements. Les données sont entièrement synthétiques : aucune donnée d’entreprise ni aucune donnée personnelle réelle n’est utilisée.

## 2. Problème métier traité

Dans un environnement retail omnicanal, plusieurs systèmes décrivent la même activité sous des angles différents :

- le POS enregistre les ventes magasin ;
- l’e-commerce produit des commandes et des événements web ;
- le CRM conserve les identités et les consentements clients ;
- le PLM ou l’ERP porte le catalogue produit ;
- le WMS et les outils supply chain décrivent les stocks et les réapprovisionnements.

Sans modèle central, les équipes peuvent obtenir des chiffres différents pour une même question. Mon projet construit donc une Single Source of Truth capable de répondre de manière cohérente à des questions telles que : combien ai-je vendu, quel stock puis-je encore promettre, un client web et magasin est-il le même client, et les ventes temps réel sont-elles exactes en fin de journée ?

## 3. Architecture

```text
CRM / ERP / PLM ── Airbyte ───────────────┐
POS / E-commerce ─ Kinesis ─ Lambda ─────┼── S3 Raw ─ dbt ─ Snowflake ─ Retail Marts
Fichiers Supply ── Airbyte ───────────────┘                  │
                                                            ├── Ventes et marge
Airflow / MWAA : orchestration, reprises, backfills ────────┼── Stock et ATP
CloudWatch : logs, métriques et alertes ────────────────────┼── Customer 360
Data contracts : qualité et réconciliation ────────────────┘
```

La version locale utilise des fichiers CSV pour la zone Raw et SQLite pour le warehouse. Ce choix rend le projet exécutable gratuitement, tout en conservant des frontières compatibles avec AWS S3, Amazon Kinesis, AWS Lambda, Snowflake, dbt et Airflow.

## 4. Données utilisées

| Jeu de données | Grain | Exemples de champs | Usage |
|---|---|---|---|
| `products.csv` | Un produit | catégorie, département, collection, prix | Référentiel et analyses produit |
| `customers.csv` | Un client | email hashé, loyalty ID, pays, consentement | Customer 360 et segmentation |
| `orders.csv` | Une commande | canal, magasin, quantité, prix, remise | Chiffre d’affaires et panier moyen |
| `stream_events.csv` | Un événement | type, partition, latence, timestamp | Kinesis, conversion et monitoring |
| `stock.csv` | Un produit | stock magasin, entrepôt, réservé, entrant | Calcul de l’ATP |
| `price_history.csv` | Une version de prix | validité, prix, version courante | Historisation SCD Type 2 |

Les événements comprennent des achats, des consultations de fiches produit et des ajouts au panier. La clé de partition logique est `customer_id`, afin de conserver l’ordre des événements d’un même client. `event_id` sert de clé d’idempotence pour éviter les doublons lors d’une reprise.

## 5. Fonctionnement du pipeline

### 5.1 Génération et ingestion

Je génère un jeu de données déterministe avec une graine fixe. Cela permet de rejouer la démonstration et d’obtenir les mêmes résultats. Dans la cible cloud, Airbyte collecte les sources SaaS et les fichiers métiers, tandis que Kinesis ingère les événements e-commerce et POS à haute fréquence.

### 5.2 Validation à l’entrée

Une fonction Lambda représentative décode chaque événement, vérifie les champs obligatoires, contrôle le timestamp et enrichit le message avec une version de schéma et une clé d’idempotence. Les événements invalides sont marqués en erreur pour pouvoir être orientés vers une dead-letter queue.

### 5.3 Modélisation

Je sépare les dimensions et les faits :

- `dim_product` décrit les produits et leurs hiérarchies ;
- `dim_customer` porte le Golden Record client pseudonymisé ;
- `dim_product_price_scd2` conserve l’historique des prix ;
- `fact_sales` contient les commandes omnicanales ;
- `fact_inventory` calcule les stocks et le risque de rupture ;
- `fact_retail_event` conserve les événements streaming de tous les canaux.

Les modèles dbt montrent une couche staging typée et dédupliquée, puis des marts incrémentaux. La stratégie `merge` et la clé `order_id` rendent les reprises idempotentes.

### 5.4 Orchestration

Le DAG Airflow `retail_core_daily` enchaîne l’extraction, les contrats de données, les transformations dbt, la réconciliation et la publication. Deux retries sont configurés avec cinq minutes d’intervalle. La publication n’est autorisée que si les contrôles sont conformes et si l’écart batch/streaming est nul.

## 6. KPI présentés

| KPI | Définition | Utilité métier |
|---|---|---|
| Chiffre d’affaires | Somme de `quantité × prix unitaire` | Piloter la performance commerciale |
| Commandes | Nombre d’ordres uniques | Mesurer le volume d’activité |
| Panier moyen | Chiffre d’affaires / commandes | Suivre la valeur moyenne d’achat |
| Clients actifs | Clients distincts ayant commandé | Mesurer la base réellement engagée |
| ATP | Magasin + entrepôt + entrant - réservé - vendu | Promettre un stock réellement disponible |
| Risque de rupture | ATP comparé au stock de sécurité | Prioriser les réapprovisionnements |
| Latence p95 | 95 % des événements reçus sous ce délai | Contrôler le SLA quasi temps réel |
| Score qualité | Tests réussis / tests exécutés | Décider si les données sont publiables |
| Écart batch/stream | Unités batch - unités Kinesis | Garantir la précision comptable |
| Coût mensuel | Compute + streaming + orchestration + stockage | Prévenir une dérive de facture cloud |

## 7. Calcul de l’ATP

La disponibilité à la vente est calculée ainsi :

```text
ATP = stock magasin + stock entrepôt + réapprovisionnement entrant
      - réservations - unités vendues
```

Je compare ensuite l’ATP au stock de sécurité :

- `critical` si l’ATP est inférieur au stock de sécurité ;
- `watch` s’il est inférieur à deux fois le stock de sécurité ;
- `healthy` dans les autres cas.

Ce calcul sert à éviter la survente, à mieux informer le client et à prioriser les actions supply chain.

## 8. Customer 360

Le Customer 360 réconcilie les comportements web, magasin et marketplace. Les emails ne sont jamais stockés en clair : je conserve uniquement un hash SHA-256 tronqué dans ce démonstrateur. Le loyalty ID, le pays, le canal d’acquisition et le consentement marketing complètent le Golden Record.

Une segmentation RFM simplifiée classe les clients en Champions, Fidèles, Prometteurs et Nouveaux selon leur montant et leur fréquence d’achat. Cette vue peut alimenter des campagnes CRM sans exposer les données personnelles dans les marts analytiques.

## 9. Qualité et gouvernance

Le publishing gate exécute seize contrôles :

- unicité des commandes et événements ;
- intégrité des références produit et client ;
- quantités, montants et remises dans les domaines autorisés ;
- égalité du nombre, des identifiants et des unités d’achat entre batch et streaming ;
- cohérence de la clé de partition avec le client ;
- forme hexadécimale des hashes d’email ;
- unicité de la version courante, validité ouverte et non-chevauchement des périodes SCD2 ;
- fraîcheur du dernier événement.

Une seule erreur critique bloque le pipeline avant publication. Le rapport est écrit au format JSON afin d’être exploitable par Airflow, CloudWatch, une CI/CD ou un outil d’observabilité.

## 10. Simulation Black Friday

Le cockpit permet de multiplier une hypothèse nominale de 42 événements par seconde de 2 à 12. Le modèle estime le débit, le nombre d’unités de capacité, la latence p95 et le surcoût avec 25 % de marge. Il conserve l’invariant de réconciliation à zéro.

Cette fonctionnalité sert à montrer une démarche de capacity planning : je ne cherche pas uniquement à traiter plus de volume, je vérifie aussi la qualité et le coût. Il s’agit d’une estimation déterministe, pas d’un test de charge distribué ni d’un trafic réellement envoyé vers AWS.

## 11. FinOps

Le dashboard présente un scénario cible basé sur 3,2 millions d’événements mensuels. Les composants totalisent exactement 486,70 €, le coût unitaire est recalculé à 0,15 € par millier d’événements et la prévision est comparée à un budget de 650 €. Ces valeurs forment un modèle pédagogique cohérent, pas une facture cloud. Les optimisations prévues sont :

- auto-suspend des warehouses Snowflake ;
- modèles dbt incrémentaux pour limiter les scans ;
- right-sizing de la mémoire Lambda ;
- lifecycle S3 vers des classes moins coûteuses ;
- scaling temporaire des shards Kinesis pendant les pics.

## 12. Cockpit interactif

L’application comprend sept vues :

1. **Vue d’ensemble** : performance, mix canal, catégories et réconciliation.
2. **Temps réel** : événements Kinesis, latence, achats et résilience.
3. **Stock & ATP** : disponibilité détaillée et recherche produit.
4. **Customer 360** : Golden Records, RFM, consentements et canaux.
5. **Pipeline & Ops** : télémétrie réelle du run local et architecture cloud cible séparée.
6. **Qualité & SCD2** : publishing gate et historique des prix.
7. **FinOps** : scénario de coût, hypothèses, budget, prévision et capacité Black Friday.

Les filtres de canal et de période recalculent les KPI depuis l’API. L’interface propose un mode sombre ou clair, une navigation responsive et une simulation interactive.

## 13. Exécution locale

```bash
python3 run_demo.py
python3 serve.py
```

Le cockpit est ensuite disponible sur `http://127.0.0.1:8042`.

## 14. Exécution Docker

```bash
docker compose up --build -d
```

Le conteneur :

1. utilise une image Python 3.13 minimale ;
2. génère les données et construit le warehouse pendant le build ;
3. exécute les tests automatisés ;
4. expose l’application sur le port 8042 ;
5. publie un healthcheck sur `/api/health`.

Pour arrêter l’application :

```bash
docker compose down
```

## 15. Tests et reproductibilité

Les tests vérifient que la qualité et la réconciliation sont conformes, que les séries et les graphiques retombent sur les KPI, que les filtres s’appliquent aux ventes et aux événements, que le p95 est réellement calculé, que l’historique SCD2 contient deux versions par produit, que chaque ATP respecte sa formule et que le modèle FinOps est arithmétiquement cohérent.

```bash
python3 -m unittest discover -s tests -v
```

Le Dockerfile réexécute automatiquement ces tests pendant la construction de l’image. Une image qui échoue aux tests n’est donc pas produite.

## 16. Correspondance avec un poste Data Engineer Retail

| Attente de la mission | Preuve dans le projet |
|---|---|
| Ingestion Airbyte | Sources CRM, ERP, PLM et supply représentées |
| AWS Lambda | Validation et enrichissement des événements |
| Amazon Kinesis | Flux d’achat, consultation et panier |
| Snowflake / Databricks | Warehouse dimensionnel transposable |
| dbt | Staging, marts incrémentaux, documentation et tests |
| SCD | Historisation SCD Type 2 des prix |
| Airflow | DAG, retries, dépendances et publishing gate |
| Qualité | Seize contrôles et réconciliation comptable filtrée |
| Retail Core | Produit, omnicanalité, ATP et Customer 360 |
| FinOps | Budget, prévision et optimisation du compute |
| Product-oriented | Chaque traitement répond à une décision métier |

## 17. Choix et limites assumées

SQLite et les fichiers locaux remplacent les services cloud afin de permettre une démonstration gratuite et reproductible. Le code dbt, le DAG Airflow et la Lambda montrent la transposition cible, mais le projet ne provisionne pas réellement un compte AWS ou Snowflake.

Pour une mise en production, j’ajouterais Terraform, un registre de schémas, une dead-letter queue, des secrets gérés par AWS Secrets Manager, une CI/CD, des tests de charge distribués et une politique de rétention conforme au RGPD.

## 18. Présentation orale

> J’ai construit un Retail Core Lakehouse qui réunit les ventes web, magasin et marketplace avec les données clients, produits et stocks. Le pipeline gère 960 ventes et plus de 3 000 événements simulés, calcule l’ATP, historise les prix en SCD Type 2 et réconcilie le streaming avec le batch. Avant toute publication, seize contrôles constituent un publishing gate. J’ai également ajouté un cockpit interactif, un modèle de capacité Black Friday et un scénario FinOps explicite. La version locale utilise SQLite pour rester démontrable gratuitement, mais les frontières techniques sont directement transposables vers S3, Lambda, Kinesis, Snowflake, dbt et Airflow.

## 19. Ce que ce projet démontre

Ce projet montre que je sais relier architecture, code et besoin métier. Je ne me contente pas de déplacer des données : je définis leur grain, leur qualité, leur cycle de vie, leur coût et leur utilité pour le retail. Mon approche est orientée produit, observable et conçue pour évoluer vers une plateforme cloud industrialisée.
