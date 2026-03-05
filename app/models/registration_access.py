from datetime import datetime

from sqlalchemy import Column, DateTime, Integer, String

from ..core.database import Base


class RegistrationAccessRequest(Base):
    """
    Stores resend cooldown + temporary password hash for email-based sign up.
    One row per email.
    """

    __tablename__ = "registration_access_requests"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    temp_password_hash = Column(String(255), nullable=False)
    first_name = Column(String(100), nullable=True)
    last_name = Column(String(100), nullable=True)
    expires_at = Column(DateTime, nullable=False)
    cooldown_until = Column(DateTime, nullable=False)
    sent_count = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
