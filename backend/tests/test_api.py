import json
from io import BytesIO
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient
from PIL import Image
from pypdf import PdfReader
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models import ReportData


client = TestClient(app)
FIXTURES = Path(__file__).parent / "fixtures"


def test_health() -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_generate_report_endpoint() -> None:
    report = ReportData().model_dump(mode="json")
    response = client.post(
        "/api/reports/generate",
        data={"report_json": json.dumps(report)},
        files={
            "equipment_image": ("equipment.png", (FIXTURES / "sample_equipment.png").read_bytes(), "image/png"),
            "infrared_image": ("infrared.png", (FIXTURES / "sample_ir.png").read_bytes(), "image/png"),
        },
    )
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert len(PdfReader(BytesIO(response.content)).pages) == 1


def test_unconfirmed_readings_are_rejected() -> None:
    report = ReportData(bx1=66.1, bx2=53.0, readings_confirmed=False).model_dump(mode="json")
    response = client.post(
        "/api/reports/generate",
        data={"report_json": json.dumps(report)},
    )
    assert response.status_code == 422


def test_preview_uses_pdf_renderer_without_requiring_reading_confirmation() -> None:
    report = ReportData(
        report_title="Switchboard thermal fault",
        report_number="1",
        report_date="2026-09-28",
        bx1=66.1,
        bx2=53.0,
        readings_confirmed=False,
    ).model_dump(mode="json")
    response = client.post("/api/reports/preview", data={"report_json": json.dumps(report)})
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.headers["cache-control"] == "no-store"
    reader = PdfReader(BytesIO(response.content))
    assert reader.metadata.title == "Switchboard thermal fault"
    text = reader.pages[0].extract_text()
    assert "28 Sep 2026" in text
    assert "10" in text


def test_download_filename_uses_report_title() -> None:
    report = ReportData(report_title="Panel A", report_number="1", report_date="2026-09-28").model_dump(mode="json")
    response = client.post("/api/reports/generate", data={"report_json": json.dumps(report)})
    assert response.status_code == 200
    assert 'filename="Panel A.pdf"' in response.headers["content-disposition"]


def test_browser_preflight_allows_draft_changes_and_exposes_filename() -> None:
    origin = "http://localhost:5173"
    for method in ("PUT", "PATCH", "DELETE"):
        response = client.options("/api/drafts/example", headers={
            "Origin": origin, "Access-Control-Request-Method": method,
        })
        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == origin
    report = ReportData(report_title="Panel A").model_dump(mode="json")
    response = client.post("/api/reports/generate", headers={"Origin": origin}, data={"report_json": json.dumps(report)})
    assert "content-disposition" in response.headers["access-control-expose-headers"].lower()


def test_preview_accepts_blank_priority_from_editor() -> None:
    report = ReportData().model_dump(mode="json")
    report["repair_priority"] = ""
    response = client.post("/api/reports/preview", data={"report_json": json.dumps(report)})
    assert response.status_code == 200


def test_preview_accepts_camera_sized_equipment_photo() -> None:
    source = BytesIO()
    Image.new("RGB", (5152, 3864), (105, 115, 125)).save(source, format="JPEG", quality=90)
    report = ReportData().model_dump(mode="json")
    response = client.post("/api/reports/preview", data={"report_json": json.dumps(report)},
                           files={"equipment_image": ("equipment.jpg", source.getvalue(), "image/jpeg")})
    assert response.status_code == 200, response.text[:500] if response.status_code != 200 else ""
    assert len(PdfReader(BytesIO(response.content)).pages) == 1


def test_draft_lifecycle_and_saved_images() -> None:
    sqlite = create_engine("sqlite+pysqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(sqlite)

    def local_db():
        with Session(sqlite) as session:
            yield session

    app.dependency_overrides[get_db] = local_db
    try:
        rectangle_id = str(uuid4())
        report = ReportData(report_title="Panel A", company="Acme", report_number="1", report_date="2026-09-28",
                            image_rectangles=[{"id": rectangle_id, "image": "infrared", "x": 0.1, "y": 0.2,
                                               "width": 0.3, "height": 0.4, "color": "#ef2323", "stroke_width": 3}]).model_dump(mode="json")
        empty_title = client.post("/api/drafts", data={"report_json": json.dumps({**report, "report_title": " "})})
        assert empty_title.status_code == 422

        created = client.post(
            "/api/drafts",
            data={"report_json": json.dumps(report)},
            files={"infrared_image": ("thermal.png", (FIXTURES / "sample_ir.png").read_bytes(), "image/png")},
        )
        assert created.status_code == 200, created.text
        draft_id = created.json()["id"]
        assert created.json()["has_infrared_image"] is True
        assert created.json()["title"] == "Panel A"
        assert created.json()["report_date"] == "2026-09-28"
        assert len(client.get("/api/drafts").json()["drafts"]) == 1
        assert client.get("/api/drafts").json()["drafts"][0]["report_date"] == "2026-09-28"
        assert client.get(f"/api/drafts/{draft_id}").json()["form"]["report_number"] == "01"
        assert client.get(f"/api/drafts/{draft_id}").json()["form"]["image_rectangles"][0]["id"] == rectangle_id
        assert client.get(f"/api/drafts/{draft_id}/images/infrared").content == (FIXTURES / "sample_ir.png").read_bytes()
        assert client.get("/api/companies").json()["companies"] == ["Acme"]

        updated = client.put(f"/api/drafts/{draft_id}", data={"report_json": json.dumps({**report, "report_title": "Panel A revised", "company": "Beta", "report_date": "2026-10-02"})})
        assert updated.status_code == 200
        assert updated.json()["id"] == draft_id
        assert updated.json()["report_date"] == "2026-10-02"
        assert updated.json()["has_infrared_image"] is False
        assert len(client.get("/api/drafts").json()["drafts"]) == 1
        assert client.patch(f"/api/drafts/{draft_id}/title", json={"title": "Final title"}).json()["title"] == "Final title"
        assert client.get(f"/api/drafts/{draft_id}").json()["form"]["report_title"] == "Final title"
        assert client.get("/api/companies").json()["companies"] == ["Acme", "Beta"]

        deleted = client.delete(f"/api/drafts/{draft_id}")
        assert deleted.status_code == 204
        assert client.get(f"/api/drafts/{draft_id}").status_code == 404
        assert client.delete(f"/api/drafts/{draft_id}").status_code == 404
        assert client.get("/api/drafts").json()["drafts"] == []

        imported_id = str(uuid4())
        legacy = {"drafts": [{"id": imported_id, "saved_at": "2026-09-28T00:00:00Z", "form": report}]}
        assert client.post("/api/drafts/import", json=legacy).json()["imported"] == 1
        assert client.post("/api/drafts/import", json=legacy).json()["imported"] == 0
        assert len(client.get("/api/drafts").json()["drafts"]) == 1

        renamed = client.put("/api/template-settings/fault-report", json={"title": "Thermal Reports"})
        assert renamed.json()["display_name"] == "Thermal Reports"
        assert client.get("/api/template-settings/fault-report").json()["display_name"] == "Thermal Reports"
    finally:
        app.dependency_overrides.clear()
        sqlite.dispose()
