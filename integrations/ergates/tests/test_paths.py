"""Tests for ergates.paths and ergates.hermes_adapter: where the control store lives."""

import sys
import types
from pathlib import Path

import pytest

from ergates.hermes_adapter import default_hermes_root
from ergates.paths import hermes_root, store_path


@pytest.fixture
def without_hermes(monkeypatch):
    """`import hermes_constants` fails, as it does outside a Hermes runtime."""
    monkeypatch.setitem(sys.modules, "hermes_constants", None)


@pytest.fixture
def with_hermes(monkeypatch):
    """A stand-in `hermes_constants` whose default root is /srv/hermes."""
    fake = types.ModuleType("hermes_constants")
    fake.get_default_hermes_root = lambda: Path("/srv/hermes")
    monkeypatch.setitem(sys.modules, "hermes_constants", fake)


def test_the_adapter_returns_hermes_own_root_when_hermes_is_importable(with_hermes):
    assert default_hermes_root() == Path("/srv/hermes")


def test_the_adapter_returns_none_outside_a_hermes_runtime(without_hermes):
    assert default_hermes_root() is None


def test_hermes_root_prefers_hermes_own_answer(with_hermes, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", "/somewhere/else/profiles/thijs")

    assert hermes_root() == Path("/srv/hermes")


def test_bug8_a_profile_home_maps_to_the_shared_hermes_root(without_hermes, monkeypatch):
    """Roadmap bug 8: `tool.hermes_home()` returned HERMES_HOME itself, so a named
    profile (HERMES_HOME=<root>/profiles/<name>) kept its own journals and every
    profile saw different state. The store belongs to the root all profiles share."""
    monkeypatch.setenv("HERMES_HOME", "/srv/hermes/profiles/thijs")

    assert hermes_root() == Path("/srv/hermes")
    assert store_path(hermes_root()) == Path("/srv/hermes/ergates/control.sqlite3")


def test_hermes_root_is_hermes_home_when_it_is_not_a_profile_home(without_hermes, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", "/opt/data")

    assert hermes_root() == Path("/opt/data")


def test_hermes_root_defaults_to_dot_hermes_in_the_home_directory(without_hermes, monkeypatch, tmp_path):
    monkeypatch.delenv("HERMES_HOME", raising=False)
    monkeypatch.setenv("HOME", str(tmp_path))

    assert hermes_root() == tmp_path / ".hermes"


def test_a_blank_hermes_home_counts_as_unset(without_hermes, monkeypatch, tmp_path):
    monkeypatch.setenv("HERMES_HOME", "   ")
    monkeypatch.setenv("HOME", str(tmp_path))

    assert hermes_root() == tmp_path / ".hermes"


def test_store_path_is_ergates_control_sqlite3_under_the_root():
    assert store_path(Path("/opt/data")) == Path("/opt/data/ergates/control.sqlite3")
