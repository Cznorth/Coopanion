import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolDef } from 'cortico/core/types.ts';
import { Cormini } from '../vendor/cortico/bots/cormini/persona/persona.ts';
import { gitInstalled } from '../vendor/cortico/bots/cormini/persona/workspaceGit.ts';
import { AUTHOR_COO, PARTNER_FILE, SNAPSHOT_TAG, coopanionPersona } from '../core/persona.ts';

const CoopanionPersona = coopanionPersona(Cormini);
const ctx = { role: 'main', log: { emit: () => {}, warn: () => {}, error: () => {}, info: () => {}, debug: () => {} } } as never;
const git = (dir: string, ...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();

function persona() {
  const dir = mkdtempSync(join(tmpdir(), 'coo-persona-'));
  const p = new CoopanionPersona({ memoryDir: dir });
  const tool = (name: string): ToolDef => p.declareSessions()[0]!.tools().find((t) => t.name === name)!;
  return { dir, p, run: (name: string, args: Record<string, unknown>) => tool(name).handler(args, ctx) };
}

describe.skipIf(!gitInstalled())('Coo’s workspace history', () => {
  it('commits each write Coo makes, as Coo, and nothing for a write that failed', async () => {
    const { dir, run } = persona();
    await run('write_file', { path: 'notes/today.md', content: 'tea' });
    await run('edit_file', { path: 'notes/today.md', old_string: 'tea', new_string: 'coffee' });
    await run('edit_file', { path: 'notes/today.md', old_string: 'absent', new_string: 'x' });
    expect(git(dir, 'log', '--format=%an|%s').split('\n')).toEqual([
      `${AUTHOR_COO.name}|Coo edited notes/today.md`,
      `${AUTHOR_COO.name}|Coo wrote notes/today.md`,
      expect.stringContaining('checkpoint0'),
    ]);
    expect(git(dir, 'status', '--porcelain')).toBe('');
  });

  it('snapshots the workspace once per version, with blobs/ out of the repository', async () => {
    const { dir, p } = persona();
    p.snapshot('1.0.0');
    // a blob committed before blobs/ was ignored, and a change made while the app was not running
    mkdirSync(join(dir, 'blobs'));
    writeFileSync(join(dir, 'blobs', 'cat.png'), 'png');
    git(dir, 'add', '-f', 'blobs/cat.png');
    git(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'blob');
    writeFileSync(join(dir, 'hand-edit.md'), 'edited by hand');
    p.snapshot('1.0.1');
    expect(git(dir, 'tag', '--list')).toContain(SNAPSHOT_TAG('1.0.1'));
    expect(git(dir, 'ls-files')).not.toContain('blobs/cat.png');
    expect(readFileSync(join(dir, 'blobs', 'cat.png'), 'utf8')).toBe('png');
    expect(git(dir, 'show', `${SNAPSHOT_TAG('1.0.1')}:hand-edit.md`)).toBe('edited by hand');
    // the same version again commits what changed since and makes no second tag
    writeFileSync(join(dir, 'hand-edit.md'), 'again');
    p.snapshot('1.0.1');
    expect(git(dir, 'tag', '--list').split('\n').filter((t) => t === SNAPSHOT_TAG('1.0.1'))).toHaveLength(1);
    expect(git(dir, 'status', '--porcelain')).toBe('');
  });
});

describe('PARTNER.md', () => {
  it('goes into the prefix whole and cannot be deleted', async () => {
    const { p, run } = persona();
    await run('write_file', { path: PARTNER_FILE, content: 'Likes cats. Works late.' });
    const prefix = (await p.systemSegments({ now: new Date(), timezone: 'UTC', worlds: [] })).map((s) => s.text).join('\n');
    expect(prefix).toContain('Likes cats. Works late.');
    expect(String(await run('delete_file', { path: PARTNER_FILE }))).toContain('[delete failed]');
  });
});
