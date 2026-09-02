FROM python:3.12-slim

WORKDIR /connector
COPY connectors /connector/connectors

ENTRYPOINT ["python", "-m", "connectors.source_retail.source"]
