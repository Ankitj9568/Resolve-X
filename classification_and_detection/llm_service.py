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
 
import asyncio
import base64
from io import BytesIO
import json
import logging
import re
import textwrap
from typing import Any
from urllib.parse import urlparse

import httpx
try:
    from google import genai
    from google.genai import types
except ImportError:
    genai = None
    types = None

try:
    from PIL import Image, ImageOps
except ImportError:
    Image = None
    ImageOps = None

from openai import APIConnectionError, APIStatusError, AsyncOpenAI, OpenAIError

from config import settings
from models import AnalyzeRequest, AnalyzeResponse, IssueCategory, VisionValidation

logger = logging.getLogger(__name__)


# ── Gemini Client (lazy initialized) ─────────────────────────────────────────

_gemini_client = None

def _get_gemini_client():
    global _gemini_client
    if _gemini_client is None:
        if genai is None:
            raise LLMAPIError("google-genai package is not installed.")
        if not settings.gemini_api_key:
            raise LLMAPIError("GEMINI_API_KEY is not configured.")
        
        _gemini_client = genai.Client(api_key=settings.gemini_api_key)
    return _gemini_client


# ── Custom Exceptions ──────────────────────────────────────────────────────────
 
class LLMTimeoutError(Exception):
    """Raised when the LLM API call exceeds the configured timeout."""
 
class LLMParseError(Exception):
    """Raised when the LLM response cannot be parsed into valid JSON / schema."""
 
class LLMAPIError(Exception):
    """Raised on non-retryable LLM API errors (auth, rate-limit, server error)."""


# ── Vision Helpers ─────────────────────────────────────────────────────────────

SUPPORTED_IMAGE_MIME_TYPES: set[str] = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
}

MIME_BY_EXTENSION: dict[str, str] = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
}


def _normalize_mime_type(value: str | None) -> str | None:
    """Normalize MIME types and restrict to the supported Gemini vision set."""
    if not value:
        return None
    candidate = value.strip().lower().split(";", 1)[0]
    if candidate == "image/jpg":
        candidate = "image/jpeg"
    if candidate in SUPPORTED_IMAGE_MIME_TYPES:
        return candidate
    return None


def _detect_mime_type_from_bytes(data: bytes) -> str | None:
    """Infer MIME type from file signatures when possible."""
    if data.startswith(b"\xFF\xD8\xFF"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if len(data) >= 12 and data[0:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def _infer_mime_type_from_url(image_url: str) -> str | None:
    parsed = urlparse(image_url)
    path = parsed.path.lower()
    for ext, mime_type in MIME_BY_EXTENSION.items():
        if path.endswith(ext):
            return mime_type
    return None


def _is_gemini_invalid_image_error(exc: Exception) -> bool:
    """Detect Gemini's image decoding/validation argument errors."""
    message = str(exc).lower()
    return (
        "unable to process input image" in message
        or "invalid_argument" in message
        or "invalid arg" in message
    )


def _sanitize_image_for_gemini(image_data: bytes, mime_type: str) -> tuple[bytes, str]:
    """Normalize problematic images into a conservative Gemini-friendly format."""
    if Image is None:
        return image_data, mime_type

    try:
        with Image.open(BytesIO(image_data)) as img:
            # Respect orientation metadata when present.
            if ImageOps is not None:
                img = ImageOps.exif_transpose(img)

            # Very tiny images are often rejected by vision endpoints.
            if img.width < 16 or img.height < 16:
                img = img.resize((max(16, img.width * 4), max(16, img.height * 4)))

            has_alpha = "A" in img.getbands()
            output = BytesIO()

            if has_alpha:
                if img.mode not in {"RGBA", "LA"}:
                    img = img.convert("RGBA")
                img.save(output, format="PNG", optimize=True)
                return output.getvalue(), "image/png"

            if img.mode != "RGB":
                img = img.convert("RGB")
            img.save(output, format="JPEG", quality=90, optimize=True)
            return output.getvalue(), "image/jpeg"
    except Exception as exc:
        logger.warning("Image sanitization failed; using original bytes: %s", exc)
        return image_data, mime_type


def _decode_base64_image(image_base64: str, mime_hint: str | None = None) -> tuple[bytes, str]:
    """Decode a base64 payload, handling both raw strings and data URIs."""
    payload = image_base64.strip()
    if not payload:
        raise ValueError("Image base64 data is empty")

    mime_type = _normalize_mime_type(mime_hint) or "image/jpeg"
    if payload.startswith("data:"):
        if "," not in payload:
            raise ValueError("Malformed data URI for image_base64")
        header, payload = payload.split(",", 1)
        declared_mime = header[5:].split(";", 1)[0] if len(header) > 5 else ""
        parsed_mime = _normalize_mime_type(declared_mime)
        if parsed_mime:
            mime_type = parsed_mime

    # Remove whitespace/newlines from pasted base64 payloads.
    payload = "".join(payload.split())
    try:
        image_data = base64.b64decode(payload, validate=True)
    except Exception as exc:
        raise ValueError(f"Invalid base64 encoding: {type(exc).__name__}: {exc}") from exc

    if not image_data:
        raise ValueError("Decoded image data is empty")
    if len(image_data) > settings.image_download_max_bytes:
        raise ValueError(
            f"Decoded image exceeds IMAGE_DOWNLOAD_MAX_BYTES ({settings.image_download_max_bytes})"
        )

    detected_mime = _detect_mime_type_from_bytes(image_data)
    if detected_mime:
        mime_type = detected_mime
    elif _normalize_mime_type(mime_type) is None:
        raise ValueError("Unsupported image MIME type in base64 payload")

    return image_data, mime_type


async def _download_image_bytes(image_url: str, mime_hint: str | None = None) -> tuple[bytes, str]:
    """Download image bytes from URL and derive a safe MIME type."""
    parsed = urlparse(image_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("image_url must be a valid HTTP(S) URL")

    timeout = httpx.Timeout(
        connect=5.0,
        read=settings.image_download_timeout_seconds,
        write=5.0,
        pool=5.0,
    )
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        response = await client.get(image_url, headers={"Accept": "image/*"})
        response.raise_for_status()
        image_data = response.content

    if not image_data:
        raise ValueError("Downloaded image is empty")
    if len(image_data) > settings.image_download_max_bytes:
        raise ValueError(
            f"Downloaded image exceeds IMAGE_DOWNLOAD_MAX_BYTES ({settings.image_download_max_bytes})"
        )

    header_mime = _normalize_mime_type(response.headers.get("content-type"))
    hinted_mime = _normalize_mime_type(mime_hint)
    url_mime = _normalize_mime_type(_infer_mime_type_from_url(image_url))
    detected_mime = _detect_mime_type_from_bytes(image_data)

    mime_type = detected_mime or hinted_mime or header_mime or url_mime
    if mime_type is None:
        raise ValueError("Unable to determine a supported image MIME type")

    if detected_mime and header_mime and detected_mime != header_mime:
        logger.warning(
            "image_url content-type mismatch: header=%s detected=%s url=%s",
            header_mime,
            detected_mime,
            image_url,
        )

    return image_data, mime_type
 
 
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
 
 
def _build_vision_prompt(text: str) -> str:
    return textwrap.dedent(f"""
You are an urban-governance vision assistant.
Analyze this image and the provided text description to assist in complaint classification.

DESCRIPTION: {text}

TASK:
1. Identify the objects, infrastructure, and hazards visible in the image.
2. Describe how the visual evidence confirms, contradicts, or adds context to the text description.
3. Note any apparent infrastructure issues, damage, or safety concerns.
4. If there is a clear contradiction between image and text (e.g., text mentions 'street light failure' but image shows 'pothole'), explicitly state 'CONFLICT DETECTED: [description]'.
5. Provide a concise final summary suitable for AI classification.

Output: A brief, factual summary (2-3 sentences) of the visual findings.
    """).strip()


async def _run_gemini_vision_pass(
    image_data: bytes,
    mime_type: str,
    text_description: str,
) -> str:
    """Run Gemini vision analysis off the event loop with an explicit timeout."""
    client = _get_gemini_client()
    if types is None:
        raise LLMAPIError("google-genai types are unavailable. Check package installation.")

    vision_prompt = _build_vision_prompt(text_description)

    def _call_gemini(data: bytes, current_mime_type: str) -> str:
        user_content = types.Content(
            role="user",
            parts=[
                types.Part.from_text(text=vision_prompt),
                types.Part.from_bytes(data=data, mime_type=current_mime_type),
            ],
        )
        response = client.models.generate_content(
            model=settings.gemini_model,
            contents=[user_content],
        )
        text = (response.text or "").strip()
        if not text:
            raise ValueError("Gemini returned empty response")
        return text

    async def _call_with_timeout(data: bytes, current_mime_type: str) -> str:
        try:
            return await asyncio.wait_for(
                asyncio.to_thread(_call_gemini, data, current_mime_type),
                timeout=settings.gemini_timeout_seconds,
            )
        except asyncio.TimeoutError as exc:
            raise LLMTimeoutError(
                f"Gemini vision pass timed out after {settings.gemini_timeout_seconds}s"
            ) from exc

    try:
        return await _call_with_timeout(image_data, mime_type)
    except Exception as exc:
        if not _is_gemini_invalid_image_error(exc):
            raise

        retry_variants: list[tuple[bytes, str]] = []
        detected_mime = _detect_mime_type_from_bytes(image_data)
        if detected_mime and detected_mime != mime_type:
            retry_variants.append((image_data, detected_mime))

        repaired_data, repaired_mime_type = await asyncio.to_thread(
            _sanitize_image_for_gemini,
            image_data,
            mime_type,
        )
        if repaired_data != image_data or repaired_mime_type != mime_type:
            retry_variants.append((repaired_data, repaired_mime_type))

        last_error: Exception = exc
        for variant_data, variant_mime in retry_variants:
            try:
                logger.warning(
                    "Gemini rejected original image; retrying variant (%s -> %s, %d -> %d bytes)",
                    mime_type,
                    variant_mime,
                    len(image_data),
                    len(variant_data),
                )
                return await _call_with_timeout(variant_data, variant_mime)
            except Exception as variant_exc:
                last_error = variant_exc
                if not _is_gemini_invalid_image_error(variant_exc):
                    raise

        raise last_error


def _select_model(request: AnalyzeRequest) -> str:
    """Select the configured NIM model."""
    return settings.nim_model
 
 
# ── Helper: extract JSON from LLM text ────────────────────────────────────────
 
_JSON_BLOCK_RE = re.compile(r"```(?:json)?\s*([\s\S]+?)\s*```", re.IGNORECASE)
_CONFLICT_RE = re.compile(r"conflict\s+detected\s*:\s*(.+)", re.IGNORECASE)


def _extract_conflict_reason(vision_text: str) -> str | None:
    """Parse the conflict reason from Gemini output when present."""
    match = _CONFLICT_RE.search(vision_text)
    if not match:
        return None
    reason = match.group(1).strip()
    if reason.endswith("."):
        reason = reason[:-1].strip()
    return reason or "Image content appears inconsistent with complaint text"
 
 
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
 
async def classify_complaint_with_validation(
    request: AnalyzeRequest,
) -> tuple[AnalyzeResponse, VisionValidation | None]:
    """
    Classify a citizen complaint using the configured LLM.

    Raises
    ------
    LLMTimeoutError  → HTTP 504
    LLMParseError    → HTTP 502
    LLMAPIError      → HTTP 502
    """
    # ── Vision Pass (Optional) ──────────────────────────────────────────────────
    vision_context: str | None = None
    vision_validation: VisionValidation | None = None
    if request.image_url or request.image_base64:
        logger.info(
            "complaint_id=%s | image present | performing vision pass with Gemini",
            request.complaint_id,
        )
        try:
            if request.image_url:
                if request.image_base64:
                    logger.info(
                        "complaint_id=%s | both image_url and image_base64 supplied; using image_url",
                        request.complaint_id,
                    )
                image_data, mime_type = await _download_image_bytes(
                    request.image_url,
                    request.image_mime_type,
                )
            else:
                image_data, mime_type = _decode_base64_image(
                    request.image_base64 or "",
                    request.image_mime_type,
                )
            
            logger.debug("complaint_id=%s | image size: %d bytes, MIME type: %s",
                        request.complaint_id, len(image_data), mime_type)

            vision_text = await _run_gemini_vision_pass(
                image_data=image_data,
                mime_type=mime_type,
                text_description=request.text_description,
            )
            vision_context = f"\n[VISUAL ANALYSIS]\n{vision_text}\n"
            conflict_reason = _extract_conflict_reason(vision_text)
            vision_validation = VisionValidation(
                enabled=True,
                summary=vision_text,
                conflict_detected=conflict_reason is not None,
                conflict_reason=conflict_reason,
            )
            logger.info("complaint_id=%s | vision analysis complete | length: %d chars",
                        request.complaint_id, len(vision_text))
            if conflict_reason:
                logger.warning(
                    "complaint_id=%s | conflict detected by Gemini: %s",
                    request.complaint_id,
                    conflict_reason,
                )
            
        except Exception as e:
            logger.warning("complaint_id=%s | Gemini vision analysis failed: %s: %s | falling back to text-only",
                          request.complaint_id, type(e).__name__, str(e)[:200])
            # Vision analysis is optional — proceed with text alone
            vision_context = None
            vision_validation = VisionValidation(
                enabled=True,
                summary=None,
                conflict_detected=False,
                conflict_reason=None,
            )

    # ── Text Pass ───────────────────────────────────────────────────────────────
    full_text = request.text_description
    if vision_context:
        full_text = f"{request.text_description}{vision_context}"
    
    # Build the message content for NIM text classification model
    user_message_content = [{
        "type": "text",
        "text": (
            f"Analyze the following citizen complaint and return the JSON object as instructed.\n\n"
            f"COMPLAINT:\n{full_text}\n\n"
            f"Output ONLY the JSON object, nothing else. Do not include markdown formatting."
        ),
    }]

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user",   "content": user_message_content},
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
            return response, vision_validation
 
        except Exception as exc:
            last_error = exc
            continue  # retry
 
    raise LLMParseError(
        f"Failed after {settings.llm_max_retries + 1} attempt(s). "
        f"Last error: {last_error}. "
        f"Raw output (truncated): {raw_output[:300]!r}"
    )


async def classify_complaint(request: AnalyzeRequest) -> AnalyzeResponse:
    """Backward-compatible wrapper returning only the classification payload."""
    response, _ = await classify_complaint_with_validation(request)
    return response