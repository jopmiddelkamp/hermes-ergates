"""Tests for the Hermes-free parts of ergates.hermes_adapter.

The calls into Hermes run against the pinned Hermes itself in
``contract/live/test_adapter.py``. These tests cover what the adapter decides
on its own: names, the plugin link, the config edit, the create result, and
the behavior outside a Hermes runtime.
"""

import json
import sys

import pytest

from conftest import hermes_profile_lookup
from ergates import hermes_adapter
from ergates.hermes_adapter import (
    HermesCron,
    _created_job_id,
    _enable_in,
    _link_plugin,
    _plugin_lists,
    current_profile,
    profile_exists,
)
from ergates.reminders import CronUnavailable


@pytest.fixture
def without_hermes(monkeypatch):
    """Every Hermes import fails, as it does outside a Hermes runtime."""
    for name in ("hermes_constants", "hermes_cli", "hermes_cli.profiles", "hermes_cli.config",
                 "hermes_cli.plugins_discovery", "tools", "tools.cronjob_tools", "cron", "cron.jobs"):
        monkeypatch.setitem(sys.modules, name, None)


class _MultiplexedCtx:
    """A PluginContext whose active home changes between calls, like a multiplexed gateway's."""

    def __init__(self, *names):
        self._names = iter(names)

    @property
    def profile_name(self):
        return next(self._names)


def test_bug8_current_profile_reads_ctx_profile_name_at_every_call():
    """Roadmap bug 8: the profile must come from Hermes at call time, never from
    a value captured when the plugin loaded."""
    ctx = _MultiplexedCtx("concierge", "thijs")

    assert current_profile(ctx) == "concierge"
    assert current_profile(ctx) == "thijs"


def test_current_profile_refuses_a_context_without_a_name():
    class Blank:
        profile_name = "  "

    with pytest.raises(ValueError):
        current_profile(Blank())
    with pytest.raises(AttributeError):
        current_profile(object())


class _DefaultCtx:
    profile_name = "default"


def test_bug8_default_stands_when_hermes_lookup_names_the_default_profile(monkeypatch):
    hermes_profile_lookup(monkeypatch, lambda: "default")

    assert current_profile(_DefaultCtx()) == "default"


def _lookup_fails():
    raise OSError("the Hermes home cannot be resolved")


@pytest.mark.parametrize("lookup", [_lookup_fails, lambda: "thijs"], ids=["lookup-raises", "lookup-disagrees"])
def test_bug8_default_is_refused_when_it_is_hermes_fallback_for_a_failed_lookup(monkeypatch, lookup):
    """``PluginContext.profile_name`` answers "default" when its own lookup raises
    (``hermes_cli/plugins.py`` at the pin), and "default" is always admitted."""
    hermes_profile_lookup(monkeypatch, lookup)

    with pytest.raises(ValueError):
        current_profile(_DefaultCtx())


def test_bug8_default_is_refused_when_hermes_cannot_be_asked(without_hermes):
    with pytest.raises(ValueError):
        current_profile(_DefaultCtx())


@pytest.mark.parametrize("name", ["", "Thijs", "../etc", "a/b", "-x", "x" * 65, None, 7])
def test_a_name_hermes_would_refuse_is_no_profile_and_never_reaches_hermes(without_hermes, name):
    assert profile_exists(name) is False


@pytest.mark.parametrize("call", [
    lambda cron: cron.create_job("thijs", schedule="0 9 * * *", prompt="p", name="n"),
    lambda cron: cron.get_job("thijs", "job-1"),
    lambda cron: cron.find_job_ids_by_name("thijs", "n"),
])
def test_hermes_cron_outside_a_hermes_runtime_raises_cron_unavailable(without_hermes, call):
    with pytest.raises(CronUnavailable):
        call(HermesCron())


def test_enable_plugin_outside_a_hermes_runtime_fails_loudly(without_hermes):
    with pytest.raises(ImportError):
        hermes_adapter.enable_plugin("thijs")


def test_link_plugin_creates_the_link_and_accepts_it_again(tmp_path):
    source = tmp_path / "root" / "plugins" / "ergates"
    source.mkdir(parents=True)
    link = tmp_path / "root" / "profiles" / "thijs" / "plugins" / "ergates"

    _link_plugin(source, link)
    _link_plugin(source, link)

    assert link.is_symlink()
    assert link.resolve() == source.resolve()


def test_link_plugin_never_replaces_a_folder_or_a_link_to_somewhere_else(tmp_path):
    source = tmp_path / "plugins" / "ergates"
    source.mkdir(parents=True)
    folder = tmp_path / "a" / "ergates"
    folder.mkdir(parents=True)
    elsewhere = tmp_path / "b" / "ergates"
    elsewhere.parent.mkdir()
    elsewhere.symlink_to(tmp_path / "a")

    with pytest.raises(FileExistsError):
        _link_plugin(source, folder)
    with pytest.raises(FileExistsError):
        _link_plugin(source, elsewhere)
    assert folder.is_dir() and not folder.is_symlink()
    assert elsewhere.resolve() == (tmp_path / "a").resolve()


def test_enable_in_adds_the_plugin_and_keeps_every_other_setting():
    config = {"model": {"default": "m"}, "plugins": {"enabled": ["other"], "disabled": ["ergates", "x"]}}

    assert _enable_in(config) is True
    assert config == {"model": {"default": "m"}, "plugins": {"enabled": ["other", "ergates"], "disabled": ["x"]}}
    assert _enable_in(config) is False


@pytest.mark.parametrize("config", [{}, {"plugins": None}, {"plugins": {"enabled": "ergates"}}])
def test_enable_in_repairs_a_missing_or_malformed_plugins_section(config):
    assert _enable_in(config) is True
    assert config["plugins"]["enabled"] == ["ergates"]


def test_plugin_lists_read_like_hermes_discovery():
    assert _plugin_lists({}) == (None, set())
    assert _plugin_lists({"plugins": {"enabled": ["ergates"], "disabled": ["x"]}}) == ({"ergates"}, {"x"})
    assert _plugin_lists({"plugins": {"enabled": "ergates", "disabled": "x"}}) == (None, set())


def test_created_job_id_reads_the_create_result():
    assert _created_job_id(json.dumps({"success": True, "job_id": "abc123", "name": "n"})) == "abc123"


@pytest.mark.parametrize("raw", [
    json.dumps({"success": False, "error": "Invalid schedule"}),
    json.dumps({"success": True}),
    json.dumps({"success": True, "job_id": ""}),
    json.dumps(["not", "an", "object"]),
])
def test_created_job_id_refuses_a_result_without_a_created_job(raw):
    with pytest.raises(RuntimeError) as caught:
        _created_job_id(raw)
    assert "Invalid schedule" not in str(caught.value)
