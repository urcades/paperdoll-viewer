from __future__ import annotations

import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


HERE = Path(__file__).resolve().parent
CLI = HERE / "workshop.py"
SCENE_FIXTURE = HERE / "fixtures" / "demo-scene.json"
PROFILE_FIXTURE = HERE / "fixtures" / "serviceability-profiles.json"


def run_cli(*args: str, expected: int = 0) -> dict:
    completed = subprocess.run(
        [
            sys.executable,
            str(CLI),
            *args,
        ],
        cwd=HERE,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if completed.returncode != expected:
        raise AssertionError(
            f"expected exit {expected}, got {completed.returncode}\n"
            f"stdout:\n{completed.stdout}\nstderr:\n{completed.stderr}"
        )
    return json.loads(completed.stdout)


class AssemblyWorkshopWorkflowTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.state = Path(self.temp_dir.name) / "workshop.json"
        run_cli(
            "init",
            "--state",
            str(self.state),
            "--scene",
            str(SCENE_FIXTURE),
        )

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def detach(self, *, expected: int = 0, name: str = "arm-unit", policies: bool = True) -> dict:
        args = [
            "detach",
            "--state",
            str(self.state),
            "--body",
            "robot",
            "--vessel",
            "torso",
            "--side",
            "right",
            "--name",
            name,
        ]
        if policies:
            args += [
                "--follow-kind",
                "telemetry",
                "--drop-crossing-kind",
                "mounted",
            ]
        return run_cli(*args, expected=expected)

    def test_connected_arm_and_nested_tool_stay_together_through_undo_redo(self) -> None:
        before = json.loads(self.state.read_text())

        result = self.detach()

        self.assertEqual(result["detachedBody"], "arm-unit")
        self.assertEqual(result["vessels"], ["forearm", "tool-mount", "upper-arm"])
        stored = json.loads(self.state.read_text())
        scene = stored["scene"]
        self.assertEqual(scene["bodies"]["robot"]["root"], "torso")
        self.assertEqual(
            set(scene["bodies"]["robot"]["vessels"]),
            {"torso", "upper-arm-two"},
        )
        arm = scene["bodies"]["arm-unit"]
        self.assertEqual(arm["root"], "upper-arm")
        self.assertEqual(arm["vessels"]["upper-arm"]["ports"]["right"], {"vessel": "forearm", "side": "left"})
        self.assertEqual(arm["vessels"]["forearm"]["ports"]["right"], {"vessel": "tool-mount", "side": "left"})
        self.assertEqual(arm["vessels"]["tool-mount"]["contains"][0]["id"], "welder")
        self.assertNotIn("left", arm["vessels"]["upper-arm"].get("ports", {}))

        relations = scene["relations"]
        self.assertNotIn("mounted", {relation["kind"] for relation in relations})
        self.assertIn(
            {
                "kind": "telemetry",
                "from": "arm-unit/upper-arm/actuator/core",
                "to": "station/console",
            },
            relations,
        )
        self.assertIn(
            {"kind": "located-at", "from": "robot/torso", "to": "bay/pad"},
            relations,
        )
        self.assertIn(
            {"kind": "telemetry", "from": "robot-two/torso", "to": "station/console"},
            relations,
        )
        self.assertIn(
            {"kind": "telemetry", "from": "robot/upper-arm-two", "to": "station/console"},
            relations,
        )
        self.assertEqual(stored["cursor"], 1)
        self.assertEqual(len(stored["history"]), 1)
        self.assertEqual(set(stored["history"][0]), {"patch", "inverse"})
        self.assertEqual(stored["history"][0]["patch"]["protocol"], "paperfold/v2")
        self.assertEqual(stored["history"][0]["inverse"]["protocol"], "paperfold/v2")

        self.assertTrue(run_cli("validate", "--state", str(self.state))["valid"])
        judgment = run_cli(
            "judge",
            "--state",
            str(self.state),
            "--profiles",
            str(PROFILE_FIXTURE),
            "--profile-id",
            "serviceable",
        )
        self.assertTrue(judgment["conforms"])

        run_cli("undo", "--state", str(self.state))
        undone = json.loads(self.state.read_text())
        self.assertEqual(undone["scene"], before["scene"])
        self.assertEqual(undone["cursor"], 0)

        # A new process reopens the persisted history and redoes the same patch.
        run_cli("redo", "--state", str(self.state))
        redone = json.loads(self.state.read_text())
        self.assertEqual(redone["scene"], scene)
        self.assertEqual(redone["cursor"], 1)
        self.assertEqual({path.name for path in self.state.parent.iterdir()}, {self.state.name})

    def test_unhandled_dangling_relation_rejects_without_touching_state(self) -> None:
        before = self.state.read_bytes()
        error = self.detach(expected=2, policies=False)
        self.assertEqual(error["error"], "unhandled-dangling-relations")
        self.assertEqual(self.state.read_bytes(), before)

    def test_body_name_collision_rejects_without_touching_state(self) -> None:
        before = self.state.read_bytes()
        error = self.detach(expected=2, name="station")
        self.assertEqual(error["error"], "body-name-collision")
        self.assertEqual(self.state.read_bytes(), before)

    def test_detach_scene_is_pure_data_transformation(self) -> None:
        sys.path.insert(0, str(HERE))
        try:
            import workshop
        finally:
            sys.path.pop(0)

        scene = json.loads(SCENE_FIXTURE.read_text())
        untouched = copy.deepcopy(scene)
        detached = workshop.detach_scene(
            scene,
            body_name="robot",
            vessel_id="torso",
            side="right",
            new_body_name="arm-unit",
            follow_kinds={"telemetry"},
            drop_crossing_kinds={"mounted"},
        )

        self.assertEqual(scene, untouched)
        self.assertIn("arm-unit", detached["bodies"])
        self.assertNotIn("arm-unit", scene["bodies"])

    def test_inspect_reports_persisted_history_without_mutation(self) -> None:
        before = self.state.read_bytes()
        summary = run_cli("inspect", "--state", str(self.state))
        self.assertEqual(summary["bodies"], ["bay", "robot", "robot-two", "station"])
        self.assertEqual(summary["historyLength"], 0)
        self.assertEqual(summary["cursor"], 0)
        self.assertEqual(self.state.read_bytes(), before)

    def test_initial_scene_is_valid_but_not_yet_serviceable(self) -> None:
        self.assertTrue(run_cli("validate", "--state", str(self.state))["valid"])
        judgment = run_cli(
            "judge",
            "--state",
            str(self.state),
            "--profiles",
            str(PROFILE_FIXTURE),
            "--profile-id",
            "serviceable",
            expected=1,
        )
        self.assertFalse(judgment["conforms"])
        self.assertTrue(judgment["errors"])

    def test_portable_json_rejects_unsafe_nested_data_and_profile_thresholds(self) -> None:
        unsafe_scene = json.loads(SCENE_FIXTURE.read_text())
        unsafe_scene["bodies"]["robot"]["vessels"]["tool-mount"]["contains"][0]["data"][
            "power"
        ] = 9_007_199_254_740_993
        unsafe_scene_path = Path(self.temp_dir.name) / "unsafe-scene.json"
        unsafe_scene_path.write_text(json.dumps(unsafe_scene))
        rejected_state = Path(self.temp_dir.name) / "rejected.json"

        scene_error = run_cli(
            "init",
            "--state",
            str(rejected_state),
            "--scene",
            str(unsafe_scene_path),
            expected=2,
        )
        self.assertEqual(scene_error["error"], "non-portable-json")
        self.assertFalse(rejected_state.exists())

        unsafe_profiles = json.loads(PROFILE_FIXTURE.read_text())
        unsafe_profiles["sceneProfiles"]["serviceable"]["relations"][0][
            "atLeast"
        ] = 9_007_199_254_740_993
        unsafe_profiles_path = Path(self.temp_dir.name) / "unsafe-profiles.json"
        unsafe_profiles_path.write_text(json.dumps(unsafe_profiles))
        before = self.state.read_bytes()

        profile_error = run_cli(
            "judge",
            "--state",
            str(self.state),
            "--profiles",
            str(unsafe_profiles_path),
            "--profile-id",
            "serviceable",
            expected=2,
        )
        self.assertEqual(profile_error["error"], "non-portable-json")
        self.assertEqual(self.state.read_bytes(), before)

    def test_portable_json_rejects_duplicate_object_names(self) -> None:
        duplicate_scene = Path(self.temp_dir.name) / "duplicate-scene.json"
        duplicate_scene.write_text(
            '{"protocol":"paperchain/v1","protocol":"paperchain/v1",'
            '"bodies":{},"kinds":{},"relations":[]}'
        )
        rejected_state = Path(self.temp_dir.name) / "duplicate-state.json"

        error = run_cli(
            "init",
            "--state",
            str(rejected_state),
            "--scene",
            str(duplicate_scene),
            expected=2,
        )
        self.assertEqual(error["error"], "non-portable-json")
        self.assertFalse(rejected_state.exists())

    def test_init_canonicalizes_noncanonical_scene_for_exact_undo(self) -> None:
        raw_scene = json.loads(SCENE_FIXTURE.read_text())
        raw_scene["bodies"]["station"]["vessels"]["console"]["ports"] = {}
        raw_scene["bodies"]["robot"]["vessels"]["torso"]["contains"] = []
        raw_scene["relations"].reverse()
        scene_path = Path(self.temp_dir.name) / "noncanonical-scene.json"
        scene_path.write_text(json.dumps(raw_scene))
        state_path = Path(self.temp_dir.name) / "canonical-state.json"
        run_cli("init", "--state", str(state_path), "--scene", str(scene_path))
        initialized = json.loads(state_path.read_text())

        self.assertNotIn(
            "ports",
            initialized["scene"]["bodies"]["station"]["vessels"]["console"],
        )
        self.assertNotIn(
            "contains",
            initialized["scene"]["bodies"]["robot"]["vessels"]["torso"],
        )
        relation_keys = [
            (relation["kind"], relation["from"], relation["to"])
            for relation in initialized["scene"]["relations"]
        ]
        self.assertEqual(relation_keys, sorted(relation_keys))

        run_cli(
            "detach",
            "--state",
            str(state_path),
            "--body",
            "robot",
            "--vessel",
            "torso",
            "--side",
            "right",
            "--name",
            "arm-unit",
            "--follow-kind",
            "telemetry",
            "--drop-crossing-kind",
            "mounted",
        )
        run_cli("undo", "--state", str(state_path))
        undone = json.loads(state_path.read_text())
        self.assertEqual(undone["scene"], initialized["scene"])
        self.assertEqual(undone["cursor"], 0)

    def test_atomic_writer_rejects_nonportable_output(self) -> None:
        sys.path.insert(0, str(HERE))
        try:
            import workshop
        finally:
            sys.path.pop(0)
        portable = workshop.load_references(None)["portable"]
        output = Path(self.temp_dir.name) / "unsafe-output.json"

        with self.assertRaises(workshop.WorkshopError) as raised:
            workshop._atomic_write_json(
                output,
                {"unsafe": 9_007_199_254_740_993},
                portable,
            )

        self.assertEqual(raised.exception.code, "non-portable-json")
        self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
