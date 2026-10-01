# describe tables, configure db connection, provide dn session to API req
from __future__ import annotations # to handle type annotations, inncluding reference types. Enables postponed evals of type annotations instead of eval when module is loaded

import os #used to read db url from env
from datetime import datetime, timezone
from typing import Iterator #iterator used to annotate functions/ methods that return a sqnc of values 1 at a time using generators (functions with yield) or custom iterator objs

from sqlalchemy import DateTime, LargeBinary, String, create_engine #column types + create_engine (function to connect to db)
from sqlalchemy.dialects.postgresql import JSONB #postrgeSQL json storage type. JSON is general SQLAlchemy JSON type
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column
from sqlalchemy.types import JSON


class Base(DeclarativeBase):
    pass


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


class Draft(Base):
    __tablename__ = "fault_report_drafts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    title: Mapped[str] = mapped_column(String(100), nullable=False) #required cause not allowed to be null
    company: Mapped[str] = mapped_column(String(42), default="", index=True) #index = True adds db index to help lookups by company
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)
    form_data: Mapped[dict] = mapped_column(JSON().with_variant(JSONB, "postgresql"), nullable=False)
    # stores as 1 JSON value. on postrgeSQL uses JSONB; on other supported db such as SQLite in tests, uses JSON
    equipment_image: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True) #LargeBinary is SqlAlch cross-db data type for storing raw binary data (bytes) in db
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
# means SQLAlchemy engine not created yet
# when engine() called, checks that vairable and first call creates engine
# later calls reuse it instead of creating a new engine and connection pool for every req
# method called lazy initialisation
# creates a variable to check if engine has been created. _ before engine naming convention meaning "for use inside this module"

def engine():
    global _engine
    if _engine is None:
        url = os.environ.get("DATABASE_URL", "postgresql+psycopg://fault_report:fault_report@127.0.0.1:5432/fault_report")
        _engine = create_engine(url, pool_pre_ping=True)
    return _engine


def init_db() -> None:
    Base.metadata.create_all(engine())
    # Base.metadate contains table definitions from all classes that used Base
    # create_all() connects and creates tables if they are missing. does not erase/ update existing table structure 
    # be calls init_db() at startup


def get_db() -> Iterator[Session]:
    with Session(engine()) as session:
        yield session
    # Session(engine()) creates new session using shared engine 
    # with closes session after
    # yield session hands it to a FastAPI endpoint
