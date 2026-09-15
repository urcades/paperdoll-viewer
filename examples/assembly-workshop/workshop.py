#!/usr/bin/env python3
"""Headless assembly workshop for Paperchain scenes.

The workshop owns one deliberately narrow policy: detach a port-connected
Paperdoll subassembly and decide, by explicitly named relation kinds, which
Paperchain endpoints follow it. Paperfold records the resulting transaction;
Papermold judges whether the persisted scene is serviceable.
"""

from __future__ import annotations

import argparse
import copy
import importlib
import json
import os
import sys
import tempfile
from pathlib import Path
from types import ModuleType
from typing import Any, Iterable


# Importing this stdlib-only tool must not create __pycache__ beside either the
# consumer or a caller-supplied reference implementation.
sys.dont_write_bytecode = True

SIDES = ("top", "right", "bottom", "left")


class WorkshopError(Exception):
    def __init__(self, code: str, message: str, details: Any = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details


def _read_json(path: Path, portable: ModuleType) -> Any:
    try:
        with path.open("r", encoding="utf-8") as source:
            text = source.read()
    except OSError as error:
        raise WorkshopError("invalid-json-file", f"Cannot read JSON from {path}: {error}") from error
    try:
        return portable.loads_portable_json(text)
    except portable.PortableJSONError as error:
        raise WorkshopError("non-portable-json", f"Non-portable JSON in {path}: {error}") from error


def _atomic_write_json(path: Path, value: Any, portable: ModuleType) -> None:
    """Replace only ``path``, using a temporary file in its own directory."""

    try:
        normalized = portable.normalize_portable_json(value)
    except portable.PortableJSONError as error:
        raise WorkshopError("non-portable-json", f"Refusing non-portable output: {error}") from error

    parent = path.parent
    if not parent.is_dir():
        raise WorkshopError("missing-state-directory", f"State directory does not exist: {parent}")

    descriptor = -1
    temporary_name = ""
    try:
        descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=parent)
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            descriptor = -1
            json.dump(normalized, output, indent=2, sort_keys=True, allow_nan=False)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary_name, path)
        temporary_name = ""
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        if temporary_name:
            try:
                os.unlink(temporary_name)
            except FileNotFoundError:
                pass


def _load_state(path: Path, portable: ModuleType) -> dict[str, Any]:
    state = _read_json(path, portable)
    if type(state) is not dict or set(state) != {"scene", "history", "cursor"}:
        raise WorkshopError("invalid-state", "State must contain exactly scene, history, and cursor.")
    history = state["history"]
    cursor = state["cursor"]
    if type(history) is not list or type(cursor) is not int or not 0 <= cursor <= len(history):
        raise WorkshopError("invalid-state", "State history/cursor is malformed.")
    if any(type(item) is not dict or set(item) != {"patch", "inverse"} for item in history):
        raise WorkshopError("invalid-state", "Each history record must contain exactly patch and inverse.")
    return state


def _candidate_reference_dirs() -> Iterable[Path]:
    """Find the reference files carried by an installed paperchain package."""

    seen: set[Path] = set()
    for origin in (Path.cwd(), Path(__file__).resolve().parent):
        for ancestor in (origin, *origin.parents):
            candidate = ancestor / "node_modules" / "paperchain" / "conformance" / "python"
            if candidate not in seen:
                seen.add(candidate)
                yield candidate


def load_references(reference_dir: Path | None) -> dict[str, ModuleType]:
    if reference_dir is not None:
        candidates = [reference_dir]
    else:
        candidates = list(_candidate_reference_dirs())

    for candidate in candidates:
        if all(
            (candidate / name).is_file()
            for name in ("paper_conformance.py", "paperfold.py", "papermold.py", "portable_json.py")
        ):
            sys.path.insert(0, str(candidate.resolve()))
            break
    else:
        if reference_dir is not None:
            raise WorkshopError(
                "missing-reference",
                "Reference directory lacks paper_conformance.py, paperfold.py, "
                f"papermold.py, or portable_json.py: {reference_dir}",
            )

    try:
        return {
            "conformance": importlib.import_module("paper_conformance"),
            "fold": importlib.import_module("paperfold"),
            "mold": importlib.import_module("papermold"),
            "portable": importlib.import_module("portable_json"),
        }
    except ImportError as error:
        raise WorkshopError(
            "missing-reference",
            "Cannot locate paperchain/conformance/python with the required reference modules; "
            "pass --reference-dir explicitly.",
        ) from error


def _component(vessels: dict[str, Any], start: str, ignored_edge: frozenset[str] | None = None) -> set[str]:
    reached: set[str] = set()
    pending = [start]
    while pending:
        vessel_id = pending.pop()
        if vessel_id in reached:
            continue
        reached.add(vessel_id)
        for address in vessels[vessel_id].get("ports", {}).values():
            neighbor = address["vessel"]
            if ignored_edge is not None and frozenset((vessel_id, neighbor)) == ignored_edge:
                continue
            if neighbor not in reached:
                pending.append(neighbor)
    return reached


def _endpoint_is_in_vessels(address: str, body_name: str, vessel_ids: set[str]) -> bool:
    """Classify by parsed body and top-level vessel segments, never prefixes."""

    segments = address.split("/")
    return len(segments) >= 2 and segments[0] == body_name and segments[1] in vessel_ids


def _rewrite_endpoint(address: str, body_name: str, new_body_name: str) -> str:
    segments = address.split("/")
    if segments[0] != body_name:
        raise AssertionError("endpoint was not classified before rewrite")
    return "/".join((new_body_name, *segments[1:]))


def detach_scene(
    scene: dict[str, Any],
    *,
    body_name: str,
    vessel_id: str,
    side: str,
    new_body_name: str,
    follow_kinds: set[str],
    drop_crossing_kinds: set[str],
) -> dict[str, Any]:
    """Return a detached scene without mutating ``scene``.

    Relation policy is intentionally consumer-owned and closed: crossing
    relations in ``drop_crossing_kinds`` are removed, moved endpoints in
    ``follow_kinds`` are rewritten, and every other relation stays byte-for-
    byte equivalent. If that last rule would leave an endpoint dangling, the
    entire transformation is rejected.
    """

    if new_body_name in scene["bodies"]:
        raise WorkshopError("body-name-collision", f'Scene already contains body "{new_body_name}".')
    if body_name not in scene["bodies"]:
        raise WorkshopError("missing-body", f'Scene has no body "{body_name}".')
    if side not in SIDES:
        raise WorkshopError("invalid-side", f'Unknown side "{side}".')

    body = scene["bodies"][body_name]
    vessels = body["vessels"]
    if vessel_id not in vessels:
        raise WorkshopError("missing-vessel", f'Body "{body_name}" has no vessel "{vessel_id}".')
    selected_ports = vessels[vessel_id].get("ports", {})
    if side not in selected_ports:
        raise WorkshopError("empty-port", f'Port "{body_name}/{vessel_id}:{side}" is empty.')

    neighbor_id = selected_ports[side]["vessel"]
    original_component = _component(vessels, body["root"])
    cut_edge = frozenset((vessel_id, neighbor_id))
    root_component = _component(vessels, body["root"], cut_edge)
    if vessel_id in root_component and neighbor_id in root_component:
        raise WorkshopError("cut-does-not-separate", "Selected port belongs to a cycle and does not detach a subassembly.")

    detached_ids = original_component - root_component
    if not detached_ids:
        raise WorkshopError("cut-does-not-separate", "Selected port does not separate a non-root subassembly.")
    detached_root = neighbor_id if neighbor_id in detached_ids else vessel_id

    result = copy.deepcopy(scene)
    edited_body = result["bodies"][body_name]
    reciprocal_side = selected_ports[side]["side"]
    edited_body["vessels"][vessel_id].get("ports", {}).pop(side, None)
    edited_body["vessels"][neighbor_id].get("ports", {}).pop(reciprocal_side, None)

    detached_vessels = {
        name: edited_body["vessels"][name]
        for name in sorted(detached_ids)
    }
    edited_body["vessels"] = {
        name: vessel
        for name, vessel in edited_body["vessels"].items()
        if name not in detached_ids
    }
    result["bodies"][new_body_name] = {
        "root": detached_root,
        "vessels": detached_vessels,
    }

    rewritten_relations: list[dict[str, Any]] = []
    dangling: list[dict[str, Any]] = []
    for relation in result["relations"]:
        from_moved = _endpoint_is_in_vessels(relation["from"], body_name, detached_ids)
        to_moved = _endpoint_is_in_vessels(relation["to"], body_name, detached_ids)
        crossing = from_moved != to_moved

        if crossing and relation["kind"] in drop_crossing_kinds:
            continue

        if relation["kind"] in follow_kinds:
            if from_moved:
                relation["from"] = _rewrite_endpoint(relation["from"], body_name, new_body_name)
            if to_moved:
                relation["to"] = _rewrite_endpoint(relation["to"], body_name, new_body_name)
        elif from_moved or to_moved:
            dangling.append(copy.deepcopy(relation))
        rewritten_relations.append(relation)

    if dangling:
        raise WorkshopError(
            "unhandled-dangling-relations",
            "Detach would leave relations pointing into vessels removed from the source body.",
            dangling,
        )
    result["relations"] = rewritten_relations
    return result


def _unwrap(result: Any, operation: str) -> Any:
    """Unwrap the Python reference Result while tolerating pure direct values."""

    if type(result) is dict and type(result.get("ok")) is bool:
        if result["ok"]:
            return result["value"]
        raise WorkshopError("reference-operation-failed", f"{operation} failed.", result.get("errors", []))
    return result


def _validate_scene(scene: Any, conformance: ModuleType) -> list[dict[str, str]]:
    errors = conformance.validate_scene(scene)
    return [error if type(error) is dict else {"path": str(error), "message": "invalid scene"} for error in errors]


def _require_valid_scene(scene: Any, conformance: ModuleType) -> None:
    errors = _validate_scene(scene, conformance)
    if errors:
        raise WorkshopError("invalid-scene", "Scene is not paperchain/v1-valid.", errors)


def _record_scene_change(state: dict[str, Any], target_scene: dict[str, Any], fold: ModuleType) -> dict[str, Any]:
    patch = _unwrap(fold.diff_scenes(state["scene"], target_scene), "diff_scenes")
    inverse = _unwrap(fold.invert_scene_patch(patch), "invert_scene_patch")
    applied = _unwrap(fold.apply_scene_patch(state["scene"], patch), "apply_scene_patch")

    history = copy.deepcopy(state["history"][: state["cursor"]])
    history.append({"patch": patch, "inverse": inverse})
    return {"scene": applied, "history": history, "cursor": len(history)}


def _command_init(arguments: argparse.Namespace, references: dict[str, ModuleType]) -> dict[str, Any]:
    if arguments.state.exists():
        raise WorkshopError("state-exists", f"Refusing to overwrite existing state: {arguments.state}")
    scene = _read_json(arguments.scene, references["portable"])
    _require_valid_scene(scene, references["conformance"])
    scene = references["fold"].canonicalize_scene(scene)
    state = {"scene": scene, "history": [], "cursor": 0}
    _atomic_write_json(arguments.state, state, references["portable"])
    return {"state": str(arguments.state), "bodies": sorted(scene["bodies"])}


def _command_inspect(arguments: argparse.Namespace, references: dict[str, ModuleType]) -> dict[str, Any]:
    state = _load_state(arguments.state, references["portable"])
    scene = state["scene"]
    return {
        "protocol": scene.get("protocol"),
        "bodies": sorted(scene.get("bodies", {})),
        "kinds": sorted(scene.get("kinds", {})),
        "relations": len(scene.get("relations", [])),
        "historyLength": len(state["history"]),
        "cursor": state["cursor"],
    }


def _command_validate(arguments: argparse.Namespace, references: dict[str, ModuleType]) -> tuple[dict[str, Any], int]:
    state = _load_state(arguments.state, references["portable"])
    errors = _validate_scene(state["scene"], references["conformance"])
    return {"valid": not errors, "errors": errors}, 0 if not errors else 1


def _command_judge(arguments: argparse.Namespace, references: dict[str, ModuleType]) -> tuple[dict[str, Any], int]:
    state = _load_state(arguments.state, references["portable"])
    profiles = _read_json(arguments.profiles, references["portable"])
    errors = references["mold"].judge_scene(state["scene"], profiles, arguments.profile_id)
    return {"conforms": not errors, "errors": errors}, 0 if not errors else 1


def _command_detach(arguments: argparse.Namespace, references: dict[str, ModuleType]) -> dict[str, Any]:
    state = _load_state(arguments.state, references["portable"])
    _require_valid_scene(state["scene"], references["conformance"])
    target = detach_scene(
        state["scene"],
        body_name=arguments.body,
        vessel_id=arguments.vessel,
        side=arguments.side,
        new_body_name=arguments.name,
        follow_kinds=set(arguments.follow_kind),
        drop_crossing_kinds=set(arguments.drop_crossing_kind),
    )
    _require_valid_scene(target, references["conformance"])
    detached_vessels = sorted(target["bodies"][arguments.name]["vessels"])
    updated = _record_scene_change(state, target, references["fold"])
    _atomic_write_json(arguments.state, updated, references["portable"])
    return {
        "detachedBody": arguments.name,
        "root": updated["scene"]["bodies"][arguments.name]["root"],
        "vessels": detached_vessels,
        "cursor": updated["cursor"],
    }


def _command_undo(arguments: argparse.Namespace, references: dict[str, ModuleType]) -> dict[str, Any]:
    state = _load_state(arguments.state, references["portable"])
    if state["cursor"] == 0:
        raise WorkshopError("nothing-to-undo", "History cursor is already at the beginning.")
    record = state["history"][state["cursor"] - 1]
    scene = _unwrap(references["fold"].apply_scene_patch(state["scene"], record["inverse"]), "apply_scene_patch")
    updated = {"scene": scene, "history": state["history"], "cursor": state["cursor"] - 1}
    _atomic_write_json(arguments.state, updated, references["portable"])
    return {"cursor": updated["cursor"]}


def _command_redo(arguments: argparse.Namespace, references: dict[str, ModuleType]) -> dict[str, Any]:
    state = _load_state(arguments.state, references["portable"])
    if state["cursor"] == len(state["history"]):
        raise WorkshopError("nothing-to-redo", "History cursor is already at the end.")
    record = state["history"][state["cursor"]]
    scene = _unwrap(references["fold"].apply_scene_patch(state["scene"], record["patch"]), "apply_scene_patch")
    updated = {"scene": scene, "history": state["history"], "cursor": state["cursor"] + 1}
    _atomic_write_json(arguments.state, updated, references["portable"])
    return {"cursor": updated["cursor"]}


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--reference-dir",
        type=Path,
        help="paperchain/conformance/python directory (for a local sibling checkout)",
    )
    commands = parser.add_subparsers(dest="command", required=True)

    initialize = commands.add_parser("init", help="create a history state from a valid scene")
    initialize.add_argument("--state", type=Path, required=True)
    initialize.add_argument("--scene", type=Path, required=True)

    inspect = commands.add_parser("inspect", help="summarize a persisted workshop state")
    inspect.add_argument("--state", type=Path, required=True)

    validate = commands.add_parser("validate", help="validate the current scene")
    validate.add_argument("--state", type=Path, required=True)

    judge = commands.add_parser("judge", help="judge the current scene against a Papermold scene profile")
    judge.add_argument("--state", type=Path, required=True)
    judge.add_argument("--profiles", type=Path, required=True)
    judge.add_argument("--profile-id", required=True)

    detach = commands.add_parser("detach", help="cut a bridge port into a separately named scene body")
    detach.add_argument("--state", type=Path, required=True)
    detach.add_argument("--body", required=True)
    detach.add_argument("--vessel", required=True)
    detach.add_argument("--side", required=True, choices=SIDES)
    detach.add_argument("--name", required=True)
    detach.add_argument("--follow-kind", action="append", default=[])
    detach.add_argument("--drop-crossing-kind", action="append", default=[])

    undo = commands.add_parser("undo", help="apply the stored inverse before the cursor")
    undo.add_argument("--state", type=Path, required=True)
    redo = commands.add_parser("redo", help="apply the stored patch at the cursor")
    redo.add_argument("--state", type=Path, required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    arguments = _parser().parse_args(argv)
    try:
        references = load_references(arguments.reference_dir)
        if arguments.command == "inspect":
            payload, status = _command_inspect(arguments, references), 0
        else:
            if arguments.command == "init":
                payload, status = _command_init(arguments, references), 0
            elif arguments.command == "validate":
                payload, status = _command_validate(arguments, references)
            elif arguments.command == "judge":
                payload, status = _command_judge(arguments, references)
            elif arguments.command == "detach":
                payload, status = _command_detach(arguments, references), 0
            elif arguments.command == "undo":
                payload, status = _command_undo(arguments, references), 0
            else:
                payload, status = _command_redo(arguments, references), 0
    except WorkshopError as error:
        payload = {"error": error.code, "message": error.message}
        if error.details is not None:
            payload["details"] = error.details
        status = 2
    except (ValueError, KeyError, TypeError, OSError) as error:
        payload = {"error": "operation-rejected", "message": str(error)}
        status = 2

    json.dump(payload, sys.stdout, indent=2, sort_keys=True)
    sys.stdout.write("\n")
    return status


if __name__ == "__main__":
    raise SystemExit(main())
