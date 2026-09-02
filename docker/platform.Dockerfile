FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /workspace

COPY requirements-platform.txt .
RUN pip install --no-cache-dir -r requirements-platform.txt

COPY . .

CMD ["python", "-m", "src.aws_local"]
