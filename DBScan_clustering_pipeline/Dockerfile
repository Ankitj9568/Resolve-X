FROM python:3.10-slim

WORKDIR /app

# Required for some GIS libraries if needed
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

COPY pyproject.toml .
COPY requirements.txt .

RUN uv pip install --system -r requirements.txt

COPY . .

EXPOSE 8010

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8010"]
