"""The dashboard/ folder: what `hermes serve` reads to mount the Ergates router (roadmap D3).

``contract/live/test_dashboard_api.py`` proves the mount inside Hermes's own
server; this test keeps the files consistent without Hermes.
"""

import json
from pathlib import Path

import ergates

DASHBOARD = Path(__file__).resolve().parents[1] / "dashboard"


def test_the_manifest_names_the_router_and_a_hidden_tab():
    manifest = json.loads((DASHBOARD / "manifest.json").read_text(encoding="utf-8"))

    assert manifest["name"] == "ergates"
    assert manifest["api"] == "api.py" and (DASHBOARD / "api.py").is_file()
    assert manifest["entry"] == "index.js" and (DASHBOARD / "index.js").is_file()
    assert manifest["tab"]["hidden"] is True
    assert manifest["version"] == ergates.__version__
