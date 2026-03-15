"""MetricsMiddleware — collects message processing metrics with OpenTelemetry integration."""

from __future__ import annotations

import logging
import time

from app.services.runtime.messaging.pipeline import MessageMiddleware, NextFn, PipelineContext

logger = logging.getLogger(__name__)


class MetricsMiddleware(MessageMiddleware):
    def __init__(self) -> None:
        self._total_messages = 0
        self._total_errors = 0
        self._total_latency_ms = 0.0

    async def process(self, ctx: PipelineContext, next_fn: NextFn) -> None:
        start = time.monotonic()
        self._total_messages += 1

        try:
            from app.services.runtime.telemetry import producer_span, record_message_sent

            with producer_span("deliver", ctx.envelope.id, ctx.envelope.workspaceid, ctx.envelope.traceid) as span:
                await next_fn(ctx)

                elapsed_ms = (time.monotonic() - start) * 1000
                self._total_latency_ms += elapsed_ms
                ctx.metrics["pipeline_latency_ms"] = elapsed_ms

                if ctx.error:
                    self._total_errors += 1
                    from app.services.runtime.telemetry import record_message_failed
                    record_message_failed(ctx.envelope.workspaceid, "", ctx.error or "")
                    if span:
                        span.set_status_error(ctx.error)
                else:
                    record_message_sent(ctx.envelope.workspaceid, ctx.envelope.type)
                    delivered = [r for r in ctx.delivery_results if r.success]
                    for r in delivered:
                        from app.services.runtime.telemetry import record_response_latency
                        record_response_latency(r.latency_ms / 1000, ctx.envelope.workspaceid, "")
        except ImportError:
            await next_fn(ctx)
            elapsed_ms = (time.monotonic() - start) * 1000
            self._total_latency_ms += elapsed_ms
            ctx.metrics["pipeline_latency_ms"] = elapsed_ms
            if ctx.error:
                self._total_errors += 1

    @property
    def stats(self) -> dict:
        return {
            "total_messages": self._total_messages,
            "total_errors": self._total_errors,
            "avg_latency_ms": (
                self._total_latency_ms / self._total_messages
                if self._total_messages > 0 else 0
            ),
        }
