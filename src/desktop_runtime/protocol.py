"""Typed framing helpers for the private desktop stdio protocol."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any


_SENSITIVE_MARKERS = ("api_key", "apikey", "token", "secret", "authorization", "password", "credential", "cookie")


class ProtocolError(ValueError):
    """A safe, renderer-facing protocol error."""

    def __init__(self, code: str, message: str, *, details: Mapping[str, Any] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = dict(details or {})


@dataclass(frozen=True, slots=True)
class Request:
    """A validated desktop request envelope."""

    request_id: str
    method: str
    params: Mapping[str, Any]


def parse_request(payload: Any) -> Request:
    """Validate one decoded request without accepting arbitrary envelopes."""
    if not isinstance(payload, Mapping):
        raise ProtocolError("invalid_request", "Protocol request must be a JSON object.")
    request_id = payload.get("id")
    method = payload.get("method")
    params = payload.get("params", {})
    if not isinstance(request_id, str) or not request_id.strip():
        raise ProtocolError("invalid_request", "Protocol request id must be a non-empty string.")
    if not isinstance(method, str) or not method.strip():
        raise ProtocolError("invalid_request", "Protocol method must be a non-empty string.")
    if not isinstance(params, Mapping):
        raise ProtocolError("invalid_request", "Protocol params must be an object.")
    return Request(request_id=request_id, method=method, params=dict(params))


def success(request_id: str, result: Mapping[str, Any]) -> dict[str, Any]:
    return {"id": request_id, "result": sanitize_mapping(result)}


def failure(request_id: str | None, error: ProtocolError) -> dict[str, Any]:
    frame: dict[str, Any] = {
        "error": {
            "code": error.code,
            "message": sanitize_text(error.message),
            "details": sanitize_mapping(error.details),
        }
    }
    if request_id is not None:
        frame["id"] = request_id
    return frame


def event(name: str, data: Mapping[str, Any]) -> dict[str, Any]:
    return {"event": name, "data": sanitize_mapping(data)}


def sanitize_mapping(value: Mapping[str, Any]) -> dict[str, Any]:
    return {
        str(key): "[redacted]" if _is_sensitive_key(str(key)) else sanitize_value(item)
        for key, item in value.items()
    }


def sanitize_value(value: Any) -> Any:
    if isinstance(value, Mapping):
        return sanitize_mapping(value)
    if isinstance(value, list):
        return [sanitize_value(item) for item in value]
    if isinstance(value, tuple):
        return [sanitize_value(item) for item in value]
    if isinstance(value, str):
        return sanitize_text(value)
    return value


def sanitize_text(value: str) -> str:
    """Keep diagnostics useful without transporting credentials to Electron."""
    lowered = value.lower()
    if any(marker.lower() in lowered for marker in ("sk-", "bearer ", "ghp_", "glpat-")):
        return "[redacted diagnostic]"
    return value


def _is_sensitive_key(key: str) -> bool:
    lowered = key.lower()
    return any(marker in lowered for marker in _SENSITIVE_MARKERS)
