# Assembly workshop

A small, headless second consumer of the Paper family specifications. It cuts
a bridge in a Paperdoll body, keeps the whole separated component intact as a
new Paperchain body, records the scene transaction with Paperfold, and judges
the result with a Papermold serviceability profile. This is another reference
consumer in the family workspace, not evidence of independent external
adoption.

The CLI is Python standard-library only. From a normal paperdoll-viewer
checkout, install the repository dependencies first; the workshop discovers
the reference modules in the installed Paperchain package.

```sh
pnpm install
cd examples/assembly-workshop
STATE=/tmp/assembly-workshop.json

python3 workshop.py init \
  --state "$STATE" --scene fixtures/demo-scene.json
python3 workshop.py inspect --state "$STATE"
python3 workshop.py validate --state "$STATE"
python3 workshop.py judge \
  --state "$STATE" --profiles fixtures/serviceability-profiles.json \
  --profile-id serviceable

python3 workshop.py detach \
  --state "$STATE" --body robot --vessel torso --side right --name arm-unit \
  --follow-kind telemetry --drop-crossing-kind mounted
python3 workshop.py judge \
  --state "$STATE" --profiles fixtures/serviceability-profiles.json \
  --profile-id serviceable
python3 workshop.py undo --state "$STATE"
python3 workshop.py redo --state "$STATE"
```

For local Paperchain development before installing a package, add
`--reference-dir /path/to/paperchain/conformance/python` before the command.

`judge` exits 1 for a valid, nonconforming scene; in the demo it fails before
the detach and succeeds afterward. Operational rejection exits 2 and prints a
JSON error.

All scene, profile, and state reads use Paperchain's portable JSON loader.
Duplicate object names, non-finite numbers, and integral binary64 results
outside `±(2^53−1)` are rejected before the family validators run, including
numbers nested in opaque `data`. `init` stores the scene in Paperfold canonical
form, establishing the exact state that undo restores. Writes are normalized
through the same portable profile and serialize with non-finite numbers
disabled.

## Detach policy

The selected port must be a bridge in the source body's root component. The
side containing the old root stays in the source body. The other connected
component becomes the new body, rooted at the vessel adjacent to the cut;
all reciprocal ports within that component and all nested bodies/data remain
unchanged.

Relations are handled by an explicit consumer policy:

- `--follow-kind K` rewrites endpoints of kind `K` whose body and top-level
  vessel exactly belong to the detached component. Nested address suffixes
  are retained.
- `--drop-crossing-kind K` removes kind `K` only when exactly one endpoint is
  in the detached component. This takes precedence when a kind appears in
  both lists.
- Every other relation stays unchanged. If it would consequently dangle, the
  detach is rejected atomically. There is no universal relation-following
  behavior.

State is always written to the required `--state` path via atomic replacement:

```json
{
  "scene": {},
  "history": [{ "patch": {}, "inverse": {} }],
  "cursor": 1
}
```

Undo applies the inverse before the cursor; redo applies the patch at the
cursor. A new detach after undo discards only the redo tail.

Run the end-to-end tests with:

```sh
python3 -m unittest -v test_workshop.py
```
