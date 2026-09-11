/**
 * Fault injection: every repository must surface a broken database as a
 * `STORAGE_ERROR` Result rather than throwing.
 *
 * Dropping the tables out from under the repositories is the cheapest way to
 * exercise the error-mapping paths that a healthy database never reaches — and
 * those paths are exactly what a user sees when storage is unavailable.
 */

import { createMemorySettingsStore } from '../../../test-utils/memorySettingsStore';
import { createTestDatabase } from '../../../test-utils/sqljsDriver';
import type { Result } from '../../core/result/result';
import { migrate } from '../db/migrate';
import { createHostRepository } from './hosts';
import { createNetworkRepository } from './networks';
import { createPortRepository } from './ports';
import { createRunRepository } from './runs';

async function setupBroken() {
  const db = await createTestDatabase();
  const migrated = await migrate(db);
  if (!migrated.ok) throw new Error('migration failed in test setup');
  await db.exec('DROP TABLE hosts; DROP TABLE networks; DROP TABLE runs; DROP TABLE ports;');
  const settings = createMemorySettingsStore();
  const now = () => '2026-09-12T10:00:00.000Z';

  return {
    db,
    settings,
    hosts: createHostRepository(db, { now }),
    networks: createNetworkRepository(db, { now }),
    ports: createPortRepository(db, settings),
    runs: createRunRepository(db, { newId: () => 'r_1' }),
  };
}

function expectStorageError(result: Result<unknown>): void {
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe('STORAGE_ERROR');
    expect(result.error.message).toContain('device');
    expect(result.error.technical).toBeTruthy();
  }
}

describe('repositories map storage failures to STORAGE_ERROR', () => {
  it('hosts', async () => {
    const { db, hosts } = await setupBroken();
    expectStorageError(hosts.list());
    expectStorageError(hosts.get('h_1'));
    expectStorageError(hosts.create({ label: 'A', host: '10.0.0.1' }));
    expectStorageError(hosts.update('h_1', { label: 'B' }));
    expectStorageError(hosts.remove('h_1'));
    expectStorageError(hosts.count());
    db.close();
  });

  it('networks', async () => {
    const { db, networks } = await setupBroken();
    expectStorageError(networks.list());
    expectStorageError(networks.get('n_1'));
    expectStorageError(networks.create({ label: 'A', cidr: '10.0.0.0/24' }));
    expectStorageError(networks.update('n_1', { label: 'B' }));
    expectStorageError(networks.remove('n_1'));
    expectStorageError(networks.count());
    db.close();
  });

  it('runs', async () => {
    const { db, runs } = await setupBroken();
    expectStorageError(
      runs.record({
        toolId: 'subnet-calculator',
        status: 'success',
        input: null,
        summary: 'x',
        detail: null,
        startedAt: '2026-09-12T10:00:00.000Z',
        finishedAt: null,
        durationMs: null,
      }),
    );
    expectStorageError(runs.list());
    expectStorageError(runs.get('r_1'));
    expectStorageError(runs.remove('r_1'));
    expectStorageError(runs.clear());
    expectStorageError(runs.count());
    expectStorageError(runs.prune(10));
    db.close();
  });

  it('ports', async () => {
    const { db, ports } = await setupBroken();
    expectStorageError(ports.ensureSeeded());
    expectStorageError(ports.search('ssh'));
    expectStorageError(ports.count());
    db.close();
  });

  it('still validates input before touching storage', async () => {
    const { db, hosts, networks, runs } = await setupBroken();
    // These fail on validation, so the broken table is never reached and the
    // error code stays INVALID_INPUT rather than STORAGE_ERROR.
    const badHost = await hosts.create({ label: 'A', host: 'not a host' });
    expect(badHost.ok).toBe(false);
    if (!badHost.ok) expect(badHost.error.code).toBe('INVALID_INPUT');

    const badNetwork = await networks.create({ label: 'A', cidr: 'nonsense' });
    expect(badNetwork.ok).toBe(false);
    if (!badNetwork.ok) expect(badNetwork.error.code).toBe('INVALID_INPUT');

    const badPrune = await runs.prune(-1);
    expect(badPrune.ok).toBe(false);
    if (!badPrune.ok) expect(badPrune.error.code).toBe('INVALID_INPUT');
    db.close();
  });
});
