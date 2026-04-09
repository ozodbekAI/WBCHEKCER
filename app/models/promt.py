# models/promt.py
from datetime import datetime

from sqlalchemy import (
    Column,
    Integer,
    String,
    Text,
    DateTime,
    Boolean,
    ForeignKey,
)
from sqlalchemy.orm import relationship

from app.core.database import Base
from app.core.time import utc_now


class PromptTemplate(Base):
    __tablename__ = "prompt_templates"

    id = Column(Integer, primary_key=True, index=True)
    prompt_type = Column(String(50), unique=True, nullable=False, index=True)

    system_prompt = Column(Text, nullable=False)
    strict_rules = Column(Text, nullable=True)
    examples = Column(Text, nullable=True)

    version = Column(Integer, default=1)
    is_active = Column(Boolean, default=True)

    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(
        DateTime,
        default=utc_now,
        onupdate=utc_now,
    )

    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)

    creator = relationship("User", back_populates="created_prompts")
    versions = relationship(
        "PromptVersion",
        back_populates="template",
        cascade="all, delete-orphan",
    )



class PromptVersion(Base):
    __tablename__ = "prompt_versions"

    id = Column(Integer, primary_key=True, index=True)
    prompt_template_id = Column(
        Integer,
        ForeignKey("prompt_templates.id"),
        nullable=False,
        index=True,
    )

    system_prompt = Column(Text, nullable=False)
    strict_rules = Column(Text, nullable=True)
    examples = Column(Text, nullable=True)
    version = Column(Integer, nullable=False)

    created_at = Column(DateTime, default=utc_now)
    created_by = Column(String(100), nullable=True)
    change_reason = Column(Text, nullable=True)

    template = relationship("PromptTemplate", back_populates="versions")
