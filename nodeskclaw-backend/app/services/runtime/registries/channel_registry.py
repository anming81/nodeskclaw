"""ChannelRegistry — maps channel type identifiers to channel strategy factories."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ChannelSpec:
    channel_id: str
    description: str | None = None
    supports_rich_content: bool = False
    supports_bidirectional: bool = True
    config_schema: dict | None = None


class ChannelRegistry:
    def __init__(self) -> None:
        self._channels: dict[str, ChannelSpec] = {}
        self._factories: dict[str, Any] = {}

    def register(self, spec: ChannelSpec, factory: Any = None) -> None:
        self._channels[spec.channel_id] = spec
        if factory is not None:
            self._factories[spec.channel_id] = factory
        logger.debug("Registered channel: %s", spec.channel_id)

    def get(self, channel_id: str) -> ChannelSpec | None:
        return self._channels.get(channel_id)

    def get_factory(self, channel_id: str) -> Any | None:
        return self._factories.get(channel_id)

    def all_channels(self) -> list[ChannelSpec]:
        return list(self._channels.values())


CHANNEL_REGISTRY = ChannelRegistry()

CHANNEL_REGISTRY.register(ChannelSpec(
    channel_id="feishu",
    description="Feishu (Lark) channel — enterprise messaging via bot API.",
    supports_rich_content=True,
    supports_bidirectional=True,
))

CHANNEL_REGISTRY.register(ChannelSpec(
    channel_id="sse",
    description="SSE channel — browser-based real-time event stream.",
    supports_rich_content=False,
    supports_bidirectional=True,
))
