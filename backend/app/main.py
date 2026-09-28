from __future__ import annotations

import json
import re
from contextlib import asynccontextmanager
from datetime import datetime
from io import BytesIO
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as postgres_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from .database import Company, Draft, TemplateSetting, get_db, init_db, now_utc
from .models import HealthResponse, ReportData
from .pdf_service import TEMPLATE_PATH, generate_report_pdf


MAX_IMAGE_BYTES = 12 * 1024 * 1024
ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}

@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


app = FastAPI(title="Fault Report Generator API", version="0.2.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=(
        r"^https?://(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|"
        r"192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$"
    ),
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Content-Type"],
    expose_headers=["Content-Disposition"],
)


def _safe_filename(report: ReportData) -> str:
    raw = report.report_title.strip() or "Fault Report"
    cleaned = re.sub(r"[^A-Za-z0-9 ._-]+", "", raw).strip()
    return f"{cleaned or 'Fault Report'}.pdf"


async def _read_image(upload: UploadFile | None) -> bytes | None:
    if upload is None:
        return None
    payload = await upload.read(MAX_IMAGE_BYTES + 1)
    if len(payload) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image exceeds the 12 MB limit")
    try:
        with Image.open(BytesIO(payload)) as image:
            if image.format not in ALLOWED_FORMATS:
                raise HTTPException(status_code=415, detail="Use PNG, JPEG, or WebP")
            image.verify()
    except UnidentifiedImageError as error:
        raise HTTPException(status_code=415, detail="The uploaded file is not an image") from error
    return payload


def _parse_report(report_json: str) -> ReportData:
    try:
        return ReportData.model_validate(json.loads(report_json))
    except (json.JSONDecodeError, ValidationError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


def _required_title(report: ReportData) -> str:
    title = report.report_title.strip()
    if not title:
        raise HTTPException(status_code=422, detail="A report title is required to save a draft")
    return title


def _remember_company(session: Session, name: str) -> None:
    cleaned = name.strip()
    if not cleaned:
        return
    values = {"name_key": cleaned.casefold(), "name": cleaned}
    dialect = session.bind.dialect.name if session.bind is not None else ""
    if dialect == "postgresql":
        session.execute(postgres_insert(Company).values(**values).on_conflict_do_nothing(index_elements=[Company.name_key]))
    elif dialect == "sqlite":
        session.execute(sqlite_insert(Company).values(**values).on_conflict_do_nothing(index_elements=[Company.name_key]))
    elif session.get(Company, values["name_key"]) is None:
        session.add(Company(**values))


def _draft_summary(draft: Draft) -> dict:
    report_date = draft.form_data.get("report_date", "")
    return {
        "id": draft.id,
        "title": draft.title,
        "company": draft.company,
        "report_date": report_date if isinstance(report_date, str) else "",
        "created_at": draft.created_at.isoformat(),
        "updated_at": draft.updated_at.isoformat(),
        "has_equipment_image": draft.equipment_image is not None,
        "has_infrared_image": draft.infrared_image is not None,
    }


def _draft_detail(draft: Draft) -> dict:
    return {
        **_draft_summary(draft),
        "form": draft.form_data,
        "equipment_filename": draft.equipment_filename,
        "infrared_filename": draft.infrared_filename,
    }


def _get_draft_or_404(session: Session, draft_id: str) -> Draft:
    try:
        UUID(draft_id)
    except ValueError as error:
        raise HTTPException(status_code=404, detail="Draft not found") from error
    draft = session.get(Draft, draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="Draft not found")
    return draft


class TitleUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=100)


class CompanyInput(BaseModel):
    name: str = Field(min_length=1, max_length=42)


class LegacyDraftInput(BaseModel):
    id: str
    saved_at: datetime
    form: ReportData


class LegacyImportInput(BaseModel):
    drafts: list[LegacyDraftInput] = Field(max_length=500)


@app.get("/api/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse()


@app.get("/api/template")
def template() -> FileResponse:
    return FileResponse(TEMPLATE_PATH, media_type="application/pdf")


@app.post("/api/reports/generate")
async def generate(
    report_json: str = Form(...),
    equipment_image: UploadFile | None = File(default=None),
    infrared_image: UploadFile | None = File(default=None),
) -> Response:
    report = _parse_report(report_json)
    if report.bx1 is not None and report.bx2 is not None and not report.readings_confirmed:
        raise HTTPException(status_code=422, detail="Confirm the infrared readings first")
    equipment = await _read_image(equipment_image)
    infrared = await _read_image(infrared_image)
    try:
        pdf = generate_report_pdf(report, equipment, infrared)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    filename = _safe_filename(report)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.post("/api/reports/preview")
async def preview(
    report_json: str = Form(...),
    equipment_image: UploadFile | None = File(default=None),
    infrared_image: UploadFile | None = File(default=None),
) -> Response:
    report = _parse_report(report_json)
    equipment = await _read_image(equipment_image)
    infrared = await _read_image(infrared_image)
    try:
        pdf = generate_report_pdf(report, equipment, infrared)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return Response(content=pdf, media_type="application/pdf", headers={"Cache-Control": "no-store"})


@app.get("/api/template-settings/fault-report")
def get_template_setting(session: Session = Depends(get_db)) -> dict:
    setting = session.get(TemplateSetting, "fault-report")
    return {"display_name": setting.display_name if setting else "Fault Report Generator"}


@app.put("/api/template-settings/fault-report")
def rename_template(payload: TitleUpdate, session: Session = Depends(get_db)) -> dict:
    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=422, detail="Template name cannot be blank")
    setting = session.get(TemplateSetting, "fault-report")
    if setting is None:
        setting = TemplateSetting(template_key="fault-report", display_name=title)
        session.add(setting)
    else:
        setting.display_name = title
    session.commit()
    return {"display_name": title}


@app.get("/api/companies")
def list_companies(session: Session = Depends(get_db)) -> dict:
    names = session.scalars(select(Company.name).order_by(Company.name)).all()
    return {"companies": names}


@app.post("/api/companies")
def add_company(payload: CompanyInput, session: Session = Depends(get_db)) -> dict:
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Company name cannot be blank")
    _remember_company(session, name)
    session.commit()
    return {"name": name}


@app.get("/api/drafts")
def list_drafts(session: Session = Depends(get_db)) -> dict:
    drafts = session.scalars(select(Draft).order_by(Draft.created_at.desc())).all()
    return {"drafts": [_draft_summary(draft) for draft in drafts]}


@app.post("/api/drafts")
async def create_draft(
    report_json: str = Form(...),
    equipment_image: UploadFile | None = File(default=None),
    infrared_image: UploadFile | None = File(default=None),
    session: Session = Depends(get_db),
) -> dict:
    report = _parse_report(report_json)
    title = _required_title(report)
    draft = Draft(
        id=str(uuid4()), title=title, company=report.company.strip(),
        form_data=report.model_dump(mode="json"),
        equipment_image=await _read_image(equipment_image),
        equipment_filename=equipment_image.filename[:255] if equipment_image and equipment_image.filename else None,
        equipment_media_type=equipment_image.content_type if equipment_image else None,
        infrared_image=await _read_image(infrared_image),
        infrared_filename=infrared_image.filename[:255] if infrared_image and infrared_image.filename else None,
        infrared_media_type=infrared_image.content_type if infrared_image else None,
    )
    session.add(draft)
    _remember_company(session, report.company)
    session.commit()
    session.refresh(draft)
    return _draft_detail(draft)


@app.get("/api/drafts/{draft_id}")
def get_draft(draft_id: str, session: Session = Depends(get_db)) -> dict:
    return _draft_detail(_get_draft_or_404(session, draft_id))


@app.delete("/api/drafts/{draft_id}", status_code=204)
def delete_draft(draft_id: str, session: Session = Depends(get_db)) -> Response:
    session.delete(_get_draft_or_404(session, draft_id))
    session.commit()
    return Response(status_code=204)


@app.put("/api/drafts/{draft_id}")
async def update_draft(
    draft_id: str,
    report_json: str = Form(...),
    equipment_image: UploadFile | None = File(default=None),
    infrared_image: UploadFile | None = File(default=None),
    session: Session = Depends(get_db),
) -> dict:
    draft = _get_draft_or_404(session, draft_id)
    report = _parse_report(report_json)
    draft.title = _required_title(report)
    draft.company = report.company.strip()
    draft.form_data = report.model_dump(mode="json")
    draft.equipment_image = await _read_image(equipment_image)
    draft.equipment_filename = equipment_image.filename[:255] if equipment_image and equipment_image.filename else None
    draft.equipment_media_type = equipment_image.content_type if equipment_image else None
    draft.infrared_image = await _read_image(infrared_image)
    draft.infrared_filename = infrared_image.filename[:255] if infrared_image and infrared_image.filename else None
    draft.infrared_media_type = infrared_image.content_type if infrared_image else None
    draft.updated_at = now_utc()
    _remember_company(session, report.company)
    session.commit()
    session.refresh(draft)
    return _draft_detail(draft)


@app.patch("/api/drafts/{draft_id}/title")
def rename_draft(draft_id: str, payload: TitleUpdate, session: Session = Depends(get_db)) -> dict:
    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=422, detail="Draft title cannot be blank")
    draft = _get_draft_or_404(session, draft_id)
    draft.title = title
    draft.form_data = {**draft.form_data, "report_title": title}
    draft.updated_at = now_utc()
    session.commit()
    session.refresh(draft)
    return _draft_summary(draft)


@app.get("/api/drafts/{draft_id}/images/{kind}")
def get_draft_image(draft_id: str, kind: str, session: Session = Depends(get_db)) -> Response:
    draft = _get_draft_or_404(session, draft_id)
    if kind not in {"equipment", "infrared"}:
        raise HTTPException(status_code=404, detail="Image not found")
    data = draft.equipment_image if kind == "equipment" else draft.infrared_image
    media_type = draft.equipment_media_type if kind == "equipment" else draft.infrared_media_type
    if data is None:
        raise HTTPException(status_code=404, detail="Image not found")
    return Response(content=data, media_type=media_type or "application/octet-stream", headers={"Cache-Control": "no-store"})


@app.post("/api/drafts/import")
def import_legacy_drafts(payload: LegacyImportInput, session: Session = Depends(get_db)) -> dict:
    imported = 0
    for old in payload.drafts:
        try:
            draft_id = str(UUID(old.id))
        except ValueError:
            continue
        if session.get(Draft, draft_id) is not None:
            continue
        title = old.form.report_title.strip() or "Untitled report"
        report = old.form.model_copy(update={"report_title": title})
        draft = Draft(
            id=draft_id, title=title, company=report.company.strip(),
            created_at=old.saved_at, updated_at=old.saved_at,
            form_data=report.model_dump(mode="json"),
        )
        session.add(draft)
        _remember_company(session, report.company)
        imported += 1
    session.commit()
    return {"imported": imported}
