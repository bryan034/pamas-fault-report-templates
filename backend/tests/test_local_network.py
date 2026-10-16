"""Local browser access must work without allowing arbitrary public origins."""

import pytest


@pytest.mark.parametrize("origin", [
    "http://0.0.0.0:5173",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://192.168.0.93:5173",
    "http://10.0.0.20:5173",
    "http://172.16.0.20:5173",
    "http://172.31.0.20:5173",
])
def test_local_get_and_multipart_preflight_allow_known_origins(api, origin):
    response = api.get("/api/templates", headers={"Origin": origin})
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin
    preflight = api.options("/api/templates", headers={
        "Origin": origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
    })
    assert preflight.status_code == 200
    assert preflight.headers["access-control-allow-origin"] == origin


@pytest.mark.parametrize("origin", [
    "http://0.0.0.0.evil.example:5173",
    "http://localhost.evil.example:5173",
    "https://example.com",
    "http://172.32.0.20:5173",
])
def test_local_cors_does_not_allow_public_or_lookalike_origins(api, origin):
    response = api.get("/api/templates", headers={"Origin": origin})
    assert "access-control-allow-origin" not in response.headers
    preflight = api.options("/api/templates", headers={
        "Origin": origin,
        "Access-Control-Request-Method": "POST",
    })
    assert preflight.status_code == 400


def test_cloud_cors_still_has_no_local_origin_allowance():
    # A fresh import reflects the configuration actually used by cloud startup,
    # without starting the app or connecting to any database.
    import os
    from pathlib import Path
    import subprocess
    import sys

    result = subprocess.run([
        sys.executable, "-c",
        "from app.template_main import app; "
        "from fastapi.middleware.cors import CORSMiddleware; "
        "cors = next(m for m in app.user_middleware if m.cls is CORSMiddleware); "
        "assert cors.kwargs['allow_origin_regex'] is None",
    ], cwd=Path(__file__).resolve().parents[1],
        env={**os.environ, "TEMPLATE_ENVIRONMENT": "production"},
        capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
