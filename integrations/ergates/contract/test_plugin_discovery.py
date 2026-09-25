"""The plugin is installed and enabled per profile.

Hermes reads user plugins from the ACTIVE home's `plugins/` folder and loads
one only when that home's config.yaml lists it in `plugins.enabled`. A profile
runs with its own home, so each profile needs its own link and its own entry.
"""

from __future__ import annotations

from pinned import PinnedSource

DISCOVERY = "hermes_cli/plugins_discovery.py"
CONSTANTS = "hermes_constants.py"
CONFIG = "hermes_cli/config.py"


def test_user_plugins_are_read_from_the_active_home(hermes: PinnedSource) -> None:
    # hermes_cli/plugins_discovery.py:151-153
    assert hermes.lines(DISCOVERY, 151, 153) == (
        '    user_dir = get_hermes_home() / "plugins"\n'
        '    logger.debug("Scanning user plugins: %s", user_dir)\n'
        '    _scan("user", user_dir, "user")'
    )
    # hermes_constants.py:101-108: the active home is an override, else HERMES_HOME, else the default.
    assert hermes.lines(CONSTANTS, 101, 108) == (
        "def get_hermes_home() -> Path:\n"
        '    """Hermes home: context-local override → ``HERMES_HOME`` env var → platform default."""\n'
        "    override = get_hermes_home_override()\n"
        "    if override:\n"
        "        return Path(override)\n"
        '    if not os.environ.get("HERMES_HOME", "").strip():\n'
        "        _warn_profile_fallback_once()\n"
        "    return get_process_hermes_home()"
    )


def test_a_user_plugin_loads_only_when_its_home_enables_it(hermes: PinnedSource) -> None:
    # hermes_cli/plugins_discovery.py:213-218: the plugins.enabled gate.
    assert hermes.lines(DISCOVERY, 213, 218) == (
        "    if enabled is None or not names & enabled:\n"
        "        return _placeholder(\n"
        '            f"not enabled in config (run `hermes plugins enable {lookup_key}` to activate)", logging.DEBUG,\n'
        "            \"Skipping '%s' (not in plugins.enabled)\",\n"
        "        )\n"
        '    return ManifestGate("load")'
    )
    # hermes_cli/plugins_discovery.py:95-97: the allow-list comes from load_config() ...
    assert hermes.lines(DISCOVERY, 95, 97) == (
        "        from hermes_cli.config import load_config\n"
        '        enabled = cfg_get(load_config(), "plugins", "enabled")\n'
        "        return set(enabled) if isinstance(enabled, list) else None"
    )
    # ... which reads config.yaml in the active home (hermes_cli/config.py:463-465 and 2155).
    assert hermes.lines(CONFIG, 463, 465) == (
        "def get_config_path() -> Path:\n" '    """Get the main config file path."""\n' '    return get_hermes_home() / "config.yaml"'
    )
    assert hermes.lines(CONFIG, 2155, 2155) == "        config_path = get_config_path()"
