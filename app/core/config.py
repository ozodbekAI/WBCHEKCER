from functools import lru_cache
import json
from pathlib import Path
from typing import Any

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


BASE_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Application
    APP_NAME: str = "WB Card Optimizer"
    APP_VERSION: str = "1.0.0"
    APP_ENV: str = "development"
    DEBUG: bool = False
    HTTP_DEBUG_LOG: bool = False
    
    # Database
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/wb_optimizer"
    DATABASE_URL_SYNC: str = "postgresql://postgres:postgres@localhost:5432/wb_optimizer"
    
    # JWT
    SECRET_KEY: str = "your-super-secret-key-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 24 hours
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    
    # Redis (for Celery)
    REDIS_URL: str = "redis://localhost:6379/0"
    
    # Wildberries API URLs (https://dev.wildberries.ru/docs/openapi/api-information)
    WB_COMMON_API_URL: str = "https://common-api.wildberries.ru"
    WB_CONTENT_API_URL: str = "https://content-api.wildberries.ru"
    WB_STATISTICS_API_URL: str = "https://statistics-api.wildberries.ru"
    WB_ANALYTICS_API_URL: str = "https://seller-analytics-api.wildberries.ru"
    WB_PRICES_API_URL: str = "https://discounts-prices-api.wildberries.ru"
    WB_MARKETPLACE_API_URL: str = "https://marketplace-api.wildberries.ru"
    WB_ADVERT_API_URL: str = "https://advert-api.wildberries.ru"
    WB_FEEDBACKS_API_URL: str = "https://feedbacks-api.wildberries.ru"
    
    # Analysis Settings
    ANALYSIS_BATCH_SIZE: int = 100
    MIN_TITLE_LENGTH: int = 40
    MAX_TITLE_LENGTH: int = 60
    MIN_DESCRIPTION_LENGTH: int = 1000
    MAX_DESCRIPTION_LENGTH: int = 1800
    MIN_PHOTOS_COUNT: int = 3
    RECOMMENDED_PHOTOS_COUNT: int = 6
    MEDIA_WARNING_PHOTOS_COUNT: int = 30
    
    # Gemini AI Settings
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-3.1-pro-preview"
    GEMINI_TEXT_MODEL: str = "gemini-3.1-pro-preview"
    GEMINI_TEXT_MODEL_FALLBACK: str = "gemini-3.1-flash-lite-preview"
    GEMINI_TEXT_SERVICE_TIER: str = "standard"
    GEMINI_TEXT_TIMEOUT_S: float = 15.0
    GEMINI_TEXT_MAX_RETRIES: int = 0
    GEMINI_TEXT_FALLBACK_MAX_RETRIES: int = 1
    GEMINI_TEXT_THINKING_LEVEL: str = "low"
    GEMINI_VISION_MODEL: str = "gemini-3.1-pro-preview"
    GEMINI_VISION_MODEL_FALLBACK: str = "gemini-3.1-flash-lite-preview"
    GEMINI_VISION_SERVICE_TIER: str = "standard"
    GEMINI_VISION_TIMEOUT_S: float = 12.0
    GEMINI_VISION_MAX_RETRIES: int = 0
    GEMINI_VISION_FALLBACK_MAX_RETRIES: int = 1
    GEMINI_VISION_THINKING_LEVEL: str = "low"
    GEMINI_IMAGE_MODEL: str = "gemini-3-pro-image-preview"
    GEMINI_IMAGE_MODEL_FALLBACK: str = "gemini-3.1-flash-image-preview"
    GEMINI_IMAGE_SERVICE_TIER: str = "standard"
    GEMINI_IMAGE_TIMEOUT_S: float = 25.0
    GEMINI_IMAGE_FALLBACK_TIMEOUT_S: float = 45.0
    GEMINI_IMAGE_MAX_RETRIES: int = 0
    GEMINI_IMAGE_FALLBACK_MAX_RETRIES: int = 1
    GEMINI_IMAGE_SELECTED_MODEL_MAX_RETRIES: int = 9
    PHOTO_CHAT_STREAM_KEEPALIVE_S: float = 15.0
    GEMINI_MAX_OUTPUT_TOKENS: int = 8192
    GEMINI_TEMPERATURE: float = 0.2
    GEMINI_AUDIT_MAX_OUTPUT_TOKENS: int = 3072
    GEMINI_FIX_MAX_OUTPUT_TOKENS: int = 2048
    GEMINI_REFIX_MAX_OUTPUT_TOKENS: int = 1024
    GEMINI_THINKING_BUDGET_AUDIT: int = 512
    GEMINI_THINKING_BUDGET_FIX: int = 128
    GEMINI_THINKING_BUDGET_REFIX: int = 64
    AI_CONTEXT_PHOTOS_COUNT: int = 2
    AI_ENABLED: bool = True

    # AI Provider: "gemini" yoki "gpt"
    # gemini → barcha AI chaqiruvlar Gemini orqali (audit, fixes, title, description)
    # gpt    → barcha AI chaqiruvlar GPT-4o-mini orqali (foto tahlil + generatsiya)
    AI_PROVIDER: str = "gemini"

    # OpenAI Settings
    OPENAI_API_KEY: str = ""
    OPENAI_VISION_MODEL: str = "gpt-4o-mini"  # foto tahlil uchun (product DNA)
    OPENAI_MODEL: str = "gpt-4o-mini"          # GPT provider rejimida barcha AI uchun
    
    # KIE AI Service
    KIE_API_KEY: str = ""
    KIE_POLL_INTERVAL_SECONDS: int = 10
    KIE_MAX_POLL_ATTEMPTS: int = 0
    
    # WB Advert API (for promotion/AB tests)
    WB_API_KEY: str = ""
    WB_ADVERT_API_KEY: str = ""
    
    # WB Validator Data (extracted folder only)
    WB_DATA_PATH: str = "data/data"

    # Media / public URL (used by photo chat + photo assets)
    MEDIA_ROOT: str = str((BASE_DIR / "media").resolve())
    PUBLIC_BASE_URL: str = "http://localhost:8002"
    MEDIA_PUBLIC_BASE_URL: str = ""

    # Frontend URL (used in email invite links)
    FRONTEND_URL: str = "http://localhost:3001"

    # Scheduler settings
    CARD_SCHEDULER_ENABLED: bool = True
    CARD_SCHEDULER_INTERVAL_SEC: int = 600  # 10 minutes

    # CORS
    CORS_ALLOWED_ORIGINS: list[str] = []

    # SMTP Email settings (leave empty to use console logging instead of real email)
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = "noreply@wb-optimizer.local"
    SMTP_TLS: bool = True

    @field_validator("DEBUG", mode="before")
    @classmethod
    def _parse_debug(cls, v):
        if isinstance(v, bool):
            return v
        if isinstance(v, str):
            vv = v.strip().lower()
            if vv in {"1", "true", "yes", "on", "debug", "dev"}:
                return True
            if vv in {"0", "false", "no", "off", "release", "prod", "production"}:
                return False
        return False

    @field_validator("APP_ENV", mode="before")
    @classmethod
    def _normalize_app_env(cls, value: Any) -> str:
        raw = str(value or "").strip().lower()
        if not raw:
            return "development"

        aliases = {
            "dev": "development",
            "development": "development",
            "local": "development",
            "test": "test",
            "testing": "test",
            "prod": "production",
            "production": "production",
        }
        normalized = aliases.get(raw)
        if normalized is None:
            raise ValueError("APP_ENV must be one of: development, test, production")
        return normalized

    @field_validator("CORS_ALLOWED_ORIGINS", mode="before")
    @classmethod
    def _parse_cors_allowed_origins(cls, value: Any) -> list[str]:
        if value is None or value == "":
            return []
        if isinstance(value, str):
            raw = value.strip()
            if not raw:
                return []
            if raw.startswith("["):
                try:
                    parsed = json.loads(raw)
                except json.JSONDecodeError:
                    parsed = None
                if isinstance(parsed, list):
                    return [str(item).strip() for item in parsed if str(item).strip()]
            return [item.strip() for item in raw.split(",") if item.strip()]
        if isinstance(value, (list, tuple, set)):
            return [str(item).strip() for item in value if str(item).strip()]
        raise TypeError("Invalid CORS_ALLOWED_ORIGINS value")

    @field_validator("PUBLIC_BASE_URL", "MEDIA_PUBLIC_BASE_URL", mode="before")
    @classmethod
    def _normalize_public_base_url(cls, value: Any) -> str:
        if value is None:
            return ""
        return str(value).strip().rstrip("/")

    @model_validator(mode="after")
    def _validate_security_settings(self):
        insecure_default = "your-super-secret-key-change-in-production"
        secret = str(self.SECRET_KEY or "").strip()
        if self.APP_ENV == "production" and (
            not secret or secret == insecure_default or secret.startswith(insecure_default)
        ):
            raise ValueError("SECRET_KEY must be set explicitly outside non-production environments")
        return self


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
