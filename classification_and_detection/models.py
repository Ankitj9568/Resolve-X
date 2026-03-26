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
from urllib.parse import urlparse
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
    image_base64   : Optional base64-encoded image for vision-based analysis.
    image_url      : Optional image URL (preferred over base64).
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
    image_base64: str | None = Field(
        default=None,
        max_length=20_000_000,  # ~15 MB limit (base64 encoded)
        description="Optional base64 encoded image for vision-based analysis (max 15 MB).",
    )
    image_url: str | None = Field(
        default=None,
        max_length=2048,
        description="Optional HTTP(S) image URL for vision-based analysis (preferred over base64).",
    )
    image_mime_type: str | None = Field(
        default=None,
        max_length=100,
        description="Optional MIME type hint for image_url, e.g. image/jpeg.",
    )

    @field_validator("text_description")
    @classmethod
    def strip_whitespace(cls, v: str) -> str:
        """Normalise leading/trailing whitespace before LLM processing."""
        return v.strip()
    
    @field_validator("image_base64", mode="before")
    @classmethod
    def validate_image_base64(cls, v: str | None) -> str | None:
        """Validate that image_base64, if provided, is not empty."""
        if v is not None:
            v = v.strip() if isinstance(v, str) else v
            if v == "":
                return None  # Treat empty string as no image
        return v

    @field_validator("image_url", mode="before")
    @classmethod
    def validate_image_url(cls, v: str | None) -> str | None:
        """Validate that image_url, if provided, is an HTTP(S) URL."""
        if v is None:
            return None
        if isinstance(v, str):
            v = v.strip()
            if v == "":
                return None
            parsed = urlparse(v)
            if parsed.scheme not in {"http", "https"} or not parsed.netloc:
                raise ValueError("image_url must be a valid HTTP(S) URL")
        return v

    @field_validator("image_mime_type", mode="before")
    @classmethod
    def validate_image_mime_type(cls, v: str | None) -> str | None:
        """Normalize empty MIME type hints to None."""
        if v is None:
            return None
        if isinstance(v, str):
            v = v.strip().lower()
            if v == "":
                return None
        return v


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


class VisionValidation(BaseModel):
    """Gemini vision interpretation and conflict signal for complaint validation."""

    enabled: bool = Field(
        ...,
        description="True when an image was supplied and a vision pass was attempted.",
    )
    summary: str | None = Field(
        default=None,
        description="Raw Gemini visual interpretation summary.",
    )
    conflict_detected: bool = Field(
        default=False,
        description="True when Gemini reports image/text contradiction.",
    )
    conflict_reason: str | None = Field(
        default=None,
        description="Short reason extracted from Gemini output when conflict_detected is true.",
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
