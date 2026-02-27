from datetime import datetime
from sqlalchemy import BigInteger, String, Integer, DateTime, Text, Boolean, Float, Enum as SQLEnum, ForeignKey
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from typing import Optional, List
import enum

from app.core.database import Base


class TaskStatus(enum.Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class TaskType(enum.Enum):
    PRODUCT_CARD = "product_card"
    NORMALIZE_OWN_MODEL = "normalize_own_model"
    NORMALIZE_NEW_MODEL = "normalize_new_model"
    VIDEO_BALANCE = "video_balance"
    VIDEO_PRO_6 = "video_pro_6"
    VIDEO_PRO_10 = "video_pro_10"
    VIDEO_SUPER_6 = "video_super_6"
    PHOTO_SCENE = "photo_scene"
    PHOTO_POSE = "photo_pose"
    PHOTO_CUSTOM = "photo_custom"





class PoseGroup(Base):
    __tablename__ = "pose_groups"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255))
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    
    subgroups: Mapped[List["PoseSubgroup"]] = relationship("PoseSubgroup", back_populates="group", cascade="all, delete-orphan")


class PoseSubgroup(Base):
    __tablename__ = "pose_subgroups"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    group_id: Mapped[int] = mapped_column(Integer, ForeignKey("pose_groups.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    
    group: Mapped["PoseGroup"] = relationship("PoseGroup", back_populates="subgroups")
    prompts: Mapped[List["PosePrompt"]] = relationship("PosePrompt", back_populates="subgroup", cascade="all, delete-orphan")


class PosePrompt(Base):
    __tablename__ = "pose_prompts"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    subgroup_id: Mapped[int] = mapped_column(Integer, ForeignKey("pose_subgroups.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    prompt: Mapped[str] = mapped_column(Text)
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    
    subgroup: Mapped["PoseSubgroup"] = relationship("PoseSubgroup", back_populates="prompts")


class ModelCategory(Base):
    __tablename__ = "model_categories"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255))
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    
    subcategories: Mapped[List["ModelSubcategory"]] = relationship(
        "ModelSubcategory", back_populates="category", cascade="all, delete-orphan"
    )


class ModelSubcategory(Base):
    __tablename__ = "model_subcategories"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    category_id: Mapped[int] = mapped_column(Integer, ForeignKey("model_categories.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    
    category: Mapped["ModelCategory"] = relationship("ModelCategory", back_populates="subcategories")
    items: Mapped[List["ModelItem"]] = relationship("ModelItem", back_populates="subcategory", cascade="all, delete-orphan")


class ModelItem(Base):
    __tablename__ = "model_items"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    subcategory_id: Mapped[int] = mapped_column(Integer, ForeignKey("model_subcategories.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    prompt: Mapped[str] = mapped_column(Text)  
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    
    subcategory: Mapped["ModelSubcategory"] = relationship("ModelSubcategory", back_populates="items")


class VideoScenario(Base):
    __tablename__ = "video_scenarios"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    prompt: Mapped[str] = mapped_column(Text)
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class SceneCategory(Base):
    __tablename__ = "scene_categories"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255))
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    
    subcategories: Mapped[List["SceneSubcategory"]] = relationship(
        "SceneSubcategory", back_populates="category", cascade="all, delete-orphan"
    )


class SceneSubcategory(Base):
    __tablename__ = "scene_subcategories"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    category_id: Mapped[int] = mapped_column(Integer, ForeignKey("scene_categories.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    
    category: Mapped["SceneCategory"] = relationship("SceneCategory", back_populates="subcategories")
    items: Mapped[List["SceneItem"]] = relationship("SceneItem", back_populates="subcategory", cascade="all, delete-orphan")


class SceneItem(Base):
    __tablename__ = "scene_items"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    subcategory_id: Mapped[int] = mapped_column(Integer, ForeignKey("scene_subcategories.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    prompt: Mapped[str] = mapped_column(Text)
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    
    subcategory: Mapped["SceneSubcategory"] = relationship("SceneSubcategory", back_populates="items")


class AdminLog(Base):
    __tablename__ = "admin_logs"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    admin_id: Mapped[int] = mapped_column(BigInteger, index=True)
    action: Mapped[str] = mapped_column(String(100))
    details: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)