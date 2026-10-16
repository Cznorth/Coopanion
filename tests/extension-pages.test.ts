/**
 * The pet menu's extension pages (core/extension-pages.ts) against a real Cortico bot's GET /api/worlds:
 * which Worlds' links it lists. A Cortico change to the fields it reads (status, declared, label, links)
 * fails here at the submodule bump.
 */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createBot, type Bot, type BotDefinition } from 'cortico/bot.ts';
import type { CoreConfig, WorldWebUiDecl } from 'cortico/core/types.ts';
import { loadDeployment } from 'cortico/deploy.ts';
import { withWorlds, type WorldDefinition } from 'cortico/world.ts';
import { CONSOLE } from 'cortico/worlds/console/definition.ts';
import { extensionPages } from '../core/extension-pages.ts';

const CORTICO = resolve(import.meta.dirname, '../vendor/cortico');

/** A World that declares `links` on its WebUI page. */
function linked(id: string, label: string, links: WorldWebUiDecl['links']): WorldDefinition {
  return {
    id,
    label,
    defaults: () => ({ enabled: false }),
    create: () => ({ id, envPromptVars: () => ({}), tools: () => [], start: async () => {}, stop: async () => {}, webUi: () => ({ links }) }),
  };
}

/** Declared by the bot, as the pet and the notice World are in Coopanion. */
const OWN = linked('own', 'Own', [{ label: 'Own page', href: 'http://127.0.0.1:9001/' }]);
const NOTES = linked('notes', 'Notes', [{ label: 'All notes', href: 'http://127.0.0.1:9002/' }, { label: '', href: '' }, { label: '', href: '/notes' }]);
const IDLE = linked('idle', 'Idle', [{ label: 'Idle page', href: 'http://127.0.0.1:9003/' }]);
const PLAIN = linked('plain', 'Plain', []);

let dir: string;
let bot: Bot<CoreConfig>;
let base: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'coo-extension-pages-'));
  // Idle stays off
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ worlds: { [OWN.id]: { enabled: true }, [NOTES.id]: { enabled: true }, [PLAIN.id]: { enabled: true } } }));
  const cormini = (await import(join(CORTICO, 'bots', 'cormini', 'index.ts'))).default as BotDefinition<CoreConfig>;
  const definition = withWorlds({ ...cormini, declares: [CONSOLE.id, OWN.id] }, [CONSOLE, OWN, NOTES, IDLE, PLAIN] as WorldDefinition[]);
  const loaded = loadDeployment(definition, dir, CORTICO);
  loaded.config.web.port = 0;
  bot = createBot(loaded, definition);
  bot.core.bus.setPaused(true);
  base = `http://127.0.0.1:${(await bot.start()).port}`;
}, 30000);

afterAll(async () => {
  await bot?.stop();
  rmSync(dir, { recursive: true, force: true });
});

it('lists the links of mounted Worlds the bot does not declare, by World, without links that have no address', async () => {
  expect(await extensionPages(base, 'en')).toEqual([
    { label: 'Notes', links: [{ label: 'All notes', href: 'http://127.0.0.1:9002/' }, { label: '/notes', href: '/notes' }] },
  ]);
});
