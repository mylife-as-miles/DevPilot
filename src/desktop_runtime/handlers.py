"""Request handlers for the DevPilot-native desktop protocol."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from importlib.metadata import PackageNotFoundError, version
from typing import Any

from .authentication import AuthenticationStatus, ChatGPTAuthentication
from .events import RuntimeEvent
from .projects import preflight_project
from .protocol import ProtocolError, Request


@dataclass(frozen=True, slots=True)
class DispatchResult:
    result: Mapping[str, Any]
    events: tuple[RuntimeEvent, ...] = ()


class DesktopRuntimeHandlers:
    """Small, typed method surface for the initial desktop runtime process."""

    def __init__(
        self,
        *,
        sdk: Any,
        authentication: ChatGPTAuthentication | None = None,
        event_sink: Callable[[RuntimeEvent], Awaitable[None] | None] | None = None,
    ) -> None:
        self._sdk = sdk
        self._authentication = authentication or ChatGPTAuthentication()
        self._event_sink = event_sink
        self._conversation_subscriptions: set[tuple[str, str]] = set()
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
            "project.open": self._project_open,
            "project.list": self._project_list,
            "project.get": self._project_get,
            "project.remove": self._project_remove,
            "project.preflight": self._project_preflight,
            "conversation.create": self._conversation_create,
            "conversation.list": self._conversation_list,
            "conversation.get": self._conversation_get,
            "conversation.open": self._conversation_open,
            "conversation.rename": self._conversation_rename,
            "conversation.pin": self._conversation_pin,
            "conversation.archive": self._conversation_archive,
            "conversation.delete": self._conversation_delete,
            "conversation.resume": self._conversation_resume,
            "conversation.send": self._conversation_send,
            "run.cancel": self._run_cancel,
            "run.resume": self._run_resume,
            "run.status": self._run_status,
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
        await self._sdk.shutdown()
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

    async def _project_open(self, params: Mapping[str, Any]) -> DispatchResult:
        path = _required_string(params, "path", code="invalid_project")
        try:
            project = await self._sdk.open_project(path)
            preflight = preflight_project(path)
        except ValueError as exc:
            raise ProtocolError("invalid_project", "The selected project folder is unavailable.") from exc
        return DispatchResult({"project": project.as_protocol(), "preflight": preflight.as_protocol()})

    async def _project_list(self, _params: Mapping[str, Any]) -> DispatchResult:
        projects = await self._sdk.list_projects()
        return DispatchResult({"projects": [project.as_protocol() for project in projects]})

    async def _project_get(self, params: Mapping[str, Any]) -> DispatchResult:
        project = await self._project_for(params)
        return DispatchResult({"project": project.as_protocol()})

    async def _project_remove(self, params: Mapping[str, Any]) -> DispatchResult:
        project_id = _required_string(params, "projectId", code="invalid_project")
        return DispatchResult({"removed": await self._sdk.remove_project(project_id), "projectId": project_id})

    async def _project_preflight(self, params: Mapping[str, Any]) -> DispatchResult:
        if isinstance(params.get("path"), str) and params["path"].strip():
            path = params["path"]
        else:
            path = (await self._project_for(params)).path
        try:
            return DispatchResult({"preflight": preflight_project(path).as_protocol()})
        except (OSError, ValueError) as exc:
            raise ProtocolError("invalid_project", "The selected project folder is unavailable.") from exc

    async def _conversation_create(self, params: Mapping[str, Any]) -> DispatchResult:
        project = await self._project_for(params, open_path=True)
        model = await self._model_from(params)
        reasoning_effort = _optional_string(params, "reasoningEffort") or "high"
        sandbox = _optional_string(params, "sandbox") or "workspace-write"
        try:
            conversation = await self._sdk.create_conversation(
                cwd=project.path,
                title=_optional_string(params, "title") or "New conversation",
                provider="codex",
                model=model,
                reasoning_effort=reasoning_effort,
                sandbox=sandbox,
            )
        except ValueError as exc:
            raise ProtocolError("invalid_conversation", str(exc)) from exc
        self._watch_conversation(conversation)
        created = conversation.record.as_protocol()
        return DispatchResult({"conversation": created}, (RuntimeEvent("conversation.created", created),))

    async def _conversation_list(self, params: Mapping[str, Any]) -> DispatchResult:
        project = await self._project_for(params)
        include_archived = params.get("includeArchived", False)
        if not isinstance(include_archived, bool):
            raise ProtocolError("invalid_request", "conversation.list includeArchived must be a boolean.")
        conversations = await self._sdk.list_conversations(project.id, include_archived=include_archived)
        return DispatchResult({"projectId": project.id, "conversations": [record.as_protocol() for record in conversations]})

    async def _conversation_get(self, params: Mapping[str, Any]) -> DispatchResult:
        conversation = await self._conversation_for(params)
        return DispatchResult({"conversation": conversation.record.as_protocol(), "messages": [message.as_protocol() for message in conversation.messages()]})

    async def _conversation_open(self, params: Mapping[str, Any]) -> DispatchResult:
        conversation = await self._conversation_for(params)
        self._watch_conversation(conversation)
        return DispatchResult({"conversation": conversation.record.as_protocol(), "messages": [message.as_protocol() for message in conversation.messages()]})

    async def _conversation_rename(self, params: Mapping[str, Any]) -> DispatchResult:
        conversation = await self._conversation_for(params)
        try:
            record = conversation.rename(_required_string(params, "title", code="invalid_conversation"))
        except ValueError as exc:
            raise ProtocolError("invalid_conversation", str(exc)) from exc
        return DispatchResult({"conversation": record.as_protocol()}, (RuntimeEvent("conversation.renamed", record.as_protocol()),))

    async def _conversation_pin(self, params: Mapping[str, Any]) -> DispatchResult:
        pinned = params.get("pinned")
        if not isinstance(pinned, bool):
            raise ProtocolError("invalid_request", "conversation.pin pinned must be a boolean.")
        record = (await self._conversation_for(params)).pin(pinned)
        return DispatchResult({"conversation": record.as_protocol()}, (RuntimeEvent("conversation.pinned", record.as_protocol()),))

    async def _conversation_archive(self, params: Mapping[str, Any]) -> DispatchResult:
        archived = params.get("archived", True)
        if not isinstance(archived, bool):
            raise ProtocolError("invalid_request", "conversation.archive archived must be a boolean.")
        record = (await self._conversation_for(params)).archive(archived)
        return DispatchResult({"conversation": record.as_protocol()}, (RuntimeEvent("conversation.updated", record.as_protocol()),))

    async def _conversation_delete(self, params: Mapping[str, Any]) -> DispatchResult:
        project = await self._project_for(params)
        conversation_id = _required_string(params, "conversationId", code="invalid_conversation")
        try:
            deleted = await self._sdk.delete_conversation(project.id, conversation_id)
        except (ValueError, RuntimeError) as exc:
            raise ProtocolError("invalid_conversation", str(exc)) from exc
        return DispatchResult({"conversationId": conversation_id, "deleted": deleted}, (RuntimeEvent("conversation.updated", {"conversationId": conversation_id, "archived": True}),))

    async def _conversation_resume(self, params: Mapping[str, Any]) -> DispatchResult:
        conversation = await self._conversation_for(params)
        try:
            run = await conversation.resume(_optional_string(params, "prompt") or "Continue the current work.")
        except (ValueError, RuntimeError) as exc:
            raise ProtocolError("invalid_conversation", str(exc)) from exc
        return DispatchResult(run)

    async def _conversation_send(self, params: Mapping[str, Any]) -> DispatchResult:
        conversation = await self._conversation_for(params)
        try:
            run = await conversation.send(_required_string(params, "text", code="invalid_conversation"))
        except (ValueError, RuntimeError) as exc:
            raise ProtocolError("invalid_conversation", str(exc)) from exc
        return DispatchResult(run)

    async def _run_cancel(self, params: Mapping[str, Any]) -> DispatchResult:
        conversation = await self._conversation_for(params)
        await conversation.cancel()
        return DispatchResult({"conversationId": conversation.record.id, "runId": conversation.record.active_run_id, "state": conversation.record.state})

    async def _run_resume(self, params: Mapping[str, Any]) -> DispatchResult:
        return await self._conversation_resume(params)

    async def _run_status(self, params: Mapping[str, Any]) -> DispatchResult:
        conversation = await self._conversation_for(params)
        return DispatchResult({"conversationId": conversation.record.id, "runId": conversation.record.active_run_id, "state": conversation.record.state, "running": conversation.running})

    async def _project_for(self, params: Mapping[str, Any], *, open_path: bool = False):
        raw_project_id = _optional_string(params, "projectId")
        if raw_project_id:
            project = await self._sdk.get_project(raw_project_id)
            if project is None:
                raise ProtocolError("invalid_project", "The DevPilot project is unavailable.")
            return project
        if open_path:
            path = _required_string(params, "path", code="invalid_project")
            try:
                return await self._sdk.open_project(path)
            except ValueError as exc:
                raise ProtocolError("invalid_project", "The selected project folder is unavailable.") from exc
        raise ProtocolError("invalid_project", "A DevPilot project is required.")

    async def _conversation_for(self, params: Mapping[str, Any]):
        project = await self._project_for(params)
        conversation_id = _required_string(params, "conversationId", code="invalid_conversation")
        try:
            conversation = await self._sdk.open_conversation(project.id, conversation_id)
        except ValueError as exc:
            raise ProtocolError("invalid_conversation", "The DevPilot conversation is unavailable.") from exc
        self._watch_conversation(conversation)
        return conversation

    async def _model_from(self, params: Mapping[str, Any]) -> str:
        model = _optional_string(params, "model")
        listed = await self._models_list({})
        models = listed.result.get("models", [])
        allowed = {str(candidate.get("id")) for candidate in models if isinstance(candidate, Mapping)}
        if not allowed:
            raise ProtocolError("authentication_required", "Sign in with ChatGPT before starting a DevPilot conversation.")
        if not model and len(allowed) == 1:
            return next(iter(allowed))
        if not model or model not in allowed:
            raise ProtocolError("invalid_model", "Choose a Codex model available to your ChatGPT account.")
        return model

    def _watch_conversation(self, conversation: Any) -> None:
        key = (conversation.project.id, conversation.record.id)
        if key in self._conversation_subscriptions:
            return
        self._conversation_subscriptions.add(key)

        def forward(event: Any) -> None:
            if self._event_sink is None:
                return
            result = self._event_sink(RuntimeEvent(event.name, event.data))
            if asyncio.iscoroutine(result):
                asyncio.create_task(result)

        conversation.subscribe(forward)


def _required_string(params: Mapping[str, Any], key: str, *, code: str) -> str:
    value = _optional_string(params, key)
    if not value:
        raise ProtocolError(code, f"{key} is required.")
    return value


def _optional_string(params: Mapping[str, Any], key: str) -> str | None:
    value = params.get(key)
    return value.strip() if isinstance(value, str) and value.strip() else None


def _runtime_version() -> str:
    for distribution in ("devpilot", "miles-devpilot-cli"):
        try:
            return version(distribution)
        except PackageNotFoundError:
            continue
    return "unknown"
