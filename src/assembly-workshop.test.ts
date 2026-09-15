import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { validateScene, type Scene } from 'paperchain';
import { applyScenePatch, canonicalizeScene, type ScenePatchDocument } from 'paperfold';
import { judgeScene, type PapermoldSceneDocument } from 'papermold';

it('interchanges the Python workshop transaction and history with TypeScript', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'paper-workshop-'));
  const statePath = resolve(directory, 'state.json');
  const example = resolve('examples/assembly-workshop');
  const original = JSON.parse(readFileSync(resolve(example, 'fixtures/demo-scene.json'), 'utf8')) as Scene;
  const profiles = JSON.parse(readFileSync(resolve(example, 'fixtures/serviceability-profiles.json'), 'utf8')) as PapermoldSceneDocument;
  const run = (...args: string[]) => {
    const result = spawnSync('python3', [resolve(example, 'workshop.py'), ...args, '--state', statePath], { encoding: 'utf8' });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
  };
  const read = () => JSON.parse(readFileSync(statePath, 'utf8')) as {
    scene: Scene; history: { patch: ScenePatchDocument; inverse: ScenePatchDocument }[]; cursor: number;
  };
  try {
    run('init', '--scene', resolve(example, 'fixtures/demo-scene.json'));
    expect(judgeScene(original, profiles, 'serviceable').length).toBeGreaterThan(0);
    run('detach', '--body', 'robot', '--vessel', 'torso', '--side', 'right', '--name', 'arm-unit',
      '--follow-kind', 'telemetry', '--drop-crossing-kind', 'mounted');
    const detached = read();
    expect(validateScene(detached.scene)).toEqual([]);
    expect(judgeScene(detached.scene, profiles, 'serviceable')).toEqual([]);
    expect(detached.cursor).toBe(1);
    expect(detached.history).toHaveLength(1);
    // Python chooses the transaction. TypeScript must apply that exact patch,
    // including destruction records and relation rewrites, without translating it.
    expect(applyScenePatch(original, detached.history[0]!.patch)).toEqual({ ok: true, value: canonicalizeScene(detached.scene) });
    expect(applyScenePatch(detached.scene, detached.history[0]!.inverse)).toEqual({ ok: true, value: canonicalizeScene(original) });
    run('undo');
    expect(read().scene).toEqual(canonicalizeScene(original));
    run('redo');
    expect(read()).toEqual(detached);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
