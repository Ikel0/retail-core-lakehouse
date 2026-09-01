.PHONY: demo serve test portfolio docker-build docker-up docker-down

demo:
	python3 run_demo.py

serve:
	python3 serve.py

test:
	PYTHONPATH=. python3 -m unittest discover -s tests -v

portfolio:
	python3 run_demo.py
	python3 build_portfolio.py

docker-build:
	docker build -t retail-core-lakehouse:latest .

docker-up:
	docker compose up --build -d

docker-down:
	docker compose down
