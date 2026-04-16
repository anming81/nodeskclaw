from app.services.runtime.config_adapter import HermesConfigAdapter


class FakeFS:
    def __init__(self, files: dict[str, str] | None = None):
        self.files = files or {}

    async def read_text(self, path: str):
        return self.files.get(path)

    async def write_text(self, path: str, content: str):
        self.files[path] = content


def test_hermes_adapter_read_write_channels():
    adapter = HermesConfigAdapter()
    fs = FakeFS({
        ".hermes/config.yaml": "channels:\n  telegram:\n    token: abc\n",
    })

    import asyncio

    async def run():
        config = await adapter.read_config(fs)
        assert config == {"channels": {"telegram": {"token": "abc"}}}

        merged = adapter.merge_channels(config or {}, {"slack": {"bot_token": "x"}})
        assert adapter.extract_channels(merged) == {"slack": {"bot_token": "x"}}

        await adapter.write_config(fs, merged)
        dumped = fs.files[".hermes/config.yaml"]
        assert "channels:" in dumped
        assert "slack:" in dumped

    asyncio.run(run())
