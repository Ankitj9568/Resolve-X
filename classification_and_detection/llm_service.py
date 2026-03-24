"""
llm_service.py — ResolveX Classification Service
=================================================
All LLM interaction is isolated here.  The public surface is a single async
function:

    result: AnalyzeResponse = await classify_complaint(request)

Swapping the LLM provider (NVIDIA NIM → Anthropic → LiteLLM → Ollama) only
requires editing this file — the FastAPI route and Pydantic models are untouched.

Architecture
------------
┌─────────────┐   AnalyzeRequest   ┌──────────────────┐   HTTP/OpenAI-API
│  main.py    │ ─────────────────► │  llm_service.py  │ ──────────────────► NVIDIA NIM
│  (route)    │ ◄───────────────── │  (this file)     │ ◄──────────────────  GLM-4
└─────────────┘   AnalyzeResponse  └──────────────────┘

Error Strategy
--------------
- Timeout         → raises LLMTimeoutError (mapped to HTTP 504)
- Bad JSON        → retries up to settings.llm_max_retries; then raises LLMParseError (HTTP 502)
- Category drift  → Pydantic's IssueCategory enum rejects unknown values (HTTP 502)
- Auth / rate-limit → raises LLMAPIError (HTTP 502)
"""

from __future__ import annotations
 
import json
import logging
import re
import textwrap
from typing import Any
 
import httpx
from openai import APIConnectionError, APIStatusError, AsyncOpenAI, OpenAIError
 
from config import settings
from models import AnalyzeRequest, AnalyzeResponse, IssueCategory
 
logger = logging.getLogger(__name__)
 
 
# ── Custom Exceptions ──────────────────────────────────────────────────────────
 
class LLMTimeoutError(Exception):
    """Raised when the LLM API call exceeds the configured timeout."""
 
class LLMParseError(Exception):
    """Raised when the LLM response cannot be parsed into valid JSON / schema."""
 
class LLMAPIError(Exception):
    """Raised on non-retryable LLM API errors (auth, rate-limit, server error)."""
 
 
# ── System Prompt ──────────────────────────────────────────────────────────────
 
_CATEGORY_LIST: str = "\n".join(
    f'  {i+1}. "{cat.value}"' for i, cat in enumerate(IssueCategory)
)
 
SYSTEM_PROMPT: str = textwrap.dedent(f"""
You are ResolveX-AI, an expert urban-governance complaint classifier for a
Smart Public Service CRM used by municipal authorities.
 
Your task: analyse a citizen's complaint (text) and
return a SINGLE valid JSON object — no prose, no markdown, no code fences.
 
ALLOWED CATEGORIES  (you MUST use one of these EXACT strings only)
{_CATEGORY_LIST}
 
REQUIRED JSON SCHEMA  (output ONLY this object, nothing else)
{{
  "primary_issue": {{
    "category":       "<one of the 10 strings above>",
    "subcategory":    "<concise label, e.g. Pothole / Burst pipe / Illegal hoarding>",
    "priority_score": <integer 1-5>,
    "confidence":     <float 0.0-1.0>
  }},
  "secondary_issues": [
    {{
      "category":         "<one of the 10 strings above>",
      "risk_description": "<one sentence explaining the secondary risk>",
      "confidence":       <float 0.0-1.0>
    }}
  ]
}}
 
PRIORITY SCORING GUIDE
5 — Critical / Immediate life-safety risk (open manhole, live wire, flood)
4 — High / Could cause injury or significant property damage within 24 h
3 — Moderate / Significant inconvenience or environmental hazard
2 — Minor / Nuisance, degraded service quality
1 — Low / Cosmetic or very minor issue
 
RULES
- secondary_issues may be an empty array [] if no secondary issue exists.
- All category values MUST match one of the 10 strings EXACTLY (case-sensitive).
- priority_score MUST be an integer in [1, 5].
- confidence MUST be a float in [0.0, 1.0].
- Do NOT output anything outside the JSON object.
- Do NOT wrap the JSON in markdown code fences (no backticks).
""").strip()
 
 
# ── Helper: build user message content ────────────────────────────────────────
 
def _build_user_content(request: AnalyzeRequest) -> list[dict[str, Any]]:
    return [{
        "type": "text",
        "text": (
            f"Complaint text:\n\"\"\"\n{request.text_description}\n\"\"\"\n\n"
            "Analyse the above complaint and return the JSON object as instructed. "
            "Output ONLY the JSON object, nothing else."
        ),
    }]


def _select_model(request: AnalyzeRequest) -> str:
    """Select the configured NIM model."""
    return settings.nim_model
 
 
# ── Helper: extract JSON from LLM text ────────────────────────────────────────
 
_JSON_BLOCK_RE = re.compile(r"```(?:json)?\s*([\s\S]+?)\s*```", re.IGNORECASE)
 
 
def _extract_json(raw: str) -> dict[str, Any]:
    """Try three strategies to extract a JSON dict from raw LLM output."""
    stripped = raw.strip()
 
    # Strategy 1: direct parse
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        pass
 
    # Strategy 2: strip markdown code fence
    match = _JSON_BLOCK_RE.search(stripped)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass
 
    # Strategy 3: outermost { … } heuristic
    start = stripped.find("{")
    end = stripped.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(stripped[start : end + 1])
        except json.JSONDecodeError:
            pass
 
    raise LLMParseError(
        f"LLM response could not be parsed as JSON. "
        f"Raw output (truncated): {stripped[:300]!r}"
    )
 
 
# ── Timeout detection ─────────────────────────────────────────────────────────
 
def _is_timeout(exc: Exception) -> bool:
    """
    Return True if exc is (or wraps) a network timeout.
 
    The OpenAI SDK buries httpx.TimeoutException inside APIConnectionError,
    so we must check both the cause chain and the string message.
    """
    if isinstance(exc, httpx.TimeoutException):
        return True
    cause = getattr(exc, "__cause__", None)
    if isinstance(cause, httpx.TimeoutException):
        return True
    msg = str(exc).lower()
    return "timed out" in msg or "timeout" in msg or "read timeout" in msg
 
 
# ── LLM Client (module-level singleton for connection pooling) ─────────────────
 
_client: AsyncOpenAI = AsyncOpenAI(
    api_key=settings.nim_api_key,
    base_url=settings.nim_base_url,
    timeout=httpx.Timeout(
        connect=15.0,
        read=settings.llm_timeout_seconds,
        write=15.0,
        pool=5.0,
    ),
    max_retries=0,  # manual retry loop below
)
 
 
# ── Core Classification Function ───────────────────────────────────────────────
 
async def classify_complaint(request: AnalyzeRequest) -> AnalyzeResponse:
    """
    Classify a citizen complaint using the configured LLM.
 
    Raises
    ------
    LLMTimeoutError  → HTTP 504
    LLMParseError    → HTTP 502
    LLMAPIError      → HTTP 502
    """
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user",   "content": _build_user_content(request)},
    ]
    selected_model = _select_model(request)
    request_kwargs: dict[str, Any] = {}
    if settings.nim_disable_reasoning and selected_model.startswith("qwen/"):
        # Qwen on NVIDIA NIM supports disabling thinking via chat template args.
        request_kwargs["extra_body"] = {"chat_template_kwargs": {"thinking": False}}
 
    last_error: Exception | None = None
    raw_output: str = ""
 
    for attempt in range(settings.llm_max_retries + 1):
        if attempt > 0:
            logger.warning(
                "complaint_id=%s | parse retry %d/%d | prev error: %s",
                request.complaint_id, attempt, settings.llm_max_retries, last_error,
            )
 
        try:
            logger.info(
                "complaint_id=%s | attempt %d | model=%s",
                request.complaint_id, attempt + 1, selected_model,
            )
 
            completion = await _client.chat.completions.create(
                model=selected_model,
                messages=messages,          # type: ignore[arg-type]
                temperature=settings.llm_temperature,
                max_tokens=settings.llm_max_tokens,
                **request_kwargs,
                # ⚠️  response_format is intentionally absent.
                # GLM-4.7 on NVIDIA NIM silently times out when that parameter
                # is present.  JSON output is enforced via the system prompt.
            )
 
            raw_output = completion.choices[0].message.content or ""
            logger.debug("complaint_id=%s | raw output: %s",
                         request.complaint_id, raw_output[:500])
 
        except APIConnectionError as exc:
            # The OpenAI SDK wraps httpx.TimeoutException here — check before
            # treating it as a generic connection error.
            if _is_timeout(exc):
                raise LLMTimeoutError(
                    f"LLM timed out after {settings.llm_timeout_seconds}s "
                    f"(complaint_id={request.complaint_id}). "
                    f"Increase LLM_TIMEOUT_SECONDS in your .env if needed."
                ) from exc
            raise LLMAPIError(f"LLM connection error: {exc}") from exc
 
        except httpx.TimeoutException as exc:
            raise LLMTimeoutError(
                f"LLM timed out after {settings.llm_timeout_seconds}s "
                f"(complaint_id={request.complaint_id})"
            ) from exc
 
        except APIStatusError as exc:
            raise LLMAPIError(
                f"LLM API returned HTTP {exc.status_code}: {exc.message}"
            ) from exc
 
        except OpenAIError as exc:
            raise LLMAPIError(f"LLM SDK error: {exc}") from exc
 
        # ── Parse & Pydantic validate ──────────────────────────────────────────
        try:
            payload = _extract_json(raw_output)
            payload["complaint_id"] = str(request.complaint_id)
            response = AnalyzeResponse.model_validate(payload)
 
            logger.info(
                "complaint_id=%s | OK → %s priority=%d conf=%.2f",
                request.complaint_id,
                response.primary_issue.category,
                response.primary_issue.priority_score,
                response.primary_issue.confidence,
            )
            return response
 
        except Exception as exc:
            last_error = exc
            continue  # retry
 
    raise LLMParseError(
        f"Failed after {settings.llm_max_retries + 1} attempt(s). "
        f"Last error: {last_error}. "
        f"Raw output (truncated): {raw_output[:300]!r}"
    )