FROM apache/airflow:3.3.1-python3.12

COPY --chown=airflow:root requirements-dbt.txt /tmp/requirements-dbt.txt
COPY --chown=airflow:root requirements-platform.txt /tmp/requirements-platform.txt

RUN python -m venv /opt/airflow/dbt-venv \
    && /opt/airflow/dbt-venv/bin/pip install --no-cache-dir -r /tmp/requirements-dbt.txt

RUN pip install --no-cache-dir "apache-airflow==3.3.1" -r /tmp/requirements-platform.txt \
    && pip check

COPY --chown=airflow:root . /opt/airflow/project
COPY --chown=airflow:root dags /opt/airflow/dags

WORKDIR /opt/airflow/project
