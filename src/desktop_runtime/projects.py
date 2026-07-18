"""Local-project preflight primitives for the desktop runtime."""

from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class ProjectPreflight:
    path: Path
    readable: bool
    is_git_repository: bool
    branch: str | None
    dirty: bool | None
    git_available: bool

    def as_protocol(self) -> dict[str, object]:
        return {
            "path": str(self.path),
            "readable": self.readable,
            "isGitRepository": self.is_git_repository,
            "branch": self.branch,
            "dirty": self.dirty,
            "gitAvailable": self.git_available,
        }


def preflight_project(raw_path: str | Path) -> ProjectPreflight:
    """Inspect a selected folder with Git argv only; never invoke a shell."""
    path = Path(raw_path).expanduser().resolve()
    readable = path.is_dir()
    git = shutil.which("git")
    if not readable or not git:
        return ProjectPreflight(path, readable, False, None, None, bool(git))

    def git_output(*args: str) -> tuple[int, str]:
        try:
            completed = subprocess.run(
                [git, *args],
                cwd=path,
                shell=False,
                check=False,
                capture_output=True,
                text=True,
                timeout=10,
            )
        except (OSError, subprocess.TimeoutExpired):
            return 1, ""
        return completed.returncode, completed.stdout.strip()

    code, inside = git_output("rev-parse", "--is-inside-work-tree")
    if code != 0 or inside != "true":
        return ProjectPreflight(path, True, False, None, None, True)
    _, branch = git_output("branch", "--show-current")
    status_code, status = git_output("status", "--porcelain=v1")
    return ProjectPreflight(path, True, True, branch or None, status != "" if status_code == 0 else None, True)
