# ResolveX: Civic Issue Resolution Platform

## 📖 Overview
ResolveX is a modern, AI-powered civic issue resolution platform designed to ensure that "issues stay attached to responsibility, instead of floating around anonymously." 

Built for citizens, field officers, and city commissioners, ResolveX provides a structured resolution workflow with an AI prediction layer, intelligent routing, SLA tracking, and a fully integrated feedback loop. We go beyond typical complaint portals by providing automated accountability and actionable geographic insights.

## 🚀 Progress & Status

Based on the original Product Requirements Document (PRD) from March 21, 2026, the project has made massive progress and transitioned from disjointed ML scripts to a fully integrated microservices architecture. 

### Completed & Integrated Components
* **AI/ML Services:**
  * **Classification & Detection:** Live microservice (Python/FastAPI) classifying text into categories and predicting priorities.
  * **DBSCAN Risk Scoring:** Integrated pipeline for clustering complaints and assessing geographic risk (`DBScan_clustering_pipeline`).
  * **Risk Scoring Alerts:** Service to generate early warning alerts and risk zones (`risk_scoring_and_alerts`).
* **Backend Infrastructure:**
  * Fully containerized ecosystem using `docker-compose.yml`.
  * PostgreSQL + PostGIS activated for spatial queries and metadata storage.
  * RabbitMQ established for async message queuing and inter-service communication.
  * Redis initialized for caching and fast state management.
  * MinIO set up for S3-compatible media uploads (complaint images).
* **API & Frontend:**
  * Node.js/Express Complaint CRUD API (`apps/api`) built with RabbitMQ and MinIO integration.
  * Next.js PWA (`apps/web`) developed with dedicated portals for Citizens, Officers, and Commissioners.

## ✨ Key Features
- **AI-Powered Filing:** Citizens file complaints using natural language descriptions and images. Our ML pipeline automatically classifies the core issue, detects secondary problems, and assigns an initial priority score.
- **Smart Deduplication:** PostGIS-powered spatial queries (evaluating proximity within 50m and time within 48h) run alongside ML text comparisons to prevent duplicate complaints from cluttering the system.
- **Automated Routing & SLAs:** Complaints are routed instantly to the correct department and local field officer based on overlapping geographic wards and categorized issues.
- **DBSCAN Risk Scoring:** Live, density-based spatial clustering (DBSCAN) identifies emerging crisis zones and risk hotspots before they escalate entirely.
- **Commissioner Dashboards:** Intuitive map interfaces (driven by Leaflet GIS) give city officials real-time tracking, spatial awareness, and early warning alerts.
- **Transparent Accountability:** Every issue acts as an immutable trace with a clear chain of custody.

## 🏗️ System Architecture & Tech Stack

ResolveX utilizes a highly scalable microservices architecture fully orchestrated through Docker Compose.

* **Frontend (`apps/web`):** Next.js Progressive Web App (PWA). Contains specialized, authenticated portals for Citizens, Officers, and Commissioners.
* **Backend API (`apps/api`):** Node.js and Express REST backend handling CRUD operations, dynamic routing, and core business logic.
* **AI & spatial pipelines (Python/FastAPI):**
  * `classification_and_detection`: Text categorization & multi-issue prediction.
  * `DBScan_clustering_pipeline`: Geographic clustering and spatial anomaly detection.
  * `risk_scoring_and_alerts`: Contextual risk scoring and early warning endpoint generators.
* **Database & Spatial System:** PostgreSQL equipped with PostGIS representing geographic points, polygons, and spatial bounding boxes.
* **Message Broker:** RabbitMQ manages asynchronous tasks to decouple ML workflows from instantaneous API responses.
* **Caching Layer:** Redis handles fast state retrieval and short-term locks.
* **Object / Blob Storage:** MinIO provides an S3-compatible, private server for blazing-fast media storage.

## 🚀 Setup & Installation

### Prerequisites
- Docker and Docker Compose installed.
- Node.js `v18+` (Optional, only required if deploying local scripts outside Docker).

### Configuration
1. Clone the repository and navigate to the project root.
2. Generate your local `.env` configuration file from the provided template:
   ```bash
   cp .env.example .env
   ```
3. Update `.env` with secure credentials and setup variables:
   * **Authentication Settings:** Provide `JWT_PRIVATE_KEY` and `JWT_PUBLIC_KEY`. Alternatively, place them securely under `apps/api/keys/` without committing them to source control.
   * **OTP Settings:** For real SMS support, configure `OTP_PROVIDER=twilio` and inject valid Twilio keys. For internal development testing, explicitly set `OTP_PROVIDER=mock`.
   * **Host Binding:** For local development, set `PUBLIC_HOST=localhost`. For a remote or cloud deployment, specify the server’s public IP address (e.g., `PUBLIC_HOST=136.112.200.180`).

### Running the Environment (Docker Compose)
To initialize and boot the complete stack, run the following command:

```bash
docker compose up -d --build
```
*(Note: Initial boot triggers automatic PostGIS database migrations and infrastructure initialization).*

### Accessing Local Services

Once successfully running, services will map to following ports:
- **Client App (Next.js):** `http://<PUBLIC_HOST>:3000`
- **Core Node API:** `http://<PUBLIC_HOST>:4000/health`
- **DBSCAN Analytics Pipeline:** `http://<PUBLIC_HOST>:8010/healthz`
- **Risk Scoring Service:** `http://<PUBLIC_HOST>:8020/healthz`
- **MinIO Media Server (S3):** `http://<PUBLIC_HOST>:9000`
- **MinIO Dashboard Setup:** `http://<PUBLIC_HOST>:9001` (Accepts credentials assigned to `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` in `.env`)
- **RabbitMQ Admin UI:** `http://<PUBLIC_HOST>:15672` (Username: `resolvex`, Password: `${RABBITMQ_PASSWORD}`)

### Populating Seed Data
Populate the database with foundational schemas (categories, departments, roles, mock 60-complaint data).
Run the SQL seed initialization script against the running Postgres container:
```bash
docker compose exec -T postgres psql -U resolvex -d resolvex < db/seed.sql
```

## 👥 Meet the Team (India Innovates 2026)
- **Danish**: Full-stack Development (Next.js/Express) & Systems Architecture
- **Abdul**: ML Architecture, Geospatial Pipelines, & API Integrations
- **Arnab**: Data Models & Validation Schemas
- **Ankit**: Project Management & Core Strategy
