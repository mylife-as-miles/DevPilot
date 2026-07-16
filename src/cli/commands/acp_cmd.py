"""CLI entry point for the local Agent Client Protocol adapter."""

from __future__ import annotations

import typer

from ...sdk.acp import serve_stdio


def acp_command(
    stdio: bool = typer.Option(False, "--stdio", help="Serve ACP JSON-RPC over standard input/output."),
) -> None:
    """Start the DevPilot ACP adapter."""
    if not stdio:
        raise typer.BadParameter("ACP currently requires --stdio.")
    serve_stdio()
