/**
 * The pet menu's extension pages: the links that mounted Worlds declare in `webUi()`, read from
 * `GET /api/worlds` as the settings window reads them, one group per World under its display name.
 * Worlds the bot declares (console, desktop-pet, coopanion) are left out; the settings window and the
 * menu's own entries already open their pages.
 */
import type { Language } from 'cortico/core/language.ts';
import type { WebUiWorldInfo } from 'cortico/web/server.ts';
import type { PetPageGroup } from 'cortico-world-desktop-pet';

/** `origin` is the console's, `http://127.0.0.1:<port>`; labels come in `language`. */
export async function extensionPages(origin: string, language: Language): Promise<PetPageGroup[]> {
  const res = await fetch(`${origin}/api/worlds`, { headers: { 'x-cortico-language': language } });
  if (!res.ok) throw new Error(`GET /api/worlds: HTTP ${res.status}`);
  const { worlds } = await res.json() as { worlds: WebUiWorldInfo[] };
  return worlds.flatMap((w) => {
    if (w.status !== 'active' || w.declared) return [];
    const links = (w.links ?? []).filter((l) => l.href).map((l) => ({ label: l.label || l.href, href: l.href }));
    return links.length ? [{ label: w.label || w.id, links }] : [];
  });
}
