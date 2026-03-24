"""
config.py — ResolveX Classification Service
============================================
Centralised settings loaded from environment variables (or a .env file in dev).
All sensitive values (API keys, URLs) live here — never hard-coded elsewhere.

Usage
-----
    from config import settings
    client = OpenAI(api_key=settings.nim_api_key, base_url=settings.nim_base_url)
"""

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """
    Application settings.

    Pydantic-settings reads values from (in order of precedence):
      1. Actual environment variables
      2. A `.env` file in the working directory (dev convenience)
      3. The default values defined below

    Add new secrets here — never sprinkle os.getenv() calls across the codebase.
    """

    model_config = SettingsConfigDict(
        env_file=".env",          # Load from .env in dev; ignored if missing
        env_file_encoding="utf-8",
        case_sensitive=False,     # NIM_API_KEY == nim_api_key
        extra="ignore",           # Ignore extra keys like NIM_VISION_MODEL in .env
    )

    # ── NVIDIA NIM / OpenAI-compatible LLM ─────────────────────────────────────
    nim_api_key: str = Field(
        ...,
        alias="NIM_API_KEY",
        description="NVIDIA NIM API key (required).",
    )
    nim_base_url: str = Field(
        default="https://integrate.api.nvidia.com/v1",
        alias="NIM_BASE_URL",
        description="NVIDIA NIM OpenAI-compatible base URL.",
    )
    nim_model: str = Field(
        default="meta/llama-3.1-8b-instruct",
        alias="NIM_MODEL",
        description=(
            "Text model identifier as listed in the NVIDIA API catalog. "
            "Must be available to your API key."
        ),
    )

    # ── LLM Behaviour ──────────────────────────────────────────────────────────
    llm_temperature: float = Field(
        default=0.1,
        ge=0.0,
        le=2.0,
        alias="LLM_TEMPERATURE",
        description="Low temperature → deterministic, structured JSON output.",
    )
    llm_max_tokens: int = Field(
        default=1_024,
        ge=256,
        le=4_096,
        alias="LLM_MAX_TOKENS",
        description="Maximum tokens in the LLM completion.",
    )
    llm_timeout_seconds: float = Field(
        default=30.0,
        ge=5.0,
        alias="LLM_TIMEOUT_SECONDS",
        description="HTTP timeout for LLM API calls (seconds).",
    )
    llm_max_retries: int = Field(
        default=2,
        ge=0,
        le=5,
        alias="LLM_MAX_RETRIES",
        description="Number of automatic retries on transient LLM errors.",
    )
    nim_disable_reasoning: bool = Field(
        default=True,
        alias="NIM_DISABLE_REASONING",
        description=(
            "Disable reasoning/thinking mode where supported (e.g. Qwen via "
            "chat_template_kwargs.thinking=false)."
        ),
    )

    # ── FastAPI / Service ───────────────────────────────────────────────────────
    service_name: str = Field(
        default="ResolveX Classification Service",
        alias="SERVICE_NAME",
    )
    api_version: str = Field(default="v1", alias="API_VERSION")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")
    cors_origins: list[str] = Field(
        default=["*"],
        alias="CORS_ORIGINS",
        description="Allowed CORS origins. Restrict in production.",
    )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """
    Return a cached singleton Settings instance.
    The @lru_cache means the .env file is read only once per process — fast and
    safe to call anywhere without performance concern.
    """
    return Settings()


# Module-level convenience alias
settings: Settings = get_settings()
