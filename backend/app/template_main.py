"""Shared service for all user-uploaded report templates."""

import json
import re
from contextlib import asynccontextmanager
from io import BytesIO
from uuid import uuid4

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, JSONResponse
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import delete, select, text
from sqlalchemy.orm import Session, defer
from starlette.concurrency import run_in_threadpool

from .template_database import (
    Draft,
    DraftImage,
    DraftRevision,
    Template,
    TemplateArchive,
    TemplateRevision,
    engine,
    get_db,
    init_db,
)
from .template_models import TemplateDefinition, TemplateReport, resolved_values
from .template_pdf import analyze_pdf, clean_pdf, generate_pdf, generate_field_layers
from .report_configuration import FutureConfiguration
from . import template_versions as versions
from . import preview_assets


@asynccontextmanager
async def lifespan(_app):
    init_db()
    with Session(engine()) as db:
        versions.bootstrap(db)
    yield


app = FastAPI(title="Shared PDF Template Service", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$",
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Content-Type"],
    expose_headers=["Content-Disposition"],
)


def parse(model, payload):
    try:
        return model.model_validate(json.loads(payload))
    except (ValidationError, ValueError, TypeError) as error:
        raise HTTPException(422, str(error)) from error


def title_required(title):
    if not title.strip() or len(title.strip()) > 100:
        raise HTTPException(422, "Enter a title of between 1 and 100 characters")
    return title.strip()


async def read_pdf(file):
    payload = await file.read(20 * 1024 * 1024 + 1)
    if len(payload) > 20 * 1024 * 1024:
        raise HTTPException(413, "PDF exceeds the 20 MB limit")
    if not payload.startswith(b"%PDF-"):
        raise HTTPException(
            415, "Upload a PDF file, including Excel sheets exported as PDF"
        )
    return payload


def template_or_404(db, template_id):
    template = db.get(
        Template,
        template_id,
        options=[
            defer(Template.source_pdf),
            defer(Template.blank_pdf),
            defer(Template.thumbnail),
        ],
    )
    if template is None:
        raise HTTPException(404, "Template not found")
    return template


def draft_or_404(db, template_id, draft_id):
    draft = db.get(Draft, draft_id)
    if draft is None or draft.template_id != template_id:
        raise HTTPException(404, "Draft not found")
    return draft


def summary(template):
    return {
        "id": template.id,
        "title": template.title,
        "created_at": template.created_at.isoformat(),
        "page_count": len(template.definition["pages"]),
        "field_count": len(template.definition["fields"]),
    }


def revision_detail(db, template, revision):
    return {
        **summary(template),
        "definition": revision.definition,
        "revision_id": revision.id,
        "revision_number": revision.number,
        "archived": db.get(TemplateArchive, template.id) is not None,
    }


def require_active(db, template):
    if db.get(TemplateArchive, template.id):
        raise HTTPException(
            409, "This template is archived. Existing reports are still available."
        )


def draft_summary(draft, definition):
    roles = {field.role: field.id for field in definition.fields if field.role}
    values = draft.form.get("values", {})
    return {
        "id": draft.id,
        "title": draft.title,
        "company": values.get(roles.get("company"), ""),
        "report_date": values.get(roles.get("report_date"), ""),
        "created_at": draft.created_at.isoformat(),
        "updated_at": draft.updated_at.isoformat(),
    }


def draft_detail(db, draft, definition):
    images = db.scalars(select(DraftImage).where(DraftImage.draft_id == draft.id)).all()
    return {
        **draft_summary(draft, definition),
        "form": draft.form,
        "revision_id": db.get(DraftRevision, draft.id).revision_id,
        "images": [
            {
                "field_id": image.field_id,
                "filename": image.filename,
                "media_type": image.media_type,
            }
            for image in images
        ],
    }


async def image_uploads(definition, uploads, image_fields):
    try:
        keys = json.loads(image_fields)
    except ValueError as error:
        raise HTTPException(422, "Image field IDs must be a JSON list") from error
    if not isinstance(keys, list) or any(not isinstance(key, str) for key in keys):
        raise HTTPException(422, "Image field IDs must be a JSON list of strings")
    if len(keys) != len(uploads) or len(set(keys)) != len(keys):
        raise HTTPException(422, "Each uploaded image must have a unique field ID")
    allowed = {field.id for field in definition.fields if field.kind == "image"}
    result, total = {}, 0
    for key, upload in zip(keys, uploads):
        if key not in allowed:
            raise HTTPException(422, "Image box does not belong to this template")
        payload = await upload.read(12 * 1024 * 1024 + 1)
        total += len(payload)
        if len(payload) > 12 * 1024 * 1024 or total > 64 * 1024 * 1024:
            raise HTTPException(
                413, "Images must be at most 12 MB each and 64 MB in total"
            )
        try:
            with Image.open(BytesIO(payload)) as image:
                if image.format not in {"PNG", "JPEG", "WEBP"}:
                    raise HTTPException(415, "Use JPEG, PNG, or WebP images")
                media_type = Image.MIME[image.format]
                image.verify()
        except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as error:
            raise HTTPException(415, "The uploaded image is invalid") from error
        result[key] = (payload, (upload.filename or "image")[:255], media_type)
    return result


@app.get("/api/health")
def health(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    return {"status": "ok"}


@app.post("/api/templates/analyze")
async def analyze(pdf: UploadFile = File(...)):
    payload = await read_pdf(pdf)
    try:
        return analyze_pdf(payload)
    except Exception as error:
        raise HTTPException(422, str(error) or "Could not analyze PDF") from error


@app.post("/api/templates/review")
async def review(pdf: UploadFile = File(...), definition_json: str = Form(...)):
    definition = parse(TemplateDefinition, definition_json)
    try:
        blank, _ = clean_pdf(await read_pdf(pdf), definition)
        return Response(
            blank, media_type="application/pdf", headers={"Cache-Control": "no-store"}
        )
    except ValueError as error:
        raise HTTPException(422, str(error)) from error


@app.post("/api/templates")
async def create_template(
    pdf: UploadFile = File(...),
    definition_json: str = Form(...),
    title: str = Form(...),
    reviewed: bool = Form(False),
    db: Session = Depends(get_db),
):
    title = title_required(title)
    definition = parse(TemplateDefinition, definition_json)
    if not definition.fields:
        raise HTTPException(
            422, "Review the template and add at least one field before saving"
        )
    source = await read_pdf(pdf)
    try:
        blank, thumbnail = clean_pdf(source, definition)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    # Sample values are review hints, never defaults for future reports.
    for field in definition.fields:
        field.suggested_value = ""
    template = Template(
        id=str(uuid4()),
        title=title,
        definition=definition.model_dump(mode="json"),
        source_pdf=source,
        blank_pdf=blank,
        thumbnail=thumbnail,
    )
    db.add(template)
    db.flush()
    revision = versions.snapshot(db, template, 1)
    db.commit()
    db.refresh(template)
    return revision_detail(db, template, revision)


@app.post("/api/template-try-report")
async def try_report(
    pdf: UploadFile = File(...),
    definition_json: str = Form(...),
    report_json: str = Form(...),
    images: list[UploadFile] = File(default=[]),
    image_fields: str = Form("[]"),
):
    """A stateless report trial: validation/rendering only, never a database write."""
    definition = parse(TemplateDefinition, definition_json)
    report = parse(TemplateReport, report_json)
    uploaded = await image_uploads(definition, images, image_fields)
    from pypdf import PdfReader

    try:
        reader = PdfReader(BytesIO(await read_pdf(pdf)))
        if len(reader.pages) != len(definition.pages):
            raise ValueError("The preview PDF and template pages do not match")
        result = await run_in_threadpool(
            generate_field_layers,
            definition,
            report,
            {key: item[0] for key, item in uploaded.items()},
        )
    except (ValueError, TypeError) as error:
        raise HTTPException(422, str(error)) from error
    return JSONResponse(result, headers={"Cache-Control": "no-store"})


@app.post("/api/templates/{template_id}/report-defaults")
def save_report_defaults(
    template_id: str, payload: FutureConfiguration, db: Session = Depends(get_db)
):
    template = db.scalar(
        select(Template).where(Template.id == template_id).with_for_update()
    )
    if template is None:
        raise HTTPException(404, "Template not found")
    require_active(db, template)
    previous = versions.latest_revision(db, template)
    if payload.expected_revision_id != previous.id:
        raise HTTPException(
            409,
            "The template changed. Draft saved; open the latest template before changing future defaults.",
        )
    definition = TemplateDefinition.model_validate(previous.definition)
    fields = {field.id: field for field in definition.fields}
    if (set(payload.layout) | set(payload.font_sizes)) - fields.keys():
        raise HTTPException(422, "Configuration references an unknown field")
    for key, box in payload.layout.items():
        if box.page >= len(definition.pages):
            raise HTTPException(422, "Configuration references a missing page")
        for name, value in box.model_dump().items():
            setattr(fields[key], name, value)
    for key, size in payload.font_sizes.items():
        fields[key].font_size = size
    for field in definition.fields:
        field.suggested_value = ""
    for draft in db.scalars(select(Draft).where(Draft.template_id == template_id)):
        versions.for_draft(db, template, draft)
    template.definition = TemplateDefinition.model_validate(
        definition.model_dump()
    ).model_dump(mode="json")
    revision = versions.snapshot(db, template, previous.number + 1)
    db.commit()
    return revision_detail(db, template, revision)


@app.get("/api/templates/{template_id}/drafts/{draft_id}/pdf")
async def download_draft_pdf(
    template_id: str, draft_id: str, db: Session = Depends(get_db)
):
    template = template_or_404(db, template_id)
    draft = draft_or_404(db, template_id, draft_id)
    revision = versions.for_draft(db, template, draft)
    report = TemplateReport.model_validate(draft.form)
    images = {
        item.field_id: item.payload
        for item in db.scalars(
            select(DraftImage).where(DraftImage.draft_id == draft_id)
        )
    }
    db.commit()
    try:
        pdf = await run_in_threadpool(
            generate_pdf,
            revision.blank_pdf,
            TemplateDefinition.model_validate(revision.definition),
            report,
            images,
        )
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    filename = re.sub(r"[^A-Za-z0-9 ._-]", "", draft.title).strip() or "Report"
    return Response(
        pdf,
        media_type="application/pdf",
        headers={
            "Cache-Control": "no-store",
            "Content-Disposition": f'attachment; filename="{filename}.pdf"',
        },
    )


@app.get("/api/templates")
def templates(archived: bool = False, db: Session = Depends(get_db)):
    return {
        "templates": [
            {**summary(t), "archived": archived}
            for t in db.scalars(
                select(Template)
                .options(
                    defer(Template.source_pdf),
                    defer(Template.blank_pdf),
                    defer(Template.thumbnail),
                )
                .order_by(Template.created_at.desc())
            )
            if (db.get(TemplateArchive, t.id) is not None) == archived
        ]
    }


@app.get("/api/templates/{template_id}")
def detail(
    template_id: str,
    draft_id: str | None = None,
    revision_id: str | None = None,
    db: Session = Depends(get_db),
):
    template = template_or_404(db, template_id)
    revision = (
        versions.for_draft(db, template, draft_or_404(db, template_id, draft_id))
        if draft_id
        else versions.resolve(db, template, revision_id)
    )
    db.commit()
    return revision_detail(db, template, revision)


@app.put("/api/templates/{template_id}")
async def edit_template(
    template_id: str,
    definition_json: str = Form(...),
    title: str = Form(...),
    reviewed: bool = Form(False),
    expected_revision_id: str = Form(...),
    pdf: UploadFile | None = File(None),
    db: Session = Depends(get_db),
):
    template = db.scalar(
        select(Template).where(Template.id == template_id).with_for_update()
    )
    if template is None:
        raise HTTPException(404, "Template not found")
    require_active(db, template)
    previous = versions.latest_revision(db, template)
    if previous.id != expected_revision_id:
        raise HTTPException(
            409, "This template changed in another editor. Reload before saving."
        )
    definition = parse(TemplateDefinition, definition_json)
    if not definition.fields:
        raise HTTPException(422, "Review the template before saving")
    source = await read_pdf(pdf) if pdf else template.source_pdf
    try:
        blank, thumbnail = clean_pdf(source, definition)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    # Pin every legacy draft before changing the current template.
    for draft in db.scalars(select(Draft).where(Draft.template_id == template.id)):
        versions.for_draft(db, template, draft)
    for field in definition.fields:
        field.suggested_value = ""
    template.title = title_required(title)
    template.definition, template.source_pdf = (
        definition.model_dump(mode="json"),
        source,
    )
    template.blank_pdf, template.thumbnail = blank, thumbnail
    revision = versions.snapshot(db, template, previous.number + 1)
    db.commit()
    return revision_detail(db, template, revision)


@app.delete("/api/templates/{template_id}")
def archive_template(template_id: str, db: Session = Depends(get_db)):
    template_or_404(db, template_id)
    if not db.get(TemplateArchive, template_id):
        db.add(TemplateArchive(template_id=template_id))
        db.commit()
    return Response(status_code=204)


@app.post("/api/templates/{template_id}/restore")
def restore_template(template_id: str, db: Session = Depends(get_db)):
    template_or_404(db, template_id)
    archived = db.get(TemplateArchive, template_id)
    if archived:
        db.delete(archived)
        db.commit()
    return {"status": "restored"}


@app.delete("/api/templates/{template_id}/permanent", status_code=204)
def delete_archived_template(template_id: str, confirmed: bool = False, db: Session = Depends(get_db)):
    template = db.scalar(select(Template).where(Template.id == template_id).with_for_update())
    if template is None:
        raise HTTPException(404, "Template not found")
    if not confirmed or not db.get(TemplateArchive, template_id):
        raise HTTPException(409, "Archive the template and confirm permanent deletion first. Back up reports before deleting.")
    draft_ids = select(Draft.id).where(Draft.template_id == template_id)
    db.execute(delete(DraftImage).where(DraftImage.draft_id.in_(draft_ids)))
    db.execute(delete(DraftRevision).where(DraftRevision.draft_id.in_(draft_ids)))
    db.execute(delete(Draft).where(Draft.template_id == template_id))
    db.execute(delete(TemplateRevision).where(TemplateRevision.template_id == template_id))
    db.execute(delete(TemplateArchive).where(TemplateArchive.template_id == template_id))
    db.delete(template)
    db.commit()
    preview_assets.discard_template(template_id)
    return Response(status_code=204)


@app.get("/api/templates/{template_id}/source")
def source(template_id: str, db: Session = Depends(get_db)):
    return Response(
        template_or_404(db, template_id).source_pdf, media_type="application/pdf"
    )


class TitleUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=100)


@app.patch("/api/templates/{template_id}")
def rename_template(
    template_id: str, update: TitleUpdate, db: Session = Depends(get_db)
):
    template = template_or_404(db, template_id)
    template.title = title_required(update.title)
    db.commit()
    return summary(template)


@app.get("/api/templates/{template_id}/thumbnail")
def thumbnail(template_id: str, db: Session = Depends(get_db)):
    return Response(template_or_404(db, template_id).thumbnail, media_type="image/png")


@app.get("/api/templates/{template_id}/background")
def background(
    template_id: str, revision_id: str | None = None, db: Session = Depends(get_db)
):
    template = template_or_404(db, template_id)
    revision = versions.resolve(db, template, revision_id)
    db.commit()
    return Response(revision.blank_pdf, media_type="application/pdf")


@app.get("/api/templates/{template_id}/drafts")
def drafts(template_id: str, db: Session = Depends(get_db)):
    template = template_or_404(db, template_id)
    rows = db.scalars(
        select(Draft)
        .where(Draft.template_id == template_id)
        .order_by(Draft.updated_at.desc())
    )
    result = {
        "drafts": [
            draft_summary(
                row,
                TemplateDefinition.model_validate(
                    versions.for_draft(db, template, row).definition
                ),
            )
            for row in rows
        ]
    }
    db.commit()
    return result


@app.get("/api/templates/{template_id}/drafts/{draft_id}")
def get_draft(template_id: str, draft_id: str, db: Session = Depends(get_db)):
    template = template_or_404(db, template_id)
    draft = draft_or_404(db, template_id, draft_id)
    revision = versions.for_draft(db, template, draft)
    db.commit()
    return draft_detail(
        db, draft, TemplateDefinition.model_validate(revision.definition)
    )


@app.get("/api/templates/{template_id}/drafts/{draft_id}/images/{field_id}")
def get_image(
    template_id: str, draft_id: str, field_id: str, db: Session = Depends(get_db)
):
    draft_or_404(db, template_id, draft_id)
    image = db.get(DraftImage, (draft_id, field_id))
    if image is None:
        raise HTTPException(404, "Image not found")
    return Response(image.payload, media_type=image.media_type)


async def persist_draft(
    template_id, draft_id, report_json, images, image_fields, db, revision_id=None
):
    template = template_or_404(db, template_id)
    existing = draft_or_404(db, template_id, draft_id) if draft_id else None
    if not existing:
        require_active(db, template)
    revision = (
        versions.for_draft(db, template, existing)
        if existing
        else versions.resolve(db, template, revision_id)
    )
    definition = TemplateDefinition.model_validate(revision.definition)
    report = parse(TemplateReport, report_json)
    report.title = title_required(report.title)
    try:
        report.validate_for(definition)
    except (ValueError, TypeError) as error:
        raise HTTPException(422, str(error)) from error
    uploaded = await image_uploads(definition, images, image_fields)
    if draft_id:
        draft = draft_or_404(db, template_id, draft_id)
        db.execute(delete(DraftImage).where(DraftImage.draft_id == draft.id))
    else:
        draft = Draft(
            id=str(uuid4()), template_id=template_id, title=report.title, form={}
        )
        db.add(draft)
    draft.title, draft.form = report.title, report.model_dump(mode="json")
    db.flush()
    if not draft_id:
        db.add(DraftRevision(draft_id=draft.id, revision_id=revision.id))
    for key, (payload, filename, media_type) in uploaded.items():
        db.add(
            DraftImage(
                draft_id=draft.id,
                field_id=key,
                payload=payload,
                filename=filename,
                media_type=media_type,
            )
        )
    db.commit()
    db.refresh(draft)
    return draft_detail(db, draft, definition)


@app.post("/api/templates/{template_id}/drafts")
async def create_draft(
    template_id: str,
    report_json: str = Form(...),
    images: list[UploadFile] = File(default=[]),
    image_fields: str = Form("[]"),
    revision_id: str = Form(""),
    db: Session = Depends(get_db),
):
    return await persist_draft(
        template_id, None, report_json, images, image_fields, db, revision_id
    )


@app.put("/api/templates/{template_id}/drafts/{draft_id}")
async def update_draft(
    template_id: str,
    draft_id: str,
    report_json: str = Form(...),
    images: list[UploadFile] = File(default=[]),
    image_fields: str = Form("[]"),
    db: Session = Depends(get_db),
):
    return await persist_draft(
        template_id, draft_id, report_json, images, image_fields, db
    )


@app.patch("/api/templates/{template_id}/drafts/{draft_id}")
def rename_draft(
    template_id: str, draft_id: str, update: TitleUpdate, db: Session = Depends(get_db)
):
    draft = draft_or_404(db, template_id, draft_id)
    draft.title = title_required(update.title)
    draft.form = {**draft.form, "title": draft.title}
    db.commit()
    definition = TemplateDefinition.model_validate(
        versions.for_draft(db, template_or_404(db, template_id), draft).definition
    )
    return draft_summary(draft, definition)


@app.delete("/api/templates/{template_id}/drafts/{draft_id}")
def delete_draft(template_id: str, draft_id: str, db: Session = Depends(get_db)):
    draft = draft_or_404(db, template_id, draft_id)
    db.execute(delete(DraftImage).where(DraftImage.draft_id == draft_id))
    db.execute(delete(DraftRevision).where(DraftRevision.draft_id == draft_id))
    db.delete(draft)
    db.commit()
    return Response(status_code=204)


async def render(
    template_id,
    report_json,
    images,
    image_fields,
    db,
    download,
    revision_id=None,
    asset_token=None,
    layered=False,
):
    template = template_or_404(db, template_id)
    revision = versions.resolve(db, template, revision_id)
    definition = TemplateDefinition.model_validate(revision.definition)
    db.commit()
    report = parse(TemplateReport, report_json)
    try:
        report.validate_for(definition)
        values = resolved_values(definition, report)
    except (ValueError, TypeError) as error:
        raise HTTPException(422, str(error)) from error
    uploaded = await image_uploads(definition, images, image_fields)
    if asset_token and not download:
        if uploaded:
            raise HTTPException(422, "Use cached or uploaded preview images, not both")
        uploaded = preview_assets.get(asset_token, template_id, revision.id)
    try:
        if layered:
            result = await run_in_threadpool(generate_field_layers, definition, report, {key: item[0] for key, item in uploaded.items()})
            return JSONResponse(result, headers={"Cache-Control":"no-store"})
        payload = await run_in_threadpool(
            generate_pdf,
            revision.blank_pdf,
            definition,
            report,
            {key: item[0] for key, item in uploaded.items()},
        )
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    filename = re.sub(r"[^A-Za-z0-9 ._-]", "", report.title).strip() or "Report"
    headers = {"Cache-Control": "no-store"}
    if download:
        headers["Content-Disposition"] = f'attachment; filename="{filename}.pdf"'
    return Response(payload, media_type="application/pdf", headers=headers)


@app.post("/api/templates/{template_id}/preview")
async def preview(
    template_id: str,
    report_json: str = Form(...),
    images: list[UploadFile] = File(default=[]),
    image_fields: str = Form("[]"),
    revision_id: str = Form(""),
    asset_token: str = Form(""),
    layered: bool = Form(False),
    db: Session = Depends(get_db),
):
    return await render(
        template_id,
        report_json,
        images,
        image_fields,
        db,
        False,
        revision_id,
        asset_token,
        layered,
    )


@app.post("/api/templates/{template_id}/preview-assets")
async def upload_preview_assets(
    template_id: str,
    images: list[UploadFile] = File(default=[]),
    image_fields: str = Form("[]"),
    revision_id: str = Form(""),
    db: Session = Depends(get_db),
):
    template = template_or_404(db, template_id)
    revision = versions.resolve(db, template, revision_id)
    definition = TemplateDefinition.model_validate(revision.definition)
    uploaded = await image_uploads(definition, images, image_fields)
    return {"token": preview_assets.put(template_id, revision.id, uploaded)}


@app.post("/api/templates/{template_id}/generate")
async def generate(
    template_id: str,
    report_json: str = Form(...),
    images: list[UploadFile] = File(default=[]),
    image_fields: str = Form("[]"),
    revision_id: str = Form(""),
    db: Session = Depends(get_db),
):
    return await render(
        template_id, report_json, images, image_fields, db, True, revision_id
    )
