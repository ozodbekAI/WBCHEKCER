from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings


BASE_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    # Application
    APP_NAME: str = "WB Card Optimizer"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False
    
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
    
    # Gemini AI Settings
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-2.5-flash"
    GEMINI_MAX_OUTPUT_TOKENS: int = 8192
    GEMINI_TEMPERATURE: float = 0.2
    GEMINI_AUDIT_MAX_OUTPUT_TOKENS: int = 3072
    GEMINI_FIX_MAX_OUTPUT_TOKENS: int = 2048
    GEMINI_REFIX_MAX_OUTPUT_TOKENS: int = 1024
    GEMINI_THINKING_BUDGET_AUDIT: int = 512
    GEMINI_THINKING_BUDGET_FIX: int = 128
    GEMINI_THINKING_BUDGET_REFIX: int = 64
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
    
    # WB Advert API (for promotion/AB tests)
    WB_API_KEY: str = ""
    WB_ADVERT_API_KEY: str = ""
    
    # WB Validator Data
    WB_DATA_ZIP_PATH: str = "data/data.zip"

    # Media / public URL (used by photo chat + photo assets)
    MEDIA_ROOT: str = str((BASE_DIR / "media").resolve())
    PUBLIC_BASE_URL: str = "http://localhost:8003"

    # Frontend URL (used in email invite links)
    FRONTEND_URL: str = "http://localhost:3001"

    # Scheduler settings
    CARD_SCHEDULER_INTERVAL_SEC: int = 600  # 10 minutes

    # SMTP Email settings (leave empty to use console logging instead of real email)
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = "noreply@wb-optimizer.local"
    SMTP_TLS: bool = True

    class Config:
        env_file = ".env"
        extra = "ignore"

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


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
