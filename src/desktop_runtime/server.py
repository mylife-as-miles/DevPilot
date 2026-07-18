"""JSON-lines stdio host for the private DevPilot desktop protocol."""

from __future__ import annotations

import asyncio
import json
import os
import sys
from collections.abc import Mapping
from typing import Any, TextIO

from ..sdk.runtime import DevPilotSDK
from ..sdk.stdio import protocol_stdio_context
from .authentication import ChatGPTAuthentication
from .handlers import DesktopRuntimeHandlers
from .protocol import ProtocolError, event, failure, parse_request, sanitize_text, success


class DesktopRuntimeServer:
    """Serve DevPilot desktop requests with protocol-only stdout."""

    def __init__(
        self,
        sdk: DevPilotSDK | None = None,
        *,
        authentication: ChatGPTAuthentication | None = None,
        stdin: TextIO = sys.stdin,
        stdout: TextIO = sys.stdout,
        stderr: TextIO = sys.stderr,
    ) -> None:
        self.sdk = sdk or DevPilotSDK()
        self._stdin = stdin
        self._stdout = stdout
        self._stderr = stderr
        self._handlers = DesktopRuntimeHandlers(
            sdk=self.sdk,
            authentication=authentication,
            event_sink=self._send_runtime_event,
        )
        self._write_lock = asyncio.Lock()

    async def serve(self) -> None:
        """Read newline-delimited requests until stdin closes or shutdown succeeds."""
        with protocol_stdio_context(self._stderr):
            while (line := await asyncio.to_thread(self._stdin.readline)):
                await self._dispatch_line(line)
                if self._handlers.shutdown_requested:
                    break

    async def _dispatch_line(self, line: str) -> None:
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            self._log("Ignoring malformed desktop protocol JSON frame.")
            return
        request_id = payload.get("id") if isinstance(payload, Mapping) and isinstance(payload.get("id"), str) else None
        try:
            request = parse_request(payload)
            dispatched = await self._handlers.dispatch(request)
            await self._send(success(request.request_id, dispatched.result))
            for emitted in dispatched.events:
                await self._send(event(emitted.name, emitted.data))
        except ProtocolError as exc:
            await self._send(failure(request_id, exc))
        except Exception as exc:  # never leak Python internals or secrets to stdout
            self._log(f"desktop protocol request failed: {sanitize_text(str(exc))}")
            await self._send(failure(request_id, ProtocolError("internal_error", "DevPilot desktop runtime request failed.")))

    async def _send(self, frame: Mapping[str, Any]) -> None:
        payload = json.dumps(frame, ensure_ascii=False, separators=(",", ":")) + "\n"
        async with self._write_lock:
            self._stdout.write(payload)
            self._stdout.flush()

    async def _send_runtime_event(self, emitted: Any) -> None:
        await self._send(event(emitted.name, emitted.data))

    def _log(self, message: str) -> None:
        self._stderr.write(f"devpilot desktop-runtime: {sanitize_text(message)}\n")
        self._stderr.flush()


def serve_stdio() -> None:
    """Start the desktop protocol process from the CLI command."""
    authentication: ChatGPTAuthentication | None = None
    if os.environ.get("DEVPILOT_DESKTOP_RUNTIME_TEST_MODE") == "1":
        authentication = _deterministic_authentication()
    asyncio.run(DesktopRuntimeServer(authentication=authentication).serve())


def _deterministic_authentication() -> ChatGPTAuthentication:
    """Create a no-network auth fixture for process integration tests only."""
    from .authentication import AuthenticationStatus

    class DeterministicAuthentication(ChatGPTAuthentication):
        def __init__(self) -> None:
            self._status = AuthenticationStatus(signed_in=True, account_label="test-account", plan="test")

        def status(self) -> AuthenticationStatus:
            return self._status

        def login(self, *, open_browser: bool = True) -> AuthenticationStatus:
            del open_browser
            return self._status

        def logout(self) -> AuthenticationStatus:
            self._status = AuthenticationStatus(signed_in=False)
            return self._status

    return DeterministicAuthentication()
