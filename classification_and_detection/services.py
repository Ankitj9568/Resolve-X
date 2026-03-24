"""Service helpers for DB-backed duplicate detection and LLM orchestration."""

from __future__ import annotations

import logging
import os
import uuid
from uuid import UUID

import asyncpg

from llm_service import classify_complaint
from models import AnalyzeRequest, AnalyzeResponse

logger = logging.getLogger(__name__)


DUPLICATE_CHECK_SQL = """
SELECT id
FROM complaints
WHERE status = 'open'
  AND user_selected_category = $1
  AND created_at >= (NOW() - INTERVAL '48 hours')
  AND ST_DWithin(
        location::geography,
        ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography,
        50
      )
ORDER BY created_at DESC
LIMIT 1;
"""


async def create_db_pool() -> asyncpg.Pool | None:
    """Create and warm up the asyncpg pool; return None when unavailable."""
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        logger.warning("DATABASE_URL not configured; duplicate detection disabled.")
        return None

    try:
        pool = await asyncpg.create_pool(
            dsn=database_url,
            min_size=int(os.getenv("DB_POOL_MIN_SIZE", "1")),
            max_size=int(os.getenv("DB_POOL_MAX_SIZE", "10")),
            command_timeout=float(os.getenv("DB_COMMAND_TIMEOUT_SECONDS", "5")),
        )
        async with pool.acquire() as conn:
            await conn.execute("SELECT 1;")

        logger.info("PostgreSQL pool initialized successfully.")
        return pool
    except Exception:
        logger.exception(
            "Unable to initialize PostgreSQL pool. Service will continue without duplicate detection."
        )
        return None


async def close_db_pool(pool: asyncpg.Pool | None) -> None:
    """Close pool during shutdown without raising if already closed/broken."""
    if pool is None:
        return
    try:
        await pool.close()
    except Exception:
        logger.exception("Error while closing PostgreSQL pool.")


async def find_spatial_duplicate(
    pool: asyncpg.Pool | None,
    user_selected_category: str,
    latitude: float,
    longitude: float,
) -> UUID | None:
    """
    Return parent complaint id for a duplicate candidate, otherwise None.

    If the database is unavailable at request time, fail open and return None so
    complaint analysis can proceed through the LLM path.
    """
    if pool is None:
        return None

    try:
        row = await pool.fetchrow(
            DUPLICATE_CHECK_SQL,
            user_selected_category,
            latitude,
            longitude,
        )
        if not row:
            return None
        return row["id"]
    except Exception:
        logger.exception(
            "Duplicate check failed. Proceeding with LLM path as graceful fallback."
        )
        return None


async def run_intelligence_pass(
    text_description: str,
) -> AnalyzeResponse:
    """Build normalized LLM request object and run classification."""
    request = AnalyzeRequest(
        complaint_id=uuid.uuid4(),
        text_description=text_description,
    )
    return await classify_complaint(request)
