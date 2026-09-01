# Retail Core Lakehouse

J’ai conçu ce projet Data Engineering pour démontrer la construction d’un Retail Core Model complet : ingestion hybride, streaming, modélisation, qualité, orchestration, disponibilité stock et maîtrise des coûts.

**Démonstration :** 960 ventes · 160 clients pseudonymisés · 12 produits · 3 160 événements · 16/16 contrôles qualité.

## Objectif

Construire une source de vérité retail omnicanale capable de réunir les ventes e-commerce et magasin, les événements web, le catalogue produit et les stocks. Le projet calcule le stock disponible à la vente (ATP), réconcilie les flux batch et quasi temps réel et expose des KPI opérationnels.

## Architecture de démonstration

```text
CSV/API simulés ──> raw/ ──> validation Python ──> SQLite warehouse
                                      │                    │
Événements web ──> stream/ ──────────┘                    └──> curated/ + KPI
                                                           │
                                      qualité + monitoring ─┘
```

Les composants sont volontairement découplés : `generate_data.py` simule Airbyte/Kinesis, `pipeline.py` construit le warehouse, `quality.py` applique le publishing gate et `serve.py` expose les données au cockpit interactif.

## Démarrage rapide

### Avec Docker — recommandé

```bash
docker compose up --build -d
```

Ouvrir [http://127.0.0.1:8042](http://127.0.0.1:8042). Pour arrêter :

```bash
docker compose down
```

### Sans Docker

```bash
cd retail-core-lakehouse
python3 run_demo.py
python3 serve.py
```

Ouvrir ensuite [http://127.0.0.1:8042](http://127.0.0.1:8042). Pour les tests :

```bash
python3 -m unittest discover -s tests -v
```

Le résultat est écrit dans `data/warehouse.db`, `data/curated/retail_kpis.json` et `reports/quality_report.json`. Le cockpit comporte sept vues : direction, temps réel, ATP, Customer 360, Pipeline & Ops, Qualité/SCD2 et FinOps.

### Version statique pour GitHub Pages

```bash
python3 run_demo.py
python3 build_portfolio.py
python3 -m http.server 4173 --directory site
```

Ouvrir [http://127.0.0.1:4173](http://127.0.0.1:4173). Cette version embarque les 12 combinaisons canal/période et le modèle de capacité : les filtres, les KPI et la simulation restent interactifs sans backend.

## Cas métier démontrés

- Customer 360 omnicanal avec résolution par email hashé.
- SCD Type 2 simplifié sur les prix produits.
- ATP : stock physique - ventes - réservations + réapprovisionnements.
- Réconciliation des ventes streaming avec les ventes batch.
- Contrôles d’unicité, intégrité référentielle, montants et fraîcheur.
- Modèle déterministe de capacité Black Friday et suivi de la latence des événements.

## Correspondance avec un poste Data Engineer Retail

| Compétence attendue | Démonstration |
|---|---|
| AWS S3 / Lakehouse | zones `raw/` et `curated/` |
| Airbyte | ingestion des fichiers sources |
| Kinesis | événements web simulés dans `stream_events.csv` |
| Lambda | validation et normalisation à l’entrée |
| dbt / Snowflake | modèles staging/marts, incrémental et tests dans `models/` |
| Airflow | DAG avec dépendances, retries et publishing gate dans `dags/` |
| Data quality | rapport JSON avec contrôles bloquants |
| CloudWatch / FinOps | p95 calculée, modèle de coût explicite et scénario de capacité |

Les services cloud sont présentés comme une **architecture cible**. La version exécutable utilise CSV, Python et SQLite ; elle ne prétend pas appeler réellement AWS, Snowflake ou Airflow. Les coûts sont un scénario pédagogique cohérent basé sur 3,2 millions d’événements mensuels, pas une facture fournisseur.

## Pitch entretien

> J'ai construit une plateforme Retail Core qui réconcilie les ventes batch et streaming, calcule le stock disponible à la vente et fournit des indicateurs fiables pour le pilotage omnicanal. J'ai séparé les zones raw et curated, ajouté des contrôles de qualité et prévu la transposition vers S3, Kinesis et Snowflake.

Voir aussi [`docs/INTERVIEW.md`](docs/INTERVIEW.md) et [`docs/PORTFOLIO.md`](docs/PORTFOLIO.md).

La documentation détaillée du fonctionnement, des données, des KPI et des choix d’architecture est disponible dans [`docs/PROJECT_GUIDE.md`](docs/PROJECT_GUIDE.md).
