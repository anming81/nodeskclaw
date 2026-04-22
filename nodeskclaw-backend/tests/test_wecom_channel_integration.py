"""WeCom channel integration tests."""

from __future__ import annotations

from app.services.runtime.config_adapter import OpenClawConfigAdapter
from app.services.unified_channel_schema import get_channel_schema
from app.utils.jsonc import _CHANNEL_PLUGIN_PATHS, ensure_channel_plugin_integrity


def test_wecom_schema_available_for_openclaw() -> None:
    schema = get_channel_schema("wecom", runtime_id="openclaw")

    assert schema is not None
    field_keys = {field["key"] for field in schema}
    assert {"botId", "secret", "websocketUrl"}.issubset(field_keys)


def test_openclaw_adapter_supports_wecom() -> None:
    adapter = OpenClawConfigAdapter()

    assert "wecom" in adapter.supported_channels()


def test_wecom_plugin_integrity_repair() -> None:
    config = {
        "channels": {"wecom": {"accounts": {"default": {}}}},
        "plugins": {"load": {"paths": []}, "entries": {}},
    }

    ensure_channel_plugin_integrity(config)

    assert _CHANNEL_PLUGIN_PATHS["wecom"] in config["plugins"]["load"]["paths"]
    assert config["plugins"]["entries"]["wecom"] == {"enabled": True}
