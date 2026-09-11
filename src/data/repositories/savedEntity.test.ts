import { createTestDatabase } from '../../../test-utils/sqljsDriver';
import { migrate } from '../db/migrate';
import { parseTags, normalizeTags, serializeTags } from './tags';
import { createHostRepository } from './hosts';
import { createNetworkRepository } from './networks';

/** Fresh migrated database plus a fixed clock, per test. */
async function setup() {
  const db = await createTestDatabase();
  const migrated = await migrate(db);
  if (!migrated.ok) throw new Error('migration failed in test setup');
  let tick = 0;
  const now = () => `2026-09-12T10:00:${String(tick++).padStart(2, '0')}.000Z`;
  return { db, now };
}

describe('tags codec', () => {
  it('normalises: trims, drops blanks, de-duplicates case-insensitively', () => {
    expect(normalizeTags([' core ', '', 'Core', 'edge', 'EDGE', '  '])).toEqual(['core', 'edge']);
    expect(normalizeTags(undefined)).toEqual([]);
  });

  it('round-trips through the stored JSON text', () => {
    expect(parseTags(serializeTags(['a', 'b']))).toEqual(['a', 'b']);
  });

  it('degrades to no tags on corrupt or unexpected values', () => {
    expect(parseTags('not json')).toEqual([]);
    expect(parseTags('{"a":1}')).toEqual([]);
    expect(parseTags('[1,2,3]')).toEqual([]);
    expect(parseTags(null)).toEqual([]);
    expect(parseTags(undefined)).toEqual([]);
    expect(parseTags('[ "ok", 5, null ]')).toEqual(['ok']);
  });
});

describe('host repository', () => {
  it('creates, reads back and lists a host', async () => {
    const { db, now } = await setup();
    const hosts = createHostRepository(db, { now });

    const created = await hosts.create({ label: 'Router', host: '192.168.1.1', tags: ['core'] });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value).toMatchObject({
      label: 'Router',
      host: '192.168.1.1',
      tags: ['core'],
      notes: '',
    });
    expect(created.value.id).toMatch(/^h_/);

    const fetched = await hosts.get(created.value.id);
    expect(fetched.ok).toBe(true);
    if (fetched.ok) expect(fetched.value).toEqual(created.value);

    const listed = await hosts.list();
    if (listed.ok) expect(listed.value).toHaveLength(1);
    expect(await hosts.count()).toEqual({ ok: true, value: 1 });

    db.close();
  });

  it('canonicalises the host and defaults a blank label to it', async () => {
    const { db, now } = await setup();
    const hosts = createHostRepository(db, { now });

    const created = await hosts.create({ label: '   ', host: 'Router.LAN.' });
    expect(created.ok).toBe(true);
    if (created.ok) {
      expect(created.value.host).toBe('router.lan');
      expect(created.value.label).toBe('router.lan');
    }
    db.close();
  });

  it('rejects an invalid host without writing a row', async () => {
    const { db, now } = await setup();
    const hosts = createHostRepository(db, { now });

    const created = await hosts.create({ label: 'Bad', host: 'not a host' });
    expect(created.ok).toBe(false);
    if (!created.ok) expect(created.error.code).toBe('INVALID_INPUT');
    expect(await hosts.count()).toEqual({ ok: true, value: 0 });
    db.close();
  });

  it('updates fields selectively and bumps updatedAt', async () => {
    const { db, now } = await setup();
    const hosts = createHostRepository(db, { now });
    const created = await hosts.create({ label: 'A', host: '10.0.0.1', tags: ['x'], notes: 'n' });
    if (!created.ok) throw new Error('create failed');

    const renamed = await hosts.update(created.value.id, { label: 'B' });
    expect(renamed.ok).toBe(true);
    if (renamed.ok) {
      expect(renamed.value.label).toBe('B');
      expect(renamed.value.host).toBe('10.0.0.1'); // untouched
      expect(renamed.value.tags).toEqual(['x']);
      expect(renamed.value.notes).toBe('n');
      expect(renamed.value.updatedAt).not.toBe(created.value.updatedAt);
    }

    const rehosted = await hosts.update(created.value.id, {
      host: '2001:DB8::1',
      tags: ['y', 'y'],
    });
    if (rehosted.ok) {
      expect(rehosted.value.host).toBe('2001:db8::1');
      expect(rehosted.value.tags).toEqual(['y']);
    }
    db.close();
  });

  it('rejects an invalid value on update and reports NOT_FOUND for a missing row', async () => {
    const { db, now } = await setup();
    const hosts = createHostRepository(db, { now });
    const created = await hosts.create({ label: 'A', host: '10.0.0.1' });
    if (!created.ok) throw new Error('create failed');

    const bad = await hosts.update(created.value.id, { host: 'still not a host' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('INVALID_INPUT');

    const missing = await hosts.update('h_missing', { label: 'x' });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.error.code).toBe('NOT_FOUND');
      expect(missing.error.retryable).toBe(false);
    }
    db.close();
  });

  it('deletes rows and reports whether anything was removed', async () => {
    const { db, now } = await setup();
    const hosts = createHostRepository(db, { now });
    const created = await hosts.create({ label: 'A', host: '10.0.0.1' });
    if (!created.ok) throw new Error('create failed');

    expect(await hosts.remove(created.value.id)).toEqual({ ok: true, value: true });
    expect(await hosts.remove(created.value.id)).toEqual({ ok: true, value: false });
    expect(await hosts.get(created.value.id)).toEqual({ ok: true, value: null });
    db.close();
  });

  it('orders by label case-insensitively', async () => {
    const { db, now } = await setup();
    const hosts = createHostRepository(db, { now });
    for (const label of ['zeta', 'Alpha', 'beta']) {
      await hosts.create({ label, host: `${label}.example` });
    }
    const listed = await hosts.list();
    if (listed.ok) expect(listed.value.map((h) => h.label)).toEqual(['Alpha', 'beta', 'zeta']);
    db.close();
  });

  it('persists across repository instances over the same database', async () => {
    const { db, now } = await setup();
    const first = createHostRepository(db, { now });
    await first.create({ label: 'Persisted', host: '172.16.0.1' });

    // A new repository instance (as after a screen remount) sees the row.
    const second = createHostRepository(db, { now });
    const listed = await second.list();
    if (listed.ok) {
      expect(listed.value).toHaveLength(1);
      expect(listed.value[0].label).toBe('Persisted');
    }
    db.close();
  });

  it('stores no rows when the table is empty', async () => {
    const { db } = await setup();
    const hosts = createHostRepository(db);
    expect(await hosts.list()).toEqual({ ok: true, value: [] });
    expect(await hosts.count()).toEqual({ ok: true, value: 0 });
    db.close();
  });
});

describe('network repository', () => {
  it('validates and stores CIDRs', async () => {
    const { db, now } = await setup();
    const networks = createNetworkRepository(db, { now });

    const created = await networks.create({
      label: 'Office',
      cidr: '192.168.1.0/24',
      tags: ['site'],
      notes: 'floor 2',
    });
    expect(created.ok).toBe(true);
    if (created.ok) {
      expect(created.value.cidr).toBe('192.168.1.0/24');
      expect(created.value.id).toMatch(/^n_/);
      expect(created.value.tags).toEqual(['site']);
    }
    db.close();
  });

  it('accepts the netmask form and canonicalises it', async () => {
    const { db, now } = await setup();
    const networks = createNetworkRepository(db, { now });
    const created = await networks.create({ label: 'A', cidr: '10.0.0.0 255.255.255.0' });
    expect(created.ok).toBe(true);
    if (created.ok) expect(created.value.cidr).toBe('10.0.0.0/24');
    db.close();
  });

  it('rejects invalid CIDRs', async () => {
    const { db, now } = await setup();
    const networks = createNetworkRepository(db, { now });
    for (const bad of ['192.168.1.0/33', 'nonsense', '10.0.0.0 255.0.255.0', '']) {
      const created = await networks.create({ label: 'Bad', cidr: bad });
      expect(created.ok).toBe(false);
      if (!created.ok) expect(created.error.code).toBe('INVALID_INPUT');
    }
    expect(await networks.count()).toEqual({ ok: true, value: 0 });
    db.close();
  });

  it('updates and deletes independently of hosts', async () => {
    const { db, now } = await setup();
    const hosts = createHostRepository(db, { now });
    const networks = createNetworkRepository(db, { now });

    const host = await hosts.create({ label: 'H', host: '10.0.0.1' });
    const net = await networks.create({ label: 'N', cidr: '10.0.0.0/24' });
    if (!host.ok || !net.ok) throw new Error('setup failed');

    const updated = await networks.update(net.value.id, { cidr: '10.0.1.0/24' });
    expect(updated.ok).toBe(true);
    if (updated.ok) expect(updated.value.cidr).toBe('10.0.1.0/24');

    expect(await networks.remove(net.value.id)).toEqual({ ok: true, value: true });
    // the host row is untouched
    expect(await hosts.count()).toEqual({ ok: true, value: 1 });
    expect(await networks.count()).toEqual({ ok: true, value: 0 });
    db.close();
  });
});
