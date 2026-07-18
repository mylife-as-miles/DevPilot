"""Output routing for protocol hosts."""

from __future__ import annotations

import contextlib
import contextvars
from collections.abc import Iterator
from typing import TextIO

_protocol_stderr: contextvars.ContextVar[TextIO | None] = contextvars.ContextVar(
    "devpilot_protocol_stderr", default=None
)


@contextlib.contextmanager
def protocol_stdio_context(stderr: TextIO) -> Iterator[None]:
    """Route shared runtime diagnostics to stderr for one protocol lifetime."""
    token = _protocol_stderr.set(stderr)
    try:
        yield
    finally:
        _protocol_stderr.reset(token)


def acp_stdio_context(stderr: TextIO) -> Iterator[None]:
    """Compatibility alias for the optional ACP stdio adapter."""
    return protocol_stdio_context(stderr)


def write_protocol_diagnostic(message: str) -> bool:
    """Write a diagnostic when ACP mode is active, otherwise return False."""
    stream = _protocol_stderr.get()
    if stream is None:
        return False
    stream.write(f"{message}\n")
    stream.flush()
    return True
