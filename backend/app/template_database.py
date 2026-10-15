"""The shared uploaded-template service has its own database and engine."""

import os
from datetime import datetime, timezone

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Integer,
    LargeBinary,
    String,
    UniqueConstraint,
    create_engine,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column
from sqlalchemy.types import JSON


class Base(DeclarativeBase):
    pass


def now():
    return datetime.now(timezone.utc)


class Template(Base):
    __tablename__ = "templates"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    title: Mapped[str] = mapped_column(String(100))
    definition: Mapped[dict] = mapped_column(JSON().with_variant(JSONB, "postgresql"))
    source_pdf: Mapped[bytes] = mapped_column(LargeBinary)
    blank_pdf: Mapped[bytes] = mapped_column(LargeBinary)
    thumbnail: Mapped[bytes] = mapped_column(LargeBinary)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Draft(Base):
    __tablename__ = "template_drafts"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    template_id: Mapped[str] = mapped_column(ForeignKey("templates.id"), index=True)
    title: Mapped[str] = mapped_column(String(100))
    form: Mapped[dict] = mapped_column(JSON().with_variant(JSONB, "postgresql"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now, onupdate=now
    )


class DraftImage(Base):
    __tablename__ = "template_draft_images"
    draft_id: Mapped[str] = mapped_column(
        ForeignKey("template_drafts.id"), primary_key=True
    )
    field_id: Mapped[str] = mapped_column(String(80), primary_key=True)
    payload: Mapped[bytes] = mapped_column(LargeBinary)
    filename: Mapped[str] = mapped_column(String(255))
    media_type: Mapped[str] = mapped_column(String(40))


class TemplateRevision(Base):
    """Immutable PDF/schema snapshots. Added tables preserve existing installations."""

    __tablename__ = "template_revisions"
    __table_args__ = (
        UniqueConstraint(
            "template_id", "number", name="unique_template_revision_number"
        ),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    template_id: Mapped[str] = mapped_column(ForeignKey("templates.id"), index=True)
    number: Mapped[int] = mapped_column(Integer)
    definition: Mapped[dict] = mapped_column(JSON().with_variant(JSONB, "postgresql"))
    source_pdf: Mapped[bytes] = mapped_column(LargeBinary)
    blank_pdf: Mapped[bytes] = mapped_column(LargeBinary)
    thumbnail: Mapped[bytes] = mapped_column(LargeBinary)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class DraftRevision(Base):
    __tablename__ = "template_draft_revisions"
    draft_id: Mapped[str] = mapped_column(
        ForeignKey("template_drafts.id"), primary_key=True
    )
    revision_id: Mapped[str] = mapped_column(ForeignKey("template_revisions.id"))


class TemplateArchive(Base):
    __tablename__ = "template_archives"
    template_id: Mapped[str] = mapped_column(
        ForeignKey("templates.id"), primary_key=True
    )
    archived_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


_engine = None


def engine():
    global _engine
    if _engine is None:
        url = os.environ.get(
            "TEMPLATE_DATABASE_URL",
            "postgresql+psycopg://templates:templates@127.0.0.1:5434/templates",
        )
        _engine = create_engine(url, pool_pre_ping=True)
    return _engine


def init_db():
    Base.metadata.create_all(engine())


def get_db():
    with Session(engine()) as session:
        yield session
