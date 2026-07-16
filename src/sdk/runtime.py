"""Typed SDK facade over the DevPilot runtime.

Desktop and protocol adapters use this module instead of reaching into
Coordinator or Executor internals.  The facade intentionally stores no state
outside the runtime's existing project/session artifacts.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from ..coordinator.config import CoordinatorConfig
    from ..coordinator.orchestrator import CoordinatorOrchestrator
    from ..events import EventBus


@dataclass(frozen=True, slots=True)
class ResearchRequest:
    """Input for one Coordinator-backed research session."""

    cwd: Path
    task: str
    resume: bool = False
    options: Mapping[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.task.strip():
            raise ValueError("A research task is required.")
        if not self.cwd.exists() or not self.cwd.is_dir():
            raise ValueError(f"Research directory is not accessible: {self.cwd}")


@dataclass(frozen=True, slots=True)
class SessionEvent:
    """A runtime event exposed without leaking the internal EventBus type."""

    type: str
    data: Mapping[str, Any]
    timestamp: float


EventHandler = Callable[[SessionEvent], Awaitable[None] | None]
ProviderFactory = Callable[[Any], Any]
OrchestratorFactory = Callable[[Any, Any, Any], Any]


class ResearchSession:
    """One cancellable research session backed by a Coordinator instance."""

    def __init__(
        self,
        *,
        request: ResearchRequest,
        provider_factory: ProviderFactory,
        orchestrator_factory: OrchestratorFactory,
    ) -> None:
        self.request = request
        self._provider_factory = provider_factory
        self._orchestrator_factory = orchestrator_factory
        self._handlers: list[EventHandler] = []
        self._task: asyncio.Task[str] | None = None
        self._orchestrator: Any | None = None
        from ..events import EventBus

        self._bus = EventBus()
        self._bus.on_all(self._publish_event)

    @property
    def running(self) -> bool:
        return self._task is not None and not self._task.done()

    def subscribe(self, handler: EventHandler) -> Callable[[], None]:
        """Subscribe to immutable runtime events and return an unsubscribe hook."""
        self._handlers.append(handler)

        def unsubscribe() -> None:
            try:
                self._handlers.remove(handler)
            except ValueError:
                pass

        return unsubscribe

    async def run(self) -> str:
        """Run the Coordinator once and return its final report text."""
        if self.running:
            raise RuntimeError("This research session is already running.")

        from ..core.config_resolve import resolve_runtime_config

        config = resolve_runtime_config(
            cwd=self.request.cwd,
            task=self.request.task,
            resume=self.request.resume,
            overrides=self.request.options,
        )
        provider = self._provider_factory(config)
        orchestrator = self._orchestrator_factory(config, provider, self._bus)
        self._orchestrator = orchestrator
        self._task = asyncio.create_task(orchestrator.run())
        try:
            return await self._task
        finally:
            self._task = None
            self._orchestrator = None

    async def cancel(self) -> None:
        """Cancel the current run; runtime cleanup remains with the Coordinator."""
        if not self.running or self._task is None:
            return
        task = self._task
        # Coordinator keeps checkpoints/artifacts as its source of truth. Give
        # it a chance to persist the live tree before task cancellation tears
        # down pending provider/executor work.
        checkpoint = getattr(self._orchestrator, "_write_checkpoint", None)
        if callable(checkpoint):
            try:
                checkpoint(reason="cancelled")
            except Exception:
                pass
        self._bus.emit("session.cancelled", {"cwd": str(self.request.cwd)})
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    def _publish_event(self, event: Any) -> None:
        public_event = SessionEvent(
            type=event.type,
            data=dict(event.data),
            timestamp=event.timestamp,
        )
        for handler in tuple(self._handlers):
            result = handler(public_event)
            if asyncio.iscoroutine(result):
                asyncio.create_task(result)


class DevPilotSDK:
    """Factory for Coordinator-backed research sessions."""

    def __init__(
        self,
        *,
        provider_factory: ProviderFactory | None = None,
        orchestrator_factory: OrchestratorFactory | None = None,
    ) -> None:
        if provider_factory is None:
            from ..coordinator.main import create_provider
            provider_factory = create_provider
        if orchestrator_factory is None:
            from ..coordinator.orchestrator import CoordinatorOrchestrator
            orchestrator_factory = CoordinatorOrchestrator
        self._provider_factory = provider_factory
        self._orchestrator_factory = orchestrator_factory

    def create_session(self, request: ResearchRequest) -> ResearchSession:
        return ResearchSession(
            request=request,
            provider_factory=self._provider_factory,
            orchestrator_factory=self._orchestrator_factory,
        )
