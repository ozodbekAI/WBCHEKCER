import os
import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from .core.config import settings
from .core.database import async_engine
from .models import StoreApiKey
from .services.card_scheduler import card_scheduler
from .services.ad_analysis_bootstrap_scheduler import ad_analysis_bootstrap_scheduler
from .services.task_service import recover_incomplete_tasks
from .routers import (
    auth_router,
    stores_router,
    cards_router,
    issues_router,
    card_issues_router,
    dashboard_router,
    admin_router,
    promotion_router,
    photo_assets_router,
    photo_chat_router,
    team_router,
    sync_router,
    fixed_files_router,
    scheduler_router,
    sku_economics_router,
)

DEV_CORS_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
]


def _get_cors_origins() -> list[str]:
    # Temporary non-production mode: allow all origins.
    return ["*"]


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start background schedulers on startup, stop on shutdown."""
    scheduler_started = False
    ad_analysis_scheduler_started = False
    async with async_engine.begin() as conn:
        await conn.run_sync(StoreApiKey.__table__.create, checkfirst=True)
    await recover_incomplete_tasks()
    if settings.CARD_SCHEDULER_ENABLED:
        card_scheduler.start_background()
        scheduler_started = True
    ad_analysis_bootstrap_scheduler.start_background()
    ad_analysis_scheduler_started = True
    yield
    if scheduler_started:
        card_scheduler.stop()
    if ad_analysis_scheduler_started:
        ad_analysis_bootstrap_scheduler.stop()


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="Wildberries Card Optimization API",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

http_debug_logger = logging.getLogger("http.debug")
http_debug_logger.setLevel(logging.INFO)


def _configure_debug_loggers() -> None:
    debug_logger_names = (
        "http.debug",
        "photo.chat.controller",
        "photo.chat.router",
        "photo.chat.agent",
        "app.services.kie_service.kie_services",
        "app.services.kie_service.translator",
        "photo.studio.cards.router",
    )

    fallback_handlers = list(logging.getLogger("uvicorn.error").handlers)
    if not fallback_handlers:
        fallback_handlers = list(logging.getLogger().handlers)

    # Если приложение запущено не через uvicorn, добавим fallback-обработчик в stdout,
    # чтобы INFO-логи всегда были видны в терминале.
    created_default_handler = None
    if not fallback_handlers:
        created_default_handler = logging.StreamHandler()
        created_default_handler.setLevel(logging.INFO)
        created_default_handler.setFormatter(
            logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")
        )
        fallback_handlers = [created_default_handler]

    for logger_name in debug_logger_names:
        logging.getLogger(logger_name).setLevel(logging.INFO)
        logger = logging.getLogger(logger_name)
        if not logger.handlers and fallback_handlers:
            logger.handlers.clear()
            for handler in fallback_handlers:
                logger.addHandler(handler)
        logger.propagate = False

    if created_default_handler is not None and not logging.getLogger().handlers:
        logging.getLogger().addHandler(created_default_handler)


_configure_debug_loggers()


@app.middleware("http")
async def _http_debug_log(request: Request, call_next):
    """Optional debug logger for investigating frontend/backend mismatches."""
    if not getattr(settings, "HTTP_DEBUG_LOG", False):
        return await call_next(request)

    path = request.url.path
    if not (
        path.startswith("/stores")
        or path.startswith("/api/stores")
        or path.startswith("/auth")
        or path.startswith("/api/auth")
        or path.startswith("/photo")
        or path.startswith("/api/photo")
        or path.startswith("/photo-assets")
        or path.startswith("/api/photo-assets")
    ):
        return await call_next(request)

    start = time.perf_counter()
    qs = request.url.query
    full_path = f"{path}?{qs}" if qs else path
    origin = request.headers.get("origin")
    auth_present = bool(request.headers.get("authorization"))
    x_store_id = request.headers.get("x-store-id")
    client_host = getattr(getattr(request, "client", None), "host", None)

    try:
        response = await call_next(request)
    except Exception:
        dt_ms = (time.perf_counter() - start) * 1000.0
        http_debug_logger.exception(
            "HTTP %s %s -> EXC ms=%.1f client=%s origin=%s auth=%s x-store=%s",
            request.method,
            full_path,
            dt_ms,
            client_host,
            origin,
            "yes" if auth_present else "no",
            x_store_id,
        )
        raise

    dt_ms = (time.perf_counter() - start) * 1000.0
    http_debug_logger.info(
        "HTTP %s %s -> %s ms=%.1f client=%s origin=%s auth=%s x-store=%s",
        request.method,
        full_path,
        int(getattr(response, "status_code", 0) or 0),
        dt_ms,
        client_host,
        origin,
        "yes" if auth_present else "no",
        x_store_id,
    )
    return response

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=_get_cors_origins(),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve uploaded/generated media files used by Photo Studio and assets APIs.
MEDIA_DIR = Path(settings.MEDIA_ROOT)
MEDIA_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/media", StaticFiles(directory=str(MEDIA_DIR)), name="media")

# Include routers
app.include_router(auth_router)
# Compatibility alias for deployments/frontends that prefix all API calls with `/api`.
# This keeps the existing `/auth/*` routes working while also supporting `/api/auth/*`.
app.include_router(auth_router, prefix="/api")
app.include_router(stores_router)
app.include_router(stores_router, prefix="/api")
app.include_router(cards_router)
app.include_router(cards_router, prefix="/api")
app.include_router(issues_router)
app.include_router(issues_router, prefix="/api")
app.include_router(card_issues_router)
app.include_router(card_issues_router, prefix="/api")
app.include_router(dashboard_router)
app.include_router(dashboard_router, prefix="/api")
app.include_router(admin_router)
app.include_router(admin_router, prefix="/api")
app.include_router(promotion_router)
app.include_router(promotion_router, prefix="/api")
app.include_router(photo_assets_router)
app.include_router(photo_assets_router, prefix="/api")
app.include_router(photo_chat_router)
# Compatibility alias for older builds that already include `/api` in Photo Studio paths while also using API base `/api`.
# This enables `/api/api/photo/*` in addition to the canonical `/api/photo/*`.
app.include_router(photo_chat_router, prefix="/api")
app.include_router(team_router)
app.include_router(team_router, prefix="/api")
app.include_router(sync_router)
app.include_router(sync_router, prefix="/api")
app.include_router(fixed_files_router)
app.include_router(fixed_files_router, prefix="/api")
app.include_router(scheduler_router)
app.include_router(scheduler_router, prefix="/api")
app.include_router(sku_economics_router)
app.include_router(sku_economics_router, prefix="/api")

# Serve frontend static files (built React app)
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend" / "dist"

@app.get("/health")
async def health_check():
    """Health check endpoint with scheduler status"""
    scheduler_status = card_scheduler.get_status()
    return {
        "status": "healthy",
        "scheduler": {
            "enabled": settings.CARD_SCHEDULER_ENABLED,
            "is_running": scheduler_status["is_running"],
            "last_tick": scheduler_status["last_tick_at"],
            "next_tick_in": scheduler_status["next_tick_in_sec"],
        }
    }


# Serve frontend static files (built React app)
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend" / "dist"

if FRONTEND_DIR.exists():
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIR / "assets")), name="static")

    # Known API prefixes — never serve index.html for these
    _API_PREFIXES = (
        "auth", "stores", "dashboard", "admin", "promotion",
        "photo-assets", "api", "docs", "redoc", "openapi.json",
        "media", "health", "assets",
    )

    @app.get("/{full_path:path}")
    async def serve_frontend(request: Request, full_path: str):
        """Serve React SPA — all non-API routes get index.html"""
        first_segment = full_path.split("/")[0] if full_path else ""
        if first_segment in _API_PREFIXES:
            from fastapi.responses import JSONResponse
            return JSONResponse(status_code=404, content={"detail": "Not found"})

        # Try to serve the exact file first
        file_path = FRONTEND_DIR / full_path
        if file_path.is_file():
            return FileResponse(str(file_path))

        # Read index.html at request time to avoid Content-Length mismatch on deploy
        from fastapi.responses import Response
        index_content = (FRONTEND_DIR / "index.html").read_bytes()
        return Response(content=index_content, media_type="text/html")
else:
    @app.get("/")
    async def root():
        return {
            "name": settings.APP_NAME,
            "version": settings.APP_VERSION,
            "status": "running",
            "frontend": "not built — run 'cd frontend && npm run build'",
        }
