"""Static checks of deploy/: the wiring contract of docs/03 section 9, without Docker.

`scripts/ci-local.sh deploy` also runs `docker compose config`, which checks
Compose syntax and interpolation. These tests check what Compose accepts but
the design forbids: a port on 0.0.0.0, a missing plugin mount, a socket in the
wrong container, a profile without the approval settings.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import pytest
import yaml

DEPLOY = Path(__file__).resolve().parents[1]
# The accept route's own template check; the ergates package needs no dependency.
sys.path.insert(0, str(DEPLOY.parent / "integrations" / "ergates"))
from ergates.templates import load_template  # noqa: E402

TEMPLATES = sorted(path.stem for path in (DEPLOY / "templates").glob("*.json"))
TEMPLATE_MOUNT = "./templates:/opt/ergates/templates:ro"
COMPOSE_TEXT = (DEPLOY / "docker-compose.yml").read_text(encoding="utf-8")
COMPOSE = yaml.safe_load(COMPOSE_TEXT)
SERVICES = COMPOSE["services"]
CONTROLLERS = ("hermes-serve", "hermes-gateway")
PLUGIN_MOUNT = "../integrations/ergates:/opt/data/plugins/ergates:ro"
DOCKER_SOCKET = "/var/run/docker.sock:/var/run/docker.sock"
PROFILES = sorted(path.parent.name for path in DEPLOY.glob("profiles/*/config.yaml"))


def env_example() -> dict[str, str]:
    values: dict[str, str] = {}
    for line in (DEPLOY / ".env.example").read_text(encoding="utf-8").splitlines():
        if line.strip() and not line.lstrip().startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip()
    return values


def profile(name: str) -> dict:
    return yaml.safe_load((DEPLOY / "profiles" / name / "config.yaml").read_text(encoding="utf-8"))


def test_the_stack_is_serve_gateway_and_ntfy() -> None:
    assert set(SERVICES) == {"hermes-serve", "hermes-gateway", "ntfy"}


def test_every_required_variable_has_an_example_value() -> None:
    required = set(re.findall(r"\$\{([A-Z0-9_]+):\?", COMPOSE_TEXT))
    assert required == {
        "TAILSCALE_IP",
        "HERMES_DASHBOARD_BASIC_AUTH_USERNAME",
        "HERMES_DASHBOARD_BASIC_AUTH_PASSWORD_HASH",
        "HERMES_DASHBOARD_BASIC_AUTH_SECRET",
        "DOCKER_SOCK_GID",
    }
    examples = env_example()
    assert sorted(name for name in required if not examples.get(name)) == []


def test_ports_are_published_only_on_the_tailscale_ip() -> None:
    published = [port for service in SERVICES.values() for port in service.get("ports", [])]
    assert published
    assert all(port.startswith("${TAILSCALE_IP:?") for port in published)


@pytest.mark.parametrize("service", CONTROLLERS)
def test_both_controllers_mount_the_plugin_read_only_and_the_docker_socket(service: str) -> None:
    volumes = SERVICES[service]["volumes"]
    assert PLUGIN_MOUNT in volumes
    assert DOCKER_SOCKET in volumes
    assert SERVICES[service]["environment"]["HERMES_HOME"] == "/opt/data"


def test_ntfy_gets_no_docker_socket_and_denies_by_default() -> None:
    ntfy = SERVICES["ntfy"]
    assert DOCKER_SOCKET not in ntfy.get("volumes", [])
    assert ntfy["environment"]["NTFY_AUTH_DEFAULT_ACCESS"] == "deny-all"


def test_every_image_names_an_explicit_tag() -> None:
    for name, service in SERVICES.items():
        image = service["image"]
        repository, _, tag = image.rpartition(":")
        assert repository and tag and tag != "latest", f"{name}: {image}"


def test_there_are_two_profiles() -> None:
    assert PROFILES == ["concierge", "specialist-template"]


@pytest.mark.parametrize("name", PROFILES)
def test_each_profile_requires_manual_approval_with_the_1800_second_timeout(name: str) -> None:
    assert profile(name)["approvals"] == {"mode": "manual", "timeout": 1800, "cron_mode": "deny", "unattended_mode": "deny"}


@pytest.mark.parametrize("name", PROFILES)
def test_each_profile_runs_tools_in_an_offline_docker_sandbox(name: str) -> None:
    terminal = profile(name)["terminal"]
    assert terminal["backend"] == "docker"
    assert terminal["docker_network"] is False
    assert terminal["docker_forward_env"] == []
    assert terminal["docker_shared_container_key"] == ""


@pytest.mark.parametrize("name", PROFILES)
def test_each_profile_has_a_soul(name: str) -> None:
    assert (DEPLOY / "profiles" / name / "SOUL.md").read_text(encoding="utf-8").strip()


def test_only_the_concierge_multiplexes_the_gateway() -> None:
    assert profile("concierge")["gateway"] == {"multiplex_profiles": True}
    assert "gateway" not in profile("specialist-template")


@pytest.mark.parametrize("name", PROFILES)
def test_each_profile_enables_the_plugin(name: str) -> None:
    """Hermes loads a user plugin only when the active home's config.yaml enables it."""
    assert "ergates" in profile(name)["plugins"]["enabled"]


def test_the_concierge_holds_the_install_wide_push_settings_without_a_secret() -> None:
    """The concierge's config.yaml is the Hermes root's, where every hook and the sweep read ntfy.*."""
    ntfy = profile("concierge")["plugins"]["entries"]["ergates"]["settings"]["ntfy"]
    assert ntfy == {"server": "http://ntfy", "topic": "ergates-attention"}
    assert "entries" not in profile("specialist-template")["plugins"]


def test_there_are_templates_and_each_is_one_the_accept_route_serves() -> None:
    assert TEMPLATES
    for template_id in TEMPLATES:
        template = load_template(DEPLOY / "templates", template_id)
        assert template["enabled_toolsets"], template_id
        assert "{{" not in template["soul"], template_id


def test_the_concierge_proposes_exactly_the_shipped_templates() -> None:
    soul = (DEPLOY / "profiles" / "concierge" / "SOUL.md").read_text(encoding="utf-8")
    named = sorted(set(re.findall(r"`template_id: ([a-z0-9][a-z0-9_-]*)`", soul)))
    assert named == TEMPLATES


def test_hermes_serve_mounts_the_templates_read_only_outside_the_data_volume() -> None:
    """The installer copies them into /opt/data/ergates/templates as the hermes user; a bind
    mount inside /opt/data would make Docker create /opt/data/ergates owned by root."""
    assert TEMPLATE_MOUNT in SERVICES["hermes-serve"]["volumes"]
