FROM python:3.10-slim

WORKDIR /app

# Install system dependencies for GIS/PostGIS libraries if needed in future
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install uv for fast dependency management
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Copy dependencies first for caching
COPY pyproject.toml .
COPY requirements.txt .

# Install dependencies
RUN uv pip install --system -r requirements.txt

# Copy application code
COPY . .

EXPOSE 8020

# Run the application
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8020"]
