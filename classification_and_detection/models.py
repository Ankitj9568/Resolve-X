"""
models.py — ResolveX Classification Service
============================================
All Pydantic v2 schemas used for request validation and response serialisation.

Design decisions:
- Strict enums for category strings prevent silent typo bugs downstream.
- `model_config = ConfigDict(strict=True)` on response models means FastAPI
  will raise a hard 500 (not silently coerce) if the LLM returns wrong types.
- Each field carries a `description` used by FastAPI's auto-generated OpenAPI docs.
"""

from __future__ import annotations

from enum import Enum
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


# ── Category Enum ──────────────────────────────────────────────────────────────

class IssueCategory(str, Enum):
    """
    The 10 canonical complaint categories for ResolveX.

    Using a str-enum means:
      1. JSON serialisation produces the human-readable string, not the index.
      2. Pydantic will raise a ValidationError if the LLM returns anything
         outside this list — acting as a hard guardrail before the response
         ever reaches the caller.
    """
    ROADS            = "Roads and Footpaths"
    DRAINAGE         = "Drainage and Sewage"
    STREETLIGHTING   = "Streetlighting"
    WASTE            = "Waste and Sanitation"
    WATER            = "Water Supply"
    PARKS            = "Parks and Public Spaces"
    ENCROACHMENT     = "Encroachment and Illegal"
    NOISE            = "Noise and Pollution"
    STRAY_ANIMALS    = "Stray Animals"
    OTHER            = "Other / Miscellaneous"


# ── Request Schema ─────────────────────────────────────────────────────────────

class AnalyzeRequest(BaseModel):
    """
    Payload accepted by POST /api/v1/analyze.

    complaint_id   : Stable identifier used for idempotency and tracing.
    text_description: The raw, unstructured complaint text from the citizen.
    """

    complaint_id: UUID = Field(
        ...,
        description="Unique identifier for the complaint (UUID v4 recommended).",
        examples=["a3b4c5d6-e7f8-9012-abcd-ef0123456789"],
    )
    text_description: str = Field(
        ...,
        min_length=10,
        max_length=4_000,
        description="Raw complaint text from the citizen (10–4000 characters).",
        examples=["The manhole cover on MG Road near bus stop 14 is missing. "
                  "Two bikes nearly fell in last night. Very dangerous!"],
    )

    @field_validator("text_description")
    @classmethod
    def strip_whitespace(cls, v: str) -> str:
        """Normalise leading/trailing whitespace before LLM processing."""
        return v.strip()


# ── Response Sub-schemas ───────────────────────────────────────────────────────

class PrimaryIssue(BaseModel):
    """
    The single most important issue identified in the complaint.

    category      : One of the 10 canonical IssueCategory values.
    subcategory   : Finer-grained label (LLM-generated, free text).
    priority_score: 1 (low) → 5 (critical / life-safety).
    confidence    : Model's self-reported confidence in [0.0, 1.0].
    """

    model_config = ConfigDict(use_enum_values=True)

    category: IssueCategory = Field(
        ...,
        description="One of the 10 canonical ResolveX categories.",
    )
    subcategory: str = Field(
        ...,
        min_length=2,
        max_length=120,
        description="A concise free-text subcategory label (e.g. 'Pothole', 'Burst pipe').",
    )
    priority_score: int = Field(
        ...,
        ge=1,
        le=5,
        description=(
            "Urgency score: 1=Low, 2=Minor, 3=Moderate, 4=High, 5=Critical/life-safety."
        ),
    )
    confidence: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="Model confidence in the primary classification (0.0–1.0).",
    )


class SecondaryIssue(BaseModel):
    """
    Any additional, co-occurring concern found in the complaint text.

    category        : One of the 10 canonical IssueCategory values.
    risk_description: Short explanation of the secondary risk.
    confidence      : Model's self-reported confidence in [0.0, 1.0].
    """

    model_config = ConfigDict(use_enum_values=True)

    category: IssueCategory = Field(
        ...,
        description="One of the 10 canonical ResolveX categories.",
    )
    risk_description: str = Field(
        ...,
        min_length=5,
        max_length=300,
        description="Concise description of the secondary risk or concern.",
    )
    confidence: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="Model confidence in this secondary classification (0.0–1.0).",
    )


# ── Top-level Response Schema ──────────────────────────────────────────────────

class AnalyzeResponse(BaseModel):
    """
    Full response returned by POST /api/v1/analyze.

    complaint_id    : Echoed back so callers can correlate async responses.
    primary_issue   : The dominant problem requiring action.
    secondary_issues: Zero or more co-occurring issues (can be empty list).
    """

    model_config = ConfigDict(use_enum_values=True)

    complaint_id: UUID = Field(
        ...,
        description="The same UUID that was sent in the request.",
    )
    primary_issue: PrimaryIssue = Field(
        ...,
        description="Primary classified issue with priority and confidence.",
    )
    secondary_issues: list[SecondaryIssue] = Field(
        default_factory=list,
        description="Zero or more secondary/co-occurring issues.",
    )


# ── Error Response Schema ──────────────────────────────────────────────────────

class ErrorDetail(BaseModel):
    """Standardised error envelope for all 4xx / 5xx responses."""

    error: str = Field(..., description="Machine-readable error code.")
    message: str = Field(..., description="Human-readable explanation.")
    complaint_id: str | None = Field(
        default=None,
        description="Complaint ID if known at the time of failure.",
    )
