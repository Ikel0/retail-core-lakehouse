# Source Retail Core compatible Airbyte

Ce connecteur implémente les commandes `spec`, `check`, `discover` et `read` du protocole source. Il expose huit flux CSV sous forme de messages JSONL Airbyte afin de matérialiser l'interface d'ingestion entre CRM, POS, e-commerce, paiement, stock et catalogue.

```bash
python -m connectors.source_retail.source spec
python -m connectors.source_retail.source check --config connectors/source_retail/config.example.json
python -m connectors.source_retail.source discover --config connectors/source_retail/config.example.json
```

Le connecteur est aussi dockerisable. Il s'agit d'une implémentation locale autonome, pas d'un déploiement complet de la plateforme Airbyte.
