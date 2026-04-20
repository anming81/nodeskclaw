from app.services import llm_config_service


def test_nodeskclaw_tool_names_are_complete() -> None:
    assert llm_config_service.NODESKCLAW_TOOL_NAMES == (
        "nodeskclaw_blackboard",
        "nodeskclaw_topology",
        "nodeskclaw_performance",
        "nodeskclaw_proposals",
        "nodeskclaw_gene_discovery",
        "nodeskclaw_shared_files",
    )


def test_inject_wecom_plugin_path_is_idempotent() -> None:
    config = {
        "plugins": {
            "load": {
                "paths": [
                    ".openclaw/extensions/openclaw-channel-wecom",
                    "/root/.openclaw/extensions/openclaw-channel-wecom",
                ],
            },
            "entries": {},
        },
    }

    llm_config_service._inject_wecom_plugin_path(config)
    llm_config_service._inject_wecom_plugin_path(config)

    paths = config["plugins"]["load"]["paths"]
    assert paths.count("/root/.openclaw/extensions/openclaw-channel-wecom") == 1
    assert ".openclaw/extensions/openclaw-channel-wecom" not in paths
    assert config["plugins"]["entries"]["wecom"] == {"enabled": True}


def test_wecom_plugin_registered_in_registry() -> None:
    spec = llm_config_service.CHANNEL_PLUGIN_REGISTRY["wecom"]
    assert spec.plugin_id == "wecom"
    assert spec.dir_name == "openclaw-channel-wecom"
    assert "index.ts" in spec.file_list
