import asyncio
import json
from datetime import datetime, timedelta, timezone
from io import BytesIO
from types import SimpleNamespace

import pytest
from PIL import Image
from sqlalchemy.orm import Session

from app import draft_trash, template_main
from app.template_database import Draft, DraftDeletion, DraftImage, DraftRevision, TemplateRevision, engine
from test_templates import create


def test_expiry_normalizes_database_timezone_to_utc():
    instant = datetime(2026, 10, 18, 8, tzinfo=timezone(timedelta(hours=8)))
    assert draft_trash.expires_at(SimpleNamespace(deleted_at=instant)) == datetime(2026, 11, 17, tzinfo=timezone.utc)
    assert draft_trash.expires_at(SimpleNamespace(deleted_at=instant)).tzinfo == timezone.utc


def saved_report(api, template_id=None, title="Retained report"):
    if template_id is None:
        template_id = create(api).json()["id"]
    base = f"/api/templates/{template_id}"
    image = BytesIO()
    Image.new("RGB", (12, 12), "red").save(image, "PNG")
    response = api.post(base + "/drafts", data={
        "report_json": json.dumps({
            "title": title, "values": {"company": "Retained company"},
            "layout": {"company": {"page": 0, "x": .1, "y": .2, "width": .4, "height": .1}},
            "styles": {"company": {"alignment": "right", "color": "#001122"}},
            "rectangles": [{"id": "box", "page": 0, "x": .1, "y": .2, "width": .1, "height": .1}],
        }), "image_fields": '["photo"]',
    }, files={"images": ("photo.png", image.getvalue(), "image/png")})
    assert response.status_code == 200, response.text
    return base, response.json(), image.getvalue()


def test_delete_hides_all_normal_routes_and_restore_preserves_everything(api, monkeypatch):
    base, saved, image = saved_report(api)
    path = f"{base}/drafts/{saved['id']}"
    instant = datetime(2026, 10, 18, tzinfo=timezone.utc)
    monkeypatch.setattr(draft_trash, "utc_now", lambda: instant)
    assert api.delete(path).status_code == 204
    assert api.get(base + "/drafts").json()["drafts"] == []
    for suffix in ["", "/images/photo", "/pdf", "/download?format=docx"]:
        assert api.get(path + suffix).status_code == 404
    assert api.patch(path, json={"title": "Do not edit trash"}).status_code == 404
    assert api.put(path, data={"report_json": json.dumps({"title": "Do not overwrite"})}).status_code == 404
    trash = api.get(base + "/deleted-drafts").json()["drafts"]
    assert trash[0]["deleted_at"] == instant.isoformat()
    assert trash[0]["expires_at"] == (instant + timedelta(days=30)).isoformat()
    assert trash[0]["company"] == "Retained company"
    # A repeated DELETE cannot restart retention.
    monkeypatch.setattr(draft_trash, "utc_now", lambda: instant + timedelta(days=29))
    assert api.delete(path).status_code == 204
    assert api.get(base + "/deleted-drafts").json()["drafts"][0]["deleted_at"] == instant.isoformat()
    assert api.post(path + "/restore").status_code == 200
    restored = api.get(path).json()
    for key in ["id", "title", "form", "images", "revision_id", "created_at", "updated_at"]:
        assert restored[key] == saved[key]
    assert api.get(path + "/images/photo").content == image
    assert api.get(path + "/pdf").content.startswith(b"%PDF-")
    assert api.get(base + "/deleted-drafts").json()["drafts"] == []
    assert api.post(path + "/restore").status_code == 409


def test_exact_thirty_day_cutoff_purges_images_bindings_and_draft_only(api, monkeypatch):
    base, saved, _ = saved_report(api)
    _, active, _ = saved_report(api, base.rsplit("/", 1)[-1], "Keep this report")
    path = f"{base}/drafts/{saved['id']}"
    instant = datetime(2026, 10, 18, tzinfo=timezone.utc)
    monkeypatch.setattr(draft_trash, "utc_now", lambda: instant)
    api.delete(path)
    monkeypatch.setattr(draft_trash, "utc_now", lambda: instant + timedelta(days=30) - timedelta(microseconds=1))
    assert len(api.get(base + "/deleted-drafts").json()["drafts"]) == 1
    monkeypatch.setattr(draft_trash, "utc_now", lambda: instant + timedelta(days=30))
    assert api.post(path + "/restore").status_code == 404
    assert draft_trash.cleanup_once() == 1
    assert draft_trash.cleanup_once() == 0
    assert api.get(base + "/deleted-drafts").json()["drafts"] == []
    with Session(engine()) as db:
        for model in [Draft, DraftRevision, DraftDeletion]:
            assert db.get(model, saved["id"]) is None
        assert db.get(DraftImage, (saved["id"], "photo")) is None
        assert db.get(TemplateRevision, saved["revision_id"]) is not None
    assert api.get(f"{base}/drafts/{active['id']}").status_code == 200


def test_template_isolation_and_parent_permanent_delete_includes_trash(api):
    base, saved, _ = saved_report(api)
    other, _, _ = saved_report(api)
    path = f"{base}/drafts/{saved['id']}"
    api.delete(path)
    assert api.get(other + "/deleted-drafts").json()["drafts"] == []
    assert api.post(f"{other}/drafts/{saved['id']}/restore").status_code == 404
    assert api.delete(f"{other}/drafts/{saved['id']}").status_code == 404
    assert api.delete(base).status_code == 204
    assert api.delete(base + "/permanent?confirmed=true").status_code == 204
    with Session(engine()) as db:
        assert db.get(DraftDeletion, saved["id"]) is None
        assert db.get(Draft, saved["id"]) is None
    assert api.get(other).status_code == 200


def test_listing_expired_trash_runs_cleanup_and_archived_templates_can_restore(api, monkeypatch):
    base, saved, _ = saved_report(api)
    path = f"{base}/drafts/{saved['id']}"
    instant = datetime(2026, 10, 18, tzinfo=timezone.utc)
    monkeypatch.setattr(draft_trash, "utc_now", lambda: instant)
    api.delete(path)
    api.delete(base)
    assert api.post(path + "/restore").status_code == 200
    api.delete(path)
    monkeypatch.setattr(draft_trash, "utc_now", lambda: instant + timedelta(days=31))
    assert api.get(base + "/drafts").json()["drafts"] == []
    with Session(engine()) as db:
        assert db.get(Draft, saved["id"]) is None


def test_hourly_cleanup_retries_failures_without_logging_secrets(monkeypatch, caplog):
    calls = []
    async def sleep(seconds):
        assert seconds == 3600
    def cleanup():
        calls.append(True)
        if len(calls) == 1:
            raise RuntimeError("private-database-secret")
        raise asyncio.CancelledError
    monkeypatch.setattr(template_main.asyncio, "sleep", sleep)
    monkeypatch.setattr(draft_trash, "cleanup_once", cleanup)
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(template_main.cleanup_deleted_drafts())
    assert len(calls) == 2
    assert "Draft retention cleanup failed" in caplog.text
    assert "private-database-secret" not in caplog.text
