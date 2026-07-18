"""Local Git review data for the DevPilot desktop runtime.

The desktop renderer never executes Git itself.  It asks this module through
the private desktop protocol, scoped to a registered DevPilot project.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import subprocess


@dataclass(frozen=True, slots=True)
class ChangedFile:
    """A file changed in the selected local Git repository."""

    path: str
    status: str
    additions: int | None = None
    deletions: int | None = None
    included: bool = False
    pending: bool = False

    def as_protocol(self) -> dict[str, object]:
        return {
            "path": self.path,
            "status": self.status,
            "additions": self.additions,
            "deletions": self.deletions,
            "included": self.included,
            "pending": self.pending,
        }


@dataclass(frozen=True, slots=True)
class GitChanges:
    """Review snapshot derived from the working tree, not a cloud service."""

    available: bool
    repository: str | None
    branch: str | None
    dirty: bool
    files: tuple[ChangedFile, ...]
    issue: str | None = None

    def as_protocol(self) -> dict[str, object]:
        return {
            "available": self.available,
            "repository": self.repository,
            "branch": self.branch,
            "dirty": self.dirty,
            "files": [file.as_protocol() for file in self.files],
            "issue": self.issue,
        }


class GitReviewError(ValueError):
    """A request cannot be safely fulfilled against the selected repository."""


def inspect_git_changes(project_path: str | Path) -> GitChanges:
    """Return staged and unstaged changes without mutating the repository."""

    root = Path(project_path).resolve()
    inside = _git(root, "rev-parse", "--is-inside-work-tree")
    if not inside.ok or inside.stdout.strip().lower() != "true":
        return GitChanges(False, None, None, False, (), "This folder is not a Git repository.")

    top_level = _git(root, "rev-parse", "--show-toplevel")
    repository = top_level.stdout.strip() if top_level.ok else str(root)
    branch_result = _git(root, "branch", "--show-current")
    branch = branch_result.stdout.strip() or None
    status = _git(root, "status", "--porcelain=v1")
    if not status.ok:
        return GitChanges(False, repository, branch, False, (), _issue(status))

    statistics = _numstat(root)
    files = tuple(
        ChangedFile(
            path=path,
            status=entry["status"],
            additions=statistics.get(path, (None, None))[0],
            deletions=statistics.get(path, (None, None))[1],
            included=entry["included"],
            pending=entry["pending"],
        )
        for path, entry in _parse_status(status.stdout).items()
    )
    return GitChanges(True, repository, branch, bool(files), files)


def read_git_diff(project_path: str | Path, *, file_path: str | None = None, scope: str = "combined") -> dict[str, object]:
    """Read a bounded local diff for a known changed file or the whole project."""

    snapshot = inspect_git_changes(project_path)
    if not snapshot.available:
        raise GitReviewError(snapshot.issue or "Git review is unavailable for this folder.")
    allowed = {item.path for item in snapshot.files}
    if file_path is not None and file_path not in allowed:
        raise GitReviewError("The requested file is not a changed file in this project.")
    if scope not in {"combined", "included", "pending"}:
        raise GitReviewError("Review scope must be combined, included, or pending.")

    root = Path(project_path).resolve()
    command = ["diff", "--no-ext-diff", "--unified=3"]
    if scope == "combined":
        command.append("HEAD")
    elif scope == "included":
        command.append("--cached")
    if file_path:
        command.extend(["--", file_path])
    result = _git(root, *command)
    if not result.ok:
        raise GitReviewError(_issue(result))
    # A diff is diagnostic/rendering data.  Keep the stdio response bounded.
    diff = result.stdout[:1_000_000]
    return {
        "scope": scope,
        "path": file_path,
        "diff": diff,
        "truncated": len(result.stdout) > len(diff),
    }


@dataclass(frozen=True, slots=True)
class _GitResult:
    ok: bool
    stdout: str
    stderr: str


def _git(cwd: Path, *arguments: str) -> _GitResult:
    try:
        completed = subprocess.run(
            ["git", "-C", str(cwd), *arguments],
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=10,
            shell=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return _GitResult(False, "", str(exc))
    return _GitResult(completed.returncode == 0, completed.stdout, completed.stderr)


def _parse_status(raw: str) -> dict[str, dict[str, object]]:
    entries: dict[str, dict[str, object]] = {}
    for line in raw.splitlines():
        if len(line) < 4:
            continue
        index_status, worktree_status, path = line[0], line[1], line[3:]
        # Conversation checkpoints are DevPilot's local control plane, not a
        # proposed user-code change.  Keep them out of the review surface.
        if path == ".devpilot" or path.startswith(".devpilot/"):
            continue
        # For ordinary tracked files this is the new path.  Rename/copy rows
        # retain the complete Git-provided display path instead of accepting a
        # renderer-supplied path.
        included = index_status not in {" ", "?"}
        pending = worktree_status != " " or index_status == "?"
        entries[path] = {
            "status": f"{index_status}{worktree_status}".strip() or "modified",
            "included": included,
            "pending": pending,
        }
    return entries


def _numstat(root: Path) -> dict[str, tuple[int | None, int | None]]:
    combined: dict[str, tuple[int | None, int | None]] = {}
    for arguments in (("diff", "--numstat"), ("diff", "--cached", "--numstat")):
        result = _git(root, *arguments)
        if not result.ok:
            continue
        for line in result.stdout.splitlines():
            fields = line.split("\t", 2)
            if len(fields) != 3:
                continue
            additions = _number(fields[0])
            deletions = _number(fields[1])
            path = fields[2]
            old_additions, old_deletions = combined.get(path, (0, 0))
            combined[path] = (
                None if additions is None or old_additions is None else additions + old_additions,
                None if deletions is None or old_deletions is None else deletions + old_deletions,
            )
    return combined


def _number(value: str) -> int | None:
    return int(value) if value.isdigit() else None


def _issue(result: _GitResult) -> str:
    return result.stderr.strip() or "Git could not inspect this project."
