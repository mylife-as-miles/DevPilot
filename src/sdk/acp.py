"""Small ACP stdio adapter built on the public DevPilot SDK.

It deliberately keeps protocol framing and stderr diagnostics at the edge;
Coordinator and Executor code only receives typed SDK requests and events.
"""

from __future__ import annotations

import asyncio
import json
import sys
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, TextIO
from uuid import uuid4

from .runtime import DevPilotSDK, ResearchRequest, ResearchSession, SessionEvent
from .stdio import acp_stdio_context


@dataclass(slots=True)
class _AcpSession:
    cwd: Path
    runtime: ResearchSession | None = None


class AcpStdioServer:
    """Serve the ACP JSON-RPC subset required by the local desktop client."""

    def __init__(
        self,
        sdk: DevPilotSDK | None = None,
        *,
        stdin: TextIO = sys.stdin,
        stdout: TextIO = sys.stdout,
        stderr: TextIO = sys.stderr,
    ) -> None:
        self._sdk = sdk or DevPilotSDK()
        self._stdin = stdin
        self._stdout = stdout
        self._stderr = stderr
        self._sessions: dict[str, _AcpSession] = {}
        self._write_lock = asyncio.Lock()

    async def serve(self) -> None:
        """Read newline-delimited JSON-RPC messages until standard input closes."""
        with acp_stdio_context(self._stderr):
            while (line := await asyncio.to_thread(self._stdin.readline)):
                try:
                    message = json.loads(line)
                except json.JSONDecodeError:
                    self._log("Ignoring malformed ACP JSON frame.")
                    continue
                if not isinstance(message, dict) or "method" not in message:
                    continue
                await self._dispatch(message)

    async def _dispatch(self, request: Mapping[str, Any]) -> None:
        method = request.get("method")
        request_id = request.get("id")
        params = request.get("params") if isinstance(request.get("params"), Mapping) else {}
        if not isinstance(method, str):
            return

        try:
            if method == "initialize":
                await self._reply(request_id, {"protocolVersion": 1, "authMethods": []})
            elif method == "session/new":
                await self._new_session(request_id, params)
            elif method == "session/prompt":
                self._start_prompt(request_id, params)
            elif method == "session/cancel":
                await self._cancel(request_id, params)
            elif method == "devpilot/preflight":
                await self._preflight(request_id, params)
            else:
                await self._error(request_id, -32601, f"Unsupported ACP method: {method}")
        except Exception as exc:  # protocol errors must never contaminate stdout
            self._log(f"ACP {method} failed: {exc}")
            await self._error(request_id, -32603, str(exc))

    async def _new_session(self, request_id: Any, params: Mapping[str, Any]) -> None:
        raw_cwd = params.get("cwd") or params.get("workingDirectory") or "."
        cwd = Path(str(raw_cwd)).expanduser().resolve()
        if not cwd.is_dir():
            raise ValueError(f"Session directory is not accessible: {cwd}")
        session_id = str(uuid4())
        self._sessions[session_id] = _AcpSession(cwd=cwd)
        await self._reply(request_id, {"sessionId": session_id})

    def _start_prompt(self, request_id: Any, params: Mapping[str, Any]) -> None:
        session_id = str(params.get("sessionId") or "")
        session = self._sessions.get(session_id)
        if session is None:
            raise ValueError("Unknown ACP session.")
        if session.runtime and session.runtime.running:
            raise RuntimeError("The ACP session already has a research run in progress.")

        task = _prompt_text(params.get("prompt"))
        options = params.get("options") if isinstance(params.get("options"), Mapping) else {}
        request = ResearchRequest(cwd=session.cwd, task=task, options=options)
        runtime = self._sdk.create_session(request)
        runtime.subscribe(lambda event: self._event_update(session_id, event))
        session.runtime = runtime
        asyncio.create_task(self._run_prompt(request_id, session_id, runtime))

    async def _run_prompt(self, request_id: Any, session_id: str, runtime: ResearchSession) -> None:
        try:
            report = await runtime.run()
            await self._update(session_id, {
                "sessionUpdate": "agent_message_chunk",
                "content": {"type": "text", "text": report},
            })
            await self._reply(request_id, {"stopReason": "end_turn"})
        except asyncio.CancelledError:
            await self._reply(request_id, {"stopReason": "cancelled"})
        except Exception as exc:
            self._log(f"ACP session {session_id} failed: {exc}")
            await self._error(request_id, -32603, str(exc))

    async def _cancel(self, request_id: Any, params: Mapping[str, Any]) -> None:
        session_id = str(params.get("sessionId") or "")
        session = self._sessions.get(session_id)
        if session is None:
            raise ValueError("Unknown ACP session.")
        if session.runtime is None or not session.runtime.running:
            await self._reply(request_id, {"status": "idle"})
            return
        await self._update(session_id, {
            "sessionUpdate": "devpilot_status",
            "_meta": {"devpilot": {"type": "run.cancelling", "state": "cancelling"}},
        })
        await session.runtime.cancel()
        await self._update(session_id, {
            "sessionUpdate": "devpilot_status",
            "_meta": {"devpilot": {"type": "run.cancelled", "state": "cancelled"}},
        })
        await self._reply(request_id, {"status": "cancelled"})

    async def _preflight(self, request_id: Any, params: Mapping[str, Any]) -> None:
        """Return read-only project readiness checks before a prompt starts."""
        raw_cwd = params.get("cwd") or params.get("workingDirectory") or "."
        cwd = Path(str(raw_cwd)).expanduser().resolve()
        checks: list[dict[str, str]] = []
        if not cwd.is_dir():
            checks.append(_check("directory", "fail", f"Directory is not accessible: {cwd}", "Choose an existing local project directory."))
            await self._reply(request_id, {"ready": False, "checks": checks})
            return
        try:
            next(cwd.iterdir(), None)
            checks.append(_check("directory", "pass", "Directory is readable."))
        except OSError:
            checks.append(_check("directory", "fail", "Directory is not readable.", "Check project permissions and try again."))

        options = params.get("options") if isinstance(params.get("options"), Mapping) else {}
        try:
            from ..core.config_resolve import resolve_runtime_config
            config = resolve_runtime_config(cwd=cwd, task="Preflight", overrides=options)
        except Exception as exc:
            checks.append(_check("configuration", "fail", _public_error(exc), "Fix the DevPilot setup or project configuration."))
            await self._reply(request_id, {"ready": False, "checks": checks})
            return

        from ..cli.preflight import PreflightChecker
        for result in PreflightChecker(
            cwd=cwd,
            provider=config.provider,
            explicit_api_key=config.api_key,
            orbit=config.orbit,
        ).run_all_collect(render=False):
            checks.append(_check(result.name, result.status, result.message, result.hint))
        ready = not any(check["status"] == "fail" for check in checks)
        await self._reply(request_id, {"ready": ready, "checks": checks})

    async def _event_update(self, session_id: str, event: SessionEvent) -> None:
        await self._update(session_id, {
            "sessionUpdate": "agent_message_chunk",
            "content": {"type": "text", "text": _event_summary(event)},
            "_meta": {"devpilot": {"type": event.type, **_public_mapping(event.data)}},
        })

    async def _update(self, session_id: str, update: Mapping[str, Any]) -> None:
        await self._send({
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": {"sessionId": session_id, "update": update},
        })

    async def _reply(self, request_id: Any, result: Mapping[str, Any]) -> None:
        if request_id is not None:
            await self._send({"jsonrpc": "2.0", "id": request_id, "result": result})

    async def _error(self, request_id: Any, code: int, message: str) -> None:
        if request_id is not None:
            await self._send({"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}})

    async def _send(self, message: Mapping[str, Any]) -> None:
        payload = json.dumps(message, ensure_ascii=False, separators=(",", ":")) + "\n"
        async with self._write_lock:
            self._stdout.write(payload)
            self._stdout.flush()

    def _log(self, message: str) -> None:
        self._stderr.write(f"devpilot acp: {message}\n")
        self._stderr.flush()


def _prompt_text(value: Any) -> str:
    if isinstance(value, str) and value.strip():
        return value.strip()
    if isinstance(value, Mapping):
        return _prompt_text(value.get("text") or value.get("content"))
    if isinstance(value, list):
        parts = [_prompt_text(item) for item in value]
        text = "\n".join(part for part in parts if part)
        if text:
            return text
    raise ValueError("ACP prompt must contain text.")


def _event_summary(event: SessionEvent) -> str:
    if event.data:
        details = ", ".join(f"{key}={value}" for key, value in event.data.items())
        return f"{event.type}: {details}"
    return event.type


def _check(identifier: str, status: str, message: str, remediation: str | None = None) -> dict[str, str]:
    result = {"id": identifier, "status": status, "message": _public_text(message)}
    if remediation:
        result["remediation"] = _public_text(remediation)
    return result


_SENSITIVE_MARKERS = ("api_key", "apikey", "token", "secret", "authorization", "password", "credential")


def _public_mapping(value: Mapping[str, Any]) -> dict[str, Any]:
    return {
        str(key): "[redacted]" if any(marker in str(key).lower() for marker in _SENSITIVE_MARKERS)
        else _public_value(item)
        for key, item in value.items()
    }


def _public_value(value: Any) -> Any:
    if isinstance(value, Mapping):
        return _public_mapping(value)
    if isinstance(value, list):
        return [_public_value(item) for item in value]
    return _public_text(value) if isinstance(value, str) else value


def _public_text(value: Any) -> str:
    text = str(value)
    # Deliberately conservative: protocol messages are diagnostics, not a
    # mechanism for exposing configuration values.
    for marker in ("sk-", "Bearer ", "ghp_", "glpat-"):
        if marker.lower() in text.lower():
            return "[redacted diagnostic]"
    return text


def _public_error(exc: Exception) -> str:
    return _public_text(exc)


def serve_stdio() -> None:
    """Start the ACP server using only standard streams."""
    asyncio.run(AcpStdioServer().serve())
