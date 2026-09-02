FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /workspace

COPY requirements-dbt.txt .
RUN pip install --no-cache-dir -r requirements-dbt.txt

COPY . .

CMD ["python", "-m", "src.dbt_runner", "build"]
