"""DevPilot's private desktop runtime protocol.

The Electron application talks to this package over newline-delimited JSON on
standard input/output.  It is deliberately separate from the optional ACP
adapter so desktop concepts stay project/conversation/run oriented.
"""

from .server import DesktopRuntimeServer, serve_stdio

__all__ = ["DesktopRuntimeServer", "serve_stdio"]
