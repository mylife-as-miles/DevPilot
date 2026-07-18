"""CLI entry point for DevPilot's private Electron desktop protocol."""

from __future__ import annotations

import typer

from ...desktop_runtime import serve_stdio


def desktop_runtime_command(
    stdio: bool = typer.Option(False, "--stdio", help="Serve the DevPilot desktop protocol over standard input/output."),
) -> None:
    """Start the DevPilot-native desktop runtime."""
    if not stdio:
        raise typer.BadParameter("desktop-runtime currently requires --stdio.")
    serve_stdio()
