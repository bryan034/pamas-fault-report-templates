"""Snapshot templates before edits and pin each draft to its original revision."""

from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import defer, load_only

from .template_database import Draft, DraftRevision, Template, TemplateRevision


def latest_revision(db, template):
    revision = db.scalar(
        select(TemplateRevision)
        .options(
            defer(TemplateRevision.source_pdf),
            defer(TemplateRevision.blank_pdf),
            defer(TemplateRevision.thumbnail),
        )
        .where(TemplateRevision.template_id == template.id)
        .order_by(TemplateRevision.number.desc())
        .limit(1)
    )
    return revision or snapshot(db, template, 1)


def snapshot(db, template, number):
    revision = TemplateRevision(
        id=str(uuid4()),
        template_id=template.id,
        number=number,
        definition=template.definition,
        source_pdf=template.source_pdf,
        blank_pdf=template.blank_pdf,
        thumbnail=template.thumbnail,
    )
    db.add(revision)
    db.flush()
    return revision


def for_draft(db, template, draft):
    binding = db.get(DraftRevision, draft.id)
    if binding:
        return resolve(db, template, binding.revision_id)
    revision = latest_revision(db, template)
    db.add(DraftRevision(draft_id=draft.id, revision_id=revision.id))
    db.flush()
    return revision


def resolve(db, template, revision_id=None):
    if not revision_id:
        return latest_revision(db, template)
    revision = db.get(
        TemplateRevision,
        revision_id,
        options=[
            defer(TemplateRevision.source_pdf),
            defer(TemplateRevision.blank_pdf),
            defer(TemplateRevision.thumbnail),
        ],
    )
    if revision is None or revision.template_id != template.id:
        raise HTTPException(404, "Template revision not found")
    return revision


def bootstrap(db):
    """One-time, additive backfill; never replace existing draft bindings."""
    for template_id in db.scalars(select(Template.id)):
        template = db.get(
            Template,
            template_id,
            options=[
                defer(Template.source_pdf),
                defer(Template.blank_pdf),
                defer(Template.thumbnail),
            ],
        )
        latest_revision(db, template)
        for draft in db.scalars(
            select(Draft)
            .options(load_only(Draft.id, Draft.template_id))
            .where(Draft.template_id == template.id)
        ):
            for_draft(db, template, draft)
    db.commit()
