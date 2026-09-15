/**
 * One mDNS service-type list, three files, no drift (ADR-010).
 *
 * The same set of Bonjour service types has to appear in
 *   1. `app.json` → `ios.infoPlist.NSBonjourServices` (iOS refuses to browse a
 *      type that is not declared),
 *   2. the Kotlin browse list (`NetopsModule.MDNS_SERVICE_TYPES`), and
 *   3. the Swift browse list.
 *
 * Nothing at runtime connects these three, and a missing entry fails in the
 * quietest possible way — that service type is simply never discovered. So the
 * literals are compared here instead of trusted.
 *
 * The extraction is deliberately dumb (`"_x._tcp"` / `"_x._udp"` string
 * literals in each file): the files contain no other literals of that shape, and
 * a dumb rule is one nobody has to debug.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', '..');
const TYPE_LITERAL = /"(_[a-z0-9-]+\._(?:tcp|udp))"/g;

function typesIn(relativePath: string): string[] {
  const text = readFileSync(join(root, relativePath), 'utf8');
  return [...text.matchAll(TYPE_LITERAL)].map((match) => match[1]).sort();
}

const sources: readonly { label: string; path: string }[] = [
  {
    label: 'Kotlin (MDNS_SERVICE_TYPES)',
    path: 'modules/netops/android/src/main/java/netops/modules/netops/NetopsModule.kt',
  },
  // The Swift browse list joins this guard as soon as it exists (M8, #50), so
  // the three-way agreement is enforced from the moment there are three lists.
];

describe('mDNS service types', () => {
  const declared: string[] = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')).expo.ios
    .infoPlist.NSBonjourServices;

  it('are declared in app.json at all', () => {
    expect(declared.length).toBeGreaterThan(0);
    expect(declared.every((type) => type.startsWith('_') && type.includes('._'))).toBe(true);
  });

  it.each(sources)('match the $label list exactly', ({ label, path }) => {
    const actual = typesIn(path);
    expect({ list: label, types: actual }).toEqual({ list: label, types: [...declared].sort() });
  });
});
