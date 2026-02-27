# models/photo_asset.py

from datetime import datetime
from sqlalchemy import String, Integer, DateTime, Text, Boolean, Enum as SQLEnum, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from typing import Optional
import enum

from app.core.database import Base


class AssetType(enum.Enum):
    """Asset turlari"""
    MODEL = "model"           # Modellar (obrazlar)
    SCENE = "scene"           # Lokatsiyalar/Fonlar
    POSE = "pose"             # Pozalar
    CUSTOM = "custom"         # Boshqa


class AssetOwnerType(enum.Enum):
    """Asset egasi turi"""
    SYSTEM = "system"         # Admin yuklaydigan (hamma uchun)
    USER = "user"             # Foydalanuvchi o'ziniki


class PhotoAsset(Base):
    """
    Photo Studio uchun assetlar (modellar, lokatsiyalar, pozalar)
    - System assets: Admin yuklaydigan, barcha userlar ko'radi
    - User assets: Har bir user o'zi yuklaydigan, faqat o'zi ko'radi
    """
    __tablename__ = "photo_assets"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    
    # Asset turi
    asset_type: Mapped[AssetType] = mapped_column(SQLEnum(AssetType), index=True)
    
    # Egalik turi (system yoki user)
    owner_type: Mapped[AssetOwnerType] = mapped_column(
        SQLEnum(AssetOwnerType), 
        default=AssetOwnerType.SYSTEM,
        index=True
    )
    
    # User ID (faqat owner_type=USER bo'lganda)
    user_id: Mapped[Optional[int]] = mapped_column(
        Integer, 
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,
        index=True
    )
    
    # Asset ma'lumotlari
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    prompt: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # AI uchun prompt
    
    # Rasm URL
    image_url: Mapped[str] = mapped_column(String(500))
    thumbnail_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    
    # Kategoriya (ixtiyoriy)
    category: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    subcategory: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    
    # Tartib va status
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    
    # Metadata
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def __repr__(self):
        return f"<PhotoAsset(id={self.id}, type={self.asset_type.value}, name={self.name})>"
