import { createMemorySettingsStore } from '../../../test-utils/memorySettingsStore';
import { createTestDatabase } from '../../../test-utils/sqljsDriver';
import { PORTS, datasetFingerprint, type PortEntry } from '../../core/ports/ports';
import { migrate } from '../db/migrate';
import { DATA_KEYS } from '../settings/store';
import { createPortRepository } from './ports';

const TINY: readonly PortEntry[] = [
  { port: 22, proto: 'tcp', service: 'ssh', description: 'Secure Shell' },
  { port: 53, proto: 'udp', service: 'domain', description: 'DNS name resolution' },
  { port: 443, proto: 'tcp', service: 'https', description: 'HTTP over TLS' },
];

async function setup() {
  const db = await createTestDatabase();
  const migrated = await migrate(db);
  if (!migrated.ok) throw new Error('migration failed in test setup');
  return { db, meta: createMemorySettingsStore() };
}

describe('datasetFingerprint', () => {
  it('is stable for the same content', () => {
    expect(datasetFingerprint(TINY)).toBe(datasetFingerprint([...TINY]));
    expect(datasetFingerprint(PORTS)).toMatch(/^[0-9a-f]{8}$/);
  });

  it('changes when any field changes', () => {
    const base = datasetFingerprint(TINY);
    expect(datasetFingerprint([{ ...TINY[0], service: 'ssh2' }, TINY[1], TINY[2]])).not.toBe(base);
    expect(datasetFingerprint([{ ...TINY[0], port: 2222 }, TINY[1], TINY[2]])).not.toBe(base);
    expect(datasetFingerprint([{ ...TINY[0], proto: 'udp' }, TINY[1], TINY[2]])).not.toBe(base);
    expect(datasetFingerprint([{ ...TINY[0], description: 'x' }, TINY[1], TINY[2]])).not.toBe(base);
  });

  it('changes when a row is added or removed', () => {
    expect(datasetFingerprint(TINY.slice(1))).not.toBe(datasetFingerprint(TINY));
  });
});

describe('port repository — seeding', () => {
  it('seeds an empty table and records the fingerprint', async () => {
    const { db, meta } = await setup();
    const ports = createPortRepository(db, meta);

    const result = await ports.ensureSeeded(TINY);
    expect(result).toEqual({
      ok: true,
      value: { seeded: true, count: 3, fingerprint: datasetFingerprint(TINY) },
    });
    expect(await ports.count()).toEqual({ ok: true, value: 3 });
    expect(meta.get(DATA_KEYS.portsFingerprint)).toBe(datasetFingerprint(TINY));
    db.close();
  });

  it('is a no-op when the dataset is unchanged', async () => {
    const { db, meta } = await setup();
    const ports = createPortRepository(db, meta);

    await ports.ensureSeeded(TINY);
    const second = await ports.ensureSeeded(TINY);
    expect(second).toEqual({
      ok: true,
      value: { seeded: false, count: 3, fingerprint: datasetFingerprint(TINY) },
    });
    db.close();
  });

  it('rewrites the table when the dataset changes', async () => {
    const { db, meta } = await setup();
    const ports = createPortRepository(db, meta);
    await ports.ensureSeeded(TINY);

    const updated = [
      ...TINY,
      { port: 8080, proto: 'tcp' as const, service: 'http-alt', description: 'Alt HTTP' },
    ];
    const result = await ports.ensureSeeded(updated);
    expect(result.ok && result.value.seeded).toBe(true);
    expect(await ports.count()).toEqual({ ok: true, value: 4 });

    // and a shrinking dataset removes rows rather than leaving strays
    await ports.ensureSeeded(TINY);
    expect(await ports.count()).toEqual({ ok: true, value: 3 });
    const removed = await ports.search('http-alt');
    expect(removed).toEqual({ ok: true, value: [] });
    db.close();
  });

  it('seeds without a settings store by comparing row counts', async () => {
    const { db } = await setup();
    const ports = createPortRepository(db);

    expect((await ports.ensureSeeded(TINY)).ok).toBe(true);
    const second = await ports.ensureSeeded(TINY);
    expect(second.ok && second.value.seeded).toBe(false);
    db.close();
  });

  it('seeds the real dataset', async () => {
    const { db, meta } = await setup();
    const ports = createPortRepository(db, meta);
    const result = await ports.ensureSeeded();
    expect(result.ok && result.value.count).toBe(PORTS.length);
    expect(await ports.count()).toEqual({ ok: true, value: PORTS.length });
    db.close();
  });
});

describe('port repository — search', () => {
  it('reads from the database and ranks like core/ports', async () => {
    const { db, meta } = await setup();
    const ports = createPortRepository(db, meta);
    await ports.ensureSeeded(TINY);

    const byPort = await ports.search('443');
    expect(byPort.ok && byPort.value[0]).toMatchObject({ port: 443, proto: 'tcp' });

    const byService = await ports.search('ssh');
    expect(byService.ok && byService.value[0].port).toBe(22);

    const byDescription = await ports.search('dns');
    expect(byDescription.ok && byDescription.value.map((e) => e.port)).toContain(53);

    const byProto = await ports.search('', 'udp');
    expect(byProto.ok && byProto.value).toEqual([
      { port: 53, proto: 'udp', service: 'domain', description: 'DNS name resolution' },
    ]);

    const none = await ports.search('zzz');
    expect(none).toEqual({ ok: true, value: [] });
    db.close();
  });

  it('serves repeated searches from the cached rows', async () => {
    const { db, meta } = await setup();
    const ports = createPortRepository(db, meta);
    await ports.ensureSeeded(TINY);

    await ports.search('ssh');
    // Corrupt the table behind the repository's back: the cache still answers,
    // proving the second search did not hit the database.
    await db.exec('DELETE FROM ports');
    const cached = await ports.search('ssh');
    expect(cached.ok && cached.value).toHaveLength(1);
    db.close();
  });
});
