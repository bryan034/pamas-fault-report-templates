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
from .deployment import is_cloud, validate_environment


class Base(DeclarativeBase):
    pass


def now():
    return datetime.now(timezone.utc)


class ApplicationUser(Base):
    """Application-wide grants. The single owner is configured outside the DB."""

    __tablename__ = "application_users"
    email: Mapped[str] = mapped_column(String(254), primary_key=True)
    role: Mapped[str] = mapped_column(String(12))
    updated_by: Mapped[str] = mapped_column(String(254))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


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


class DraftDeletion(Base):
    """Additive trash marker: keep the draft, images and revision for 30 days."""

    __tablename__ = "template_draft_deletions"
    draft_id: Mapped[str] = mapped_column(
        ForeignKey("template_drafts.id"), primary_key=True
    )
    deleted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now, index=True
    )


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


class TemplateSource(Base):
    """Original upload retained separately from the canonical editor PDF.

    Additive table: older PDF templates need no destructive column migration.
    Each source follows its immutable template revision.
    """

    __tablename__ = "template_sources"
    revision_id: Mapped[str] = mapped_column(
        ForeignKey("template_revisions.id"), primary_key=True
    )
    filename: Mapped[str] = mapped_column(String(255))
    format: Mapped[str] = mapped_column(String(8))
    payload: Mapped[bytes] = mapped_column(LargeBinary)


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
        validate_environment()
        url = os.environ.get(
            "TEMPLATE_DATABASE_URL",
            "postgresql+psycopg://templates:templates@127.0.0.1:5434/templates",
        )
        options = {"pool_pre_ping": True}
        if is_cloud():
            # Small bounded pool per Python process. Use Supabase's session
            # pooler (5432), not transaction mode (6543).
            options.update(
                pool_size=3,
                max_overflow=2,
                pool_recycle=300,
                pool_timeout=15,
                connect_args={"connect_timeout": 10},
                execution_options={
                    "schema_translate_map": {
                        None: os.environ["TEMPLATE_DATABASE_SCHEMA"]
                    }
                },
            )
        _engine = create_engine(url, **options)
    return _engine


def init_db():
    Base.metadata.create_all(engine())


def get_db():
    with Session(engine()) as session:
        yield session
