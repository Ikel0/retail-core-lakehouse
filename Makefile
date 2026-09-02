.PHONY: demo serve test portfolio dbt-build dbt-docker aws-local platform-run docker-build docker-up docker-down platform-up platform-down airflow-test package-lambda terraform-fmt terraform-validate

AIRFLOW_DATE ?= $(shell date +%F)

demo:
	python3 run_demo.py

serve:
	python3 serve.py

test:
	PYTHONPATH=. python3 -m unittest discover -s tests -v

portfolio:
	python3 run_demo.py
	python3 build_portfolio.py

dbt-build:
	python3 -m src.dbt_runner build

dbt-docker:
	docker compose --profile tools run --rm dbt

aws-local:
	docker compose --profile tools run --rm aws-bootstrap

platform-run:
	python3 -m src.orchestration

docker-build:
	docker build -t retail-core-lakehouse:latest .

docker-up:
	docker compose up --build -d retail-core

docker-down:
	docker compose down

platform-up:
	docker compose --profile platform up --build -d

platform-down:
	docker compose --profile platform down

airflow-test:
	docker compose --profile platform exec -T airflow airflow dags test retail_core_daily $(AIRFLOW_DATE)

package-lambda:
	mkdir -p dist
	cd lambda && zip -q -j ../dist/validate_kinesis_event.zip validate_kinesis_event.py

terraform-fmt:
	terraform fmt -recursive infra/terraform

terraform-validate: package-lambda
	terraform -chdir=infra/terraform init -backend=false
	terraform -chdir=infra/terraform validate
