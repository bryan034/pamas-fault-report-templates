"""Destructive operations run only against disposable fixture databases."""
import json

import pytest
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from fastapi import HTTPException

from test_audit import create_shared, image_bytes
from test_templates import definition
from app import template_database as data, preview_assets, template_versions
from app.template_models import Calculation


def test_permanent_delete_requires_archive_and_confirmation_and_is_scoped(api):
    base, other = create_shared(api), create_shared(api)
    report = {"title": "Delete me", "values": {"company": "Acme"}}
    draft = api.post(base + "/drafts", data={"report_json": json.dumps(report), "image_fields": '["photo"]'}, files={"images": ("photo.png", image_bytes(), "image/png")}).json()
    retained = api.post(other + "/drafts", data={"report_json": '{"title":"Retain me"}'}).json()
    assert api.delete(base + "/permanent?confirmed=true").status_code == 409
    assert api.delete(base).status_code == 204
    assert api.delete(base + "/permanent").status_code == 409
    original = api.get(base).json()
    api.post(base + "/restore")
    edit = api.put(base, data={"title":"Second revision", "reviewed":"true", "expected_revision_id":original["revision_id"], "definition_json":json.dumps(definition().model_dump())})
    assert edit.status_code == 200
    api.delete(base)
    template_id = base.split("/")[-1]
    token = preview_assets.put(template_id, original["revision_id"], {"photo":(image_bytes(),"photo.png","image/png")})
    assert api.delete(base + "/permanent?confirmed=true").status_code == 204
    for suffix in ["", "/source", "/drafts", "/drafts/"+draft["id"], "/drafts/"+draft["id"]+"/images/photo"]:
        assert api.get(base+suffix).status_code == 404
    assert api.post(base+"/restore").status_code == 404
    assert api.get(other+"/drafts/"+retained["id"]).status_code == 200
    with Session(data.engine()) as db:
        assert db.get(data.Template, template_id) is None
        assert db.get(data.Draft, draft["id"]) is None
        assert db.get(data.DraftRevision, draft["id"]) is None
        assert db.get(data.DraftImage, (draft["id"], "photo")) is None
        assert db.get(data.TemplateArchive, template_id) is None
        assert db.scalar(select(func.count()).select_from(data.TemplateRevision).where(data.TemplateRevision.template_id==template_id)) == 0
        template_versions.bootstrap(db)
    with pytest.raises(HTTPException):
        preview_assets.get(token, template_id, original["revision_id"])
    assert api.get(base).status_code == 404


def test_percentage_errors_name_denominator_and_do_not_break_draft_saving(api):
    schema = definition()
    schema.fields.append(schema.fields[-1].model_copy(update={"id":"rated", "label":"Rated current"}))
    schema.fields.append(schema.fields[-1].model_copy(update={"id":"load", "label":"Load", "kind":"calculated", "calculation":Calculation(operation="percentage", fields=["temp","rated"])}))
    # Revalidate copied nested values before use.
    schema = type(schema).model_validate(schema.model_dump())
    base = create_shared(api, schema)
    report={"title":"Unfinished calculation", "values":{"temp":"30","rated":"0"}}
    for endpoint in ["/preview","/generate"]:
        result=api.post(base+endpoint, data={"report_json":json.dumps(report)})
        assert result.status_code == 422, result.text
        assert "Load: Rated current (denominator) cannot be zero" in result.text
    assert api.post(base+"/drafts", data={"report_json":json.dumps(report)}).status_code == 200
    report["values"]["rated"]="60"
    assert api.post(base+"/generate",data={"report_json":json.dumps(report)}).status_code == 200


