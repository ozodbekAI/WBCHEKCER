import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from .core.config import settings
from .services.card_scheduler import card_scheduler
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
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start background schedulers on startup, stop on shutdown."""
    card_scheduler.start_background()
    yield
    card_scheduler.stop()


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="Wildberries Card Optimization API",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve uploaded/generated media files used by Photo Studio and assets APIs.
MEDIA_DIR = Path(settings.MEDIA_ROOT)
MEDIA_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/media", StaticFiles(directory=str(MEDIA_DIR)), name="media")

# Include routers
app.include_router(auth_router)
app.include_router(stores_router)
app.include_router(cards_router)
app.include_router(issues_router)
app.include_router(card_issues_router)
app.include_router(dashboard_router)
app.include_router(admin_router)
app.include_router(promotion_router)
app.include_router(photo_assets_router)
app.include_router(photo_chat_router)
app.include_router(team_router)
app.include_router(sync_router)
app.include_router(fixed_files_router)

# Serve frontend static files (built React app)
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend" / "dist"

@app.get("/health")
async def health_check():
    return {"status": "healthy"}


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

        # Otherwise serve index.html (SPA routing)
        return FileResponse(str(FRONTEND_DIR / "index.html"))
else:
    @app.get("/")
    async def root():
        return {
            "name": settings.APP_NAME,
            "version": settings.APP_VERSION,
            "status": "running",
            "frontend": "not built — run 'cd frontend && npm run build'",
        }
