"""Install-wide Ergates settings: the push settings every profile shares.

One control store serves every profile of an install, and so do the push
settings. Every hook, in every profile, and ``python -m ergates.flush`` read
them from the Hermes root's ``config.yaml`` (the default profile's config,
``<hermes root>/config.yaml``) at ``plugins.entries.ergates.settings.ntfy.*``.
A profile's own ``config.yaml`` keeps only per-profile settings, such as
``attention.completed_platforms``.

Values are read as written: PyYAML parses the file, and ``${VAR}``
references are not expanded. A value that still contains ``${`` after
loading is refused loudly -- logged (the setting key only, never the value)
and never sent to ntfy -- and treated as unset, so an owner who pasted a
template reference by mistake gets a skipped push instead of a literal
``${...}`` string on the wire. PyYAML is imported lazily; it ships with the
Hermes runtime and is a test dependency of this package, never a runtime
dependency.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict, Mapping

from .delivery import NtfySettings, ntfy_settings

logger = logging.getLogger(__name__)

PLUGIN_ID = "ergates"
SETTING_KEYS = ("server", "topic", "token", "connection_id")

_UNEXPANDED_MARKER = "${"


def settings_from_config(config: Any, plugin_id: str = PLUGIN_ID) -> Dict[str, str]:
    """Extract ``plugins.entries.<plugin_id>.settings.ntfy.*`` from a parsed config.

    Missing keys come back absent rather than empty, and a non-mapping
    anywhere along the path counts as absent rather than raising: a sweep
    or a hook must not die on a config typo. A value that still contains
    ``${`` (an unexpanded template reference) comes back absent too, logged
    by key name only, never by value.
    """
    node: Any = config
    for segment in ("plugins", "entries", plugin_id, "settings", "ntfy"):
        if not isinstance(node, Mapping) or segment not in node:
            return {}
        node = node[segment]
    if not isinstance(node, Mapping):
        return {}
    settings: Dict[str, str] = {}
    for key in SETTING_KEYS:
        value = node.get(key)
        if not isinstance(value, str):
            continue
        value = value.strip()
        if not value:
            continue
        if _UNEXPANDED_MARKER in value:
            logger.warning(
                "ergates: push setting %r still contains an unexpanded \"${\" reference; skipped", key,
            )
            continue
        settings[key] = value
    return settings


def load_settings(root: Path, plugin_id: str = PLUGIN_ID) -> Dict[str, str]:
    """The ``ntfy.*`` settings in ``<root>/config.yaml``; empty when the file is missing."""
    config_path = Path(root) / "config.yaml"
    if not config_path.exists():
        logger.info("ergates: no config at %s; push settings unavailable", config_path)
        return {}
    try:
        import yaml
    except ImportError as exc:  # pragma: no cover - PyYAML ships with the Hermes runtime
        raise RuntimeError(
            "ergates needs PyYAML to read config.yaml -- run it inside the Hermes runtime"
        ) from exc
    with open(config_path, "r", encoding="utf-8") as handle:
        return settings_from_config(yaml.safe_load(handle) or {}, plugin_id)


def push_settings(root: Path) -> NtfySettings | None:
    """The install's push settings, or ``None`` (push off) unless ``ntfy.server`` and ``ntfy.topic`` are set."""
    return ntfy_settings(load_settings(root))
