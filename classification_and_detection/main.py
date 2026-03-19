"""
main.py — ResolveX Classification Service
==========================================
FastAPI application entry-point.

Responsibilities
----------------
- Create and configure the FastAPI app (title, docs, version)
- Register CORS middleware
- Register global exception handlers (maps domain errors → HTTP responses)
- Define the single route: POST /api/v1/analyze
- Provide a health-check endpoint: GET /healthz

Run locally
-----------
    uvicorn main:app --reload --host 0.0.0.0 --port 8080

Environment variables (or .env file)
-------------------------------------
    NIM_API_KEY=nvapi-xxxxxxxxxxxxxxxxxxxx
    NIM_BASE_URL=https://integrate.api.nvidia.com/v1   # default
    NIM_MODEL=meta/llama-3.1-8b-instruct               # text model
    NIM_VISION_MODEL=nvidia/llama-3.1-nemotron-nano-vl-8b-v1
"""

from __future__ import annotations

import logging
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from config import settings
from llm_service import (
    LLMAPIError,
    LLMParseError,
    LLMTimeoutError,
    classify_complaint,
)
from models import AnalyzeRequest, AnalyzeResponse, ErrorDetail

# ── Logging Setup ──────────────────────────────────────────────────────────────
logging.basicConfig(
    level=settings.log_level.upper(),
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger(__name__)


# ── Lifespan (startup / shutdown hooks) ───────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    FastAPI lifespan context manager.

    - Startup : log configuration summary, validate required env vars.
    - Shutdown: log graceful shutdown (add DB pool close, cache flush, etc. here).
    """
    # ── Startup ────────────────────────────────────────────────────────────────
    logger.info("═" * 60)
    logger.info("  %s  starting up", settings.service_name)
    logger.info("  LLM model  : %s", settings.nim_model)
    logger.info("  LLM base   : %s", settings.nim_base_url)
    logger.info("  Temperature: %.2f", settings.llm_temperature)
    logger.info("  Max tokens : %d", settings.llm_max_tokens)
    logger.info("  Timeout    : %.1f s", settings.llm_timeout_seconds)
    logger.info("  Max retries: %d", settings.llm_max_retries)
    logger.info("═" * 60)

    yield  # Application runs here

    # ── Shutdown ───────────────────────────────────────────────────────────────
    logger.info("%s shutting down gracefully.", settings.service_name)


# ── FastAPI App ────────────────────────────────────────────────────────────────

app = FastAPI(
    title=settings.service_name,
    description=(
        "Microservice that classifies urban citizen complaints into structured "
        "categories using an LLM backend (NVIDIA NIM / GLM-4). "
        "Part of the ResolveX Smart Public Service CRM platform."
    ),
    version="1.0.0",
    docs_url="/docs",        # Swagger UI
    redoc_url="/redoc",      # ReDoc UI
    openapi_url="/openapi.json",
    lifespan=lifespan,
)


# ── CORS Middleware ────────────────────────────────────────────────────────────

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,  # Restrict to gateway origin in prod
    allow_credentials=True,
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
)


# ── Request Timing Middleware ──────────────────────────────────────────────────

@app.middleware("http")
async def add_process_time_header(request: Request, call_next):
    """
    Attach X-Process-Time-Ms header to every response.
    Useful for latency monitoring in API gateways / dashboards.
    """
    start = time.perf_counter()
    response = await call_next(request)
    elapsed_ms = (time.perf_counter() - start) * 1_000
    response.headers["X-Process-Time-Ms"] = f"{elapsed_ms:.2f}"
    return response


# ── Global Exception Handlers ──────────────────────────────────────────────────

@app.exception_handler(LLMTimeoutError)
async def llm_timeout_handler(request: Request, exc: LLMTimeoutError):
    """Map LLM timeout to HTTP 504 Gateway Timeout."""
    logger.error("LLM timeout: %s", exc)
    return JSONResponse(
        status_code=status.HTTP_504_GATEWAY_TIMEOUT,
        content=ErrorDetail(
            error="LLM_TIMEOUT",
            message=str(exc),
        ).model_dump(),
    )


@app.exception_handler(LLMParseError)
async def llm_parse_handler(request: Request, exc: LLMParseError):
    """Map JSON parse failures to HTTP 502 Bad Gateway."""
    logger.error("LLM parse error: %s", exc)
    return JSONResponse(
        status_code=status.HTTP_502_BAD_GATEWAY,
        content=ErrorDetail(
            error="LLM_PARSE_ERROR",
            message="The AI model returned an unexpected response format. "
                    "Please retry your request.",
        ).model_dump(),
    )


@app.exception_handler(LLMAPIError)
async def llm_api_error_handler(request: Request, exc: LLMAPIError):
    """Map LLM provider errors to HTTP 502 Bad Gateway."""
    logger.error("LLM API error: %s", exc)
    return JSONResponse(
        status_code=status.HTTP_502_BAD_GATEWAY,
        content=ErrorDetail(
            error="LLM_API_ERROR",
            message="The AI backend returned an error. "
                    "Check your API key and quota.",
        ).model_dump(),
    )


@app.exception_handler(ValidationError)
async def pydantic_validation_handler(request: Request, exc: ValidationError):
    """
    Catch Pydantic ValidationErrors that bubble up from response construction.
    (e.g. LLM returned an out-of-enum category string that slipped through.)
    Maps to HTTP 502 — it's the upstream model that misbehaved, not the caller.
    """
    logger.error("Schema validation failed on LLM output: %s", exc)
    return JSONResponse(
        status_code=status.HTTP_502_BAD_GATEWAY,
        content=ErrorDetail(
            error="SCHEMA_VALIDATION_ERROR",
            message="The AI model returned a response that did not conform "
                    "to the expected schema.",
        ).model_dump(),
    )


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get(
    "/healthz",
    summary="Health Check",
    tags=["Infrastructure"],
    response_description="Returns 200 OK when the service is alive.",
)
async def health_check():
    """
    Lightweight liveness probe for load balancers and Kubernetes.
    Does NOT call the LLM — only verifies the process is alive.
    """
    return {
        "status": "ok",
        "service": settings.service_name,
        "model": settings.nim_model,
    }


@app.post(
    f"/api/{settings.api_version}/analyze",
    response_model=AnalyzeResponse,
    status_code=status.HTTP_200_OK,
    summary="Classify a Citizen Complaint",
    tags=["Classification"],
    responses={
        200: {"description": "Complaint successfully classified."},
        422: {"description": "Invalid request payload (Pydantic validation error)."},
        502: {"description": "LLM returned an unexpected response."},
        504: {"description": "LLM API timed out."},
    },
)
async def analyze_complaint(payload: AnalyzeRequest) -> AnalyzeResponse:
    """
    ## Classify & Detect Issues in a Citizen Complaint

    Submit a raw complaint (text + optional image) and receive a structured
    JSON response with:

    - **primary_issue**: The dominant problem, its category, subcategory,
      priority score (1–5), and model confidence.
    - **secondary_issues**: Any co-occurring concerns found in the complaint.

    ### Category Taxonomy (10 canonical labels)
    1. Roads and Footpaths
    2. Drainage and Sewage
    3. Streetlighting
    4. Waste and Sanitation
    5. Water Supply
    6. Parks and Public Spaces
    7. Encroachment and Illegal
    8. Noise and Pollution
    9. Stray Animals
    10. Other / Miscellaneous

    ### Priority Score Guide
    | Score | Meaning |
    |-------|---------|
    | 5     | Critical — immediate life-safety risk |
    | 4     | High — injury or major damage within 24 h |
    | 3     | Moderate — significant inconvenience |
    | 2     | Minor — degraded service quality |
    | 1     | Low — cosmetic / very minor |
    """
    request_trace = str(uuid.uuid4())[:8]  # Short trace ID for log correlation
    logger.info(
        "trace=%s | Received analyze request for complaint_id=%s",
        request_trace,
        payload.complaint_id,
    )

    # Delegate to the LLM service — all errors raised here are caught by the
    # global exception handlers registered above.
    result: AnalyzeResponse = await classify_complaint(payload)

    logger.info(
        "trace=%s | Returning response for complaint_id=%s → %s (priority=%d)",
        request_trace,
        payload.complaint_id,
        result.primary_issue.category,
        result.primary_issue.priority_score,
    )
    return result
