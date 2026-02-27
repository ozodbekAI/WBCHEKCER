from .auth import router as auth_router
from .stores import router as stores_router
from .cards import router as cards_router
from .issues import router as issues_router, cards_router as card_issues_router
from .dashboard import router as dashboard_router
from .admin import router as admin_router
from .promotion import router as promotion_router
from .photo_assets import router as photo_assets_router
from .photo_chat import router as photo_chat_router
from .team import router as team_router
from .sync import router as sync_router
from .fixed_files import router as fixed_files_router

__all__ = [
    "auth_router",
    "stores_router",
    "cards_router",
    "issues_router",
    "card_issues_router",
    "dashboard_router",
    "admin_router",
    "promotion_router",
    "photo_assets_router",
    "photo_chat_router",
    "team_router",
    "sync_router",
    "fixed_files_router",
]
