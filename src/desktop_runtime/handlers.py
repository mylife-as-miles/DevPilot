"""Request handlers for the DevPilot-native desktop protocol."""

from __future__ import annotations

import asyncio
from collections.abc import Mapping
from dataclasses import dataclass
from importlib.metadata import PackageNotFoundError, version
from typing import Any

from .authentication import AuthenticationStatus, ChatGPTAuthentication
from .events import RuntimeEvent
from .protocol import ProtocolError, Request


@dataclass(frozen=True, slots=True)
class DispatchResult:
    result: Mapping[str, Any]
    events: tuple[RuntimeEvent, ...] = ()


class DesktopRuntimeHandlers:
    """Small, typed method surface for the initial desktop runtime process."""

    def __init__(self, *, authentication: ChatGPTAuthentication | None = None) -> None:
        self._authentication = authentication or ChatGPTAuthentication()
        self._initialized = False
        self.shutdown_requested = False

    async def dispatch(self, request: Request) -> DispatchResult:
        handlers = {
            "runtime.initialize": self._runtime_initialize,
            "runtime.status": self._runtime_status,
            "runtime.version": self._runtime_version,
            "runtime.shutdown": self._runtime_shutdown,
            "auth.status": self._auth_status,
            "auth.login": self._auth_login,
            "auth.logout": self._auth_logout,
            "models.list": self._models_list,
        }
        handler = handlers.get(request.method)
        if handler is None:
            raise ProtocolError("method_not_found", f"Unsupported DevPilot desktop method: {request.method}")
        return await handler(request.params)

    async def _runtime_initialize(self, _params: Mapping[str, Any]) -> DispatchResult:
        self._initialized = True
        status = self._authentication.status()
        return DispatchResult(
            {
                "protocolVersion": 1,
                "runtime": "devpilot-desktop-runtime",
                "authenticated": status.signed_in,
                "version": _runtime_version(),
            },
            (RuntimeEvent("runtime.status", {"state": "ready"}),),
        )

    async def _runtime_status(self, _params: Mapping[str, Any]) -> DispatchResult:
        return DispatchResult({
            "state": "ready" if self._initialized else "starting",
            "authenticated": self._authentication.status().signed_in,
        })

    async def _runtime_version(self, _params: Mapping[str, Any]) -> DispatchResult:
        return DispatchResult({"version": _runtime_version(), "protocolVersion": 1})

    async def _runtime_shutdown(self, _params: Mapping[str, Any]) -> DispatchResult:
        self.shutdown_requested = True
        return DispatchResult({"status": "shutting_down"}, (RuntimeEvent("runtime.status", {"state": "shutting_down"}),))

    async def _auth_status(self, _params: Mapping[str, Any]) -> DispatchResult:
        return DispatchResult(self._authentication.status().as_protocol())

    async def _auth_login(self, params: Mapping[str, Any]) -> DispatchResult:
        open_browser = params.get("openBrowser", True)
        if not isinstance(open_browser, bool):
            raise ProtocolError("invalid_request", "auth.login openBrowser must be a boolean.")
        status = await asyncio.to_thread(self._authentication.login, open_browser=open_browser)
        return DispatchResult(status.as_protocol(), (RuntimeEvent("auth.updated", status.as_protocol()),))

    async def _auth_logout(self, _params: Mapping[str, Any]) -> DispatchResult:
        status = await asyncio.to_thread(self._authentication.logout)
        return DispatchResult(status.as_protocol(), (RuntimeEvent("auth.updated", status.as_protocol()),))

    async def _models_list(self, _params: Mapping[str, Any]) -> DispatchResult:
        status = self._authentication.status()
        if not status.signed_in:
            return DispatchResult({"provider": "codex", "models": []})
        from ..cli._constants import DEFAULT_OPENAI_OAUTH_MODEL
        from ..cli.user_config import llm_defaults

        configured = llm_defaults()
        configured_provider = str(configured.get("provider") or "").strip().lower()
        model = str(configured.get("model") or DEFAULT_OPENAI_OAUTH_MODEL).strip()
        if configured_provider and configured_provider != "openai-oauth":
            return DispatchResult({"provider": "codex", "models": []})
        return DispatchResult({
            "provider": "codex",
            "models": [{
                "id": model,
                "label": model,
                "reasoningEfforts": ["low", "medium", "high"],
                "defaultReasoningEffort": "high",
            }],
        })


def _runtime_version() -> str:
    for distribution in ("devpilot", "miles-devpilot-cli"):
        try:
            return version(distribution)
        except PackageNotFoundError:
            continue
    return "unknown"
