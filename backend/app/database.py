from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Iterator

from sqlalchemy import DateTime, LargeBinary, String, create_engine
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column
from sqlalchemy.types import JSON


class Base(DeclarativeBase):
    pass


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


class Draft(Base):
    __tablename__ = "fault_report_drafts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    title: Mapped[str] = mapped_column(String(100), nullable=False)
    company: Mapped[str] = mapped_column(String(42), default="", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)
    form_data: Mapped[dict] = mapped_column(JSON().with_variant(JSONB, "postgresql"), nullable=False)
    equipment_image: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    equipment_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    equipment_media_type: Mapped[str | None] = mapped_column(String(40), nullable=True)
    infrared_image: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    infrared_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    infrared_media_type: Mapped[str | None] = mapped_column(String(40), nullable=True)


class Company(Base):
    __tablename__ = "fault_report_companies"

    name_key: Mapped[str] = mapped_column(String(42), primary_key=True)
    name: Mapped[str] = mapped_column(String(42), nullable=False)


class TemplateSetting(Base):
    __tablename__ = "fault_report_template_settings"

    template_key: Mapped[str] = mapped_column(String(40), primary_key=True)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False)


_engine = None


def engine():
    global _engine
    if _engine is None:
        url = os.environ.get("DATABASE_URL", "postgresql+psycopg://fault_report:fault_report@127.0.0.1:5432/fault_report")
        _engine = create_engine(url, pool_pre_ping=True)
    return _engine


def init_db() -> None:
    Base.metadata.create_all(engine())


def get_db() -> Iterator[Session]:
    with Session(engine()) as session:
        yield session
