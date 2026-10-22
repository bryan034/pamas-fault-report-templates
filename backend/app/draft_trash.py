"""Thirty-day draft retention. Never delete template revisions shared by reports."""

from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .template_database import Draft, DraftDeletion, DraftImage, DraftRevision, WordDocument, engine

RETENTION = timedelta(days=30)
CLEANUP_INTERVAL_SECONDS = 3600


def utc_now():
    return datetime.now(timezone.utc)


def expires_at(marker):
    # SQLite does not round-trip timezone offsets; stored timestamps are UTC.
    deleted = marker.deleted_at
    if deleted.tzinfo is None:
        deleted = deleted.replace(tzinfo=timezone.utc)
    return deleted.astimezone(timezone.utc) + RETENTION


def purge_expired(db: Session, *, template_id=None):
    cutoff = utc_now() - RETENTION
    removed = 0
    while True:
        query = (
            select(Draft.id)
            .join(DraftDeletion, DraftDeletion.draft_id == Draft.id)
            .where(DraftDeletion.deleted_at <= cutoff)
            .order_by(Draft.id)
            .limit(200)
            .with_for_update(of=Draft, skip_locked=True)
        )
        if template_id is not None:
            query = query.where(Draft.template_id == template_id)
        ids = list(db.scalars(query))
        if not ids:
            return removed
        db.execute(delete(DraftImage).where(DraftImage.draft_id.in_(ids)))
        db.execute(delete(WordDocument).where(WordDocument.draft_id.in_(ids)))
        db.execute(delete(DraftRevision).where(DraftRevision.draft_id.in_(ids)))
        db.execute(delete(DraftDeletion).where(DraftDeletion.draft_id.in_(ids)))
        db.execute(delete(Draft).where(Draft.id.in_(ids)))
        removed += len(ids)


def cleanup_once():
    with Session(engine()) as db:
        removed = purge_expired(db)
        db.commit()
        return removed
