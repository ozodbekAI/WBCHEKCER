# core/dependencies.py
# Compatibility layer - re-export from existing modules
from app.core.security import get_current_user, require_admin
from app.core.database import get_db_dependency

__all__ = ["get_current_user", "get_db_dependency", "require_admin"]
