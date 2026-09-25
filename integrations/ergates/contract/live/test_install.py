"""``python -m ergates.install`` against the pinned Hermes, with the templates ``deploy/`` ships.

The plugin is installed once at the root and enabled in every profile,
because Hermes loads a user plugin only from the active home and only when
that home enables it.
"""

from __future__ import annotations

import re
from pathlib import Path

from ergates.hermes_adapter import plugin_enabled, profile_names
from ergates.install import main
from ergates.paths import templates_dir
from ergates.templates import load_template

SHIPPED = Path(__file__).resolve().parents[4] / "deploy" / "templates"


def test_install_enables_the_plugin_in_every_profile_and_installs_the_shipped_templates(root, make_profile, capsys):
    make_profile("pia")
    make_profile("quin")

    main(["--templates", str(SHIPPED)])

    names = profile_names()
    assert {"default", "pia", "quin"} <= set(names)
    # Other live test modules share this session-scoped root and deliberately leave a broken
    # profile behind (a plugins/ergates folder that is not a link, to test enable_plugin's own
    # refusal), so this checks only the profiles this test controls, not every name in the root.
    assert plugin_enabled("default") and plugin_enabled("pia") and plugin_enabled("quin")
    assert (root / "profiles" / "pia" / "plugins" / "ergates").is_symlink()
    installed = sorted(path.name for path in templates_dir(root).glob("*.json"))
    assert installed == sorted(path.name for path in SHIPPED.glob("*.json"))
    for path in SHIPPED.glob("*.json"):
        assert load_template(templates_dir(root), path.stem)["template_id"] == path.stem

    capsys.readouterr()  # drain the install run's own output; --check must report its own facts
    check_code = main(["--templates", str(SHIPPED), "--check"])
    lines = capsys.readouterr().out.splitlines()

    shipped_ids = sorted(path.stem for path in SHIPPED.glob("*.json"))
    assert lines[0] == f"ergates.install: templates=installed ({', '.join(shipped_ids)})"
    profile_states = dict(
        re.match(r"ergates\.install: profile=(\S+) plugin=(.+)", line).groups() for line in lines[1:]
    )
    assert profile_states["default"] == "enabled"
    assert profile_states["pia"] == "enabled"
    assert profile_states["quin"] == "enabled"
    # A broken profile some other live test module left behind (see above) still makes --check
    # answer 1; the exit code is derived from --check's own lines, not asserted as a fixed value.
    assert check_code == (0 if all(state == "enabled" for state in profile_states.values()) else 1)


def test_every_shipped_template_names_only_toolsets_hermes_knows(root):
    """A misspelled toolset would be pinned as is, and the tool gate would then block every tool it meant."""
    from hermes_cli.plugins import PluginManager
    from toolsets import validate_toolset

    # The live toolset registry knows a plugin's toolsets only once some plugin manager has
    # actually loaded it (as every real deployment's gateway does for an enabled profile); load
    # it here so this check does not depend on another live test module running first.
    PluginManager(scope_key=str(root)).discover_and_load()

    shipped = [load_template(SHIPPED, path.stem) for path in sorted(SHIPPED.glob("*.json"))]
    assert shipped
    unknown = {(t["template_id"], name) for t in shipped for name in t["enabled_toolsets"] if not validate_toolset(name)}
    assert unknown == set()
