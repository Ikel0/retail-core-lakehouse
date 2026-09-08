# Retail Core Lakehouse

[![CI](https://github.com/Ikel0/retail-core-lakehouse/actions/workflows/ci.yml/badge.svg)](https://github.com/Ikel0/retail-core-lakehouse/actions/workflows/ci.yml)

Plateforme data retail omnicanale qui rapproche ventes, paiements, stocks, événements et identités client avant de publier des indicateurs fiables.

**Application :** [Retail Core Command Center](https://ikel0.github.io/retail-core-lakehouse/)

## Ce que le projet résout

- une vision commune des ventes web, magasins et marketplace ;
- un stock disponible à la promesse (ATP) tenant compte de la demande ;
- un Golden Record client sans exposer les emails ;
- une publication bloquée en cas d’écart métier ou de test en échec.

Les données sont synthétiques, déterministes et sans information personnelle réelle.

## Architecture

```text
8 sources retail
      │
      ▼
Apache Airflow · 6 tâches
      │
      ├── S3 Raw + Kinesis · API locales via LocalStack
      ├── modèle de contrôle Python + SQLite
      └── dbt Core + DuckDB · modèles, tests et snapshot
                          │
                          ▼
          réconciliation ventes / paiements / événements
                          │
                          ▼
             ATP · Customer 360 · KPI · cockpit
```

## Résultat vérifié

| Contrôle | Résultat |
|---|---:|
| Sources | 8 fichiers · 5 928 lignes |
| Ventes / paiements | 960 / 960 |
| Identités | 640 identités · 160 Golden Records |
| Événements | 3 160 |
| Qualité Python | 24 / 24 |
| dbt | 19 modèles · 78 tests · 1 snapshot |
| Réconciliation | 0 unité · 0,00 € |
| Airflow | 6 tâches · succès |

## Les quatre vues

| Vue | Décision couverte |
|---|---|
| Vue d’ensemble | performance commerciale par canal et période |
| Stock & ATP | disponibilité, demande, couverture et risque de rupture |
| Customer 360 | identité omnicanale, valeur client et segmentation RFM |
| Fiabilité data | Airflow, dbt, AWS local, contrôles et publishing gate |

## Ce qui tourne réellement

- Airflow orchestre le pipeline dans Docker ;
- dbt transforme et teste les données dans DuckDB ;
- Python construit un modèle de contrôle indépendant dans SQLite ;
- LocalStack émule les API S3, Kinesis et CloudWatch ;
- le handler compatible Lambda valide les événements dans le processus local ;
- Terraform décrit une cible AWS, sans déploiement automatique.

## Démarrage

Cockpit seul :

```bash
docker compose up --build -d retail-core
```

Plateforme complète :

```bash
docker compose --profile platform up --build -d
make airflow-test
```

- cockpit : [http://127.0.0.1:8042](http://127.0.0.1:8042)
- Airflow : [http://127.0.0.1:8080](http://127.0.0.1:8080)
- API AWS locale : `http://127.0.0.1:4566`

Sans Docker :

```bash
python3 run_demo.py
python3 serve.py
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [État d’implémentation](docs/IMPLEMENTATION_STATUS.md)
