from app.services.unified_channel_schema import get_channel_schema


def test_wecom_schema_contains_mvp_fields_for_openclaw() -> None:
    fields = get_channel_schema("wecom", "openclaw")
    assert fields is not None

    keys = {f["key"] for f in fields}
    assert {"botId", "secret", "connectionMode", "websocketUrl", "dmPolicy", "allowFrom", "groupPolicy", "groupAllowFrom"}.issubset(keys)

    mapping = {f["key"]: f for f in fields}
    assert mapping["botId"]["required"] is True
    assert mapping["secret"]["required"] is True
    assert mapping["connectionMode"].get("default") == "websocket"
