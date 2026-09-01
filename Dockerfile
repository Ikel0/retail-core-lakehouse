FROM python:3.13-slim

LABEL org.opencontainers.image.title="Retail Core Command Center"
LABEL org.opencontainers.image.description="Portfolio Data Engineering retail omnicanal"
LABEL org.opencontainers.image.authors="Ikel Ouedraogo"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY . .

RUN python run_demo.py \
    && python -m unittest discover -s tests -v

EXPOSE 8042

HEALTHCHECK --interval=20s --timeout=3s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8042/api/health', timeout=2)" || exit 1

CMD ["python", "serve.py", "--host", "0.0.0.0", "--port", "8042"]
