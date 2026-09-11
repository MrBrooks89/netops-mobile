import { createTestDatabase } from '../../../test-utils/sqljsDriver';
import type { RunRecordInput } from '../../core/model/entities';
import { migrate } from '../db/migrate';
import { createRunRepository } from './runs';

async function setup() {
  const db = await createTestDatabase();
  const migrated = await migrate(db);
  if (!migrated.ok) throw new Error('migration failed in test setup');
  let n = 0;
  const runs = createRunRepository(db, { newId: () => `r_${String(++n).padStart(3, '0')}` });
  return { db, runs };
}

const run = (overrides: Partial<RunRecordInput> = {}): RunRecordInput => ({
  toolId: 'subnet-calculator',
  status: 'success',
  input: { cidr: '192.168.1.10/24' },
  summary: '192.168.1.0/24',
  detail: { networkAddress: '192.168.1.0' },
  startedAt: '2026-09-12T10:00:00.000Z',
  finishedAt: '2026-09-12T10:00:00.003Z',
  durationMs: 3,
  ...overrides,
});

describe('run repository', () => {
  it('records a run and reads it back with JSON payloads intact', async () => {
    const { db, runs } = await setup();

    const recorded = await runs.record(run());
    expect(recorded.ok).toBe(true);
    if (!recorded.ok) return;
    expect(recorded.value.id).toBe('r_001');

    const fetched = await runs.get('r_001');
    expect(fetched.ok).toBe(true);
    if (fetched.ok && fetched.value) {
      expect(fetched.value).toMatchObject({
        toolId: 'subnet-calculator',
        status: 'success',
        summary: '192.168.1.0/24',
        durationMs: 3,
      });
      expect(fetched.value.input).toEqual({ cidr: '192.168.1.10/24' });
      expect(fetched.value.detail).toEqual({ networkAddress: '192.168.1.0' });
    }
    db.close();
  });

  it('stores errors with their code and message', async () => {
    const { db, runs } = await setup();
    await runs.record(
      run({
        status: 'error',
        detail: null,
        errorCode: 'INVALID_INPUT',
        errorMessage: 'Invalid CIDR',
        finishedAt: null,
        durationMs: null,
      }),
    );
    const fetched = await runs.get('r_001');
    if (fetched.ok && fetched.value) {
      expect(fetched.value.status).toBe('error');
      expect(fetched.value.errorCode).toBe('INVALID_INPUT');
      expect(fetched.value.errorMessage).toBe('Invalid CIDR');
      expect(fetched.value.detail).toBeNull();
      expect(fetched.value.durationMs).toBeNull();
    }
    db.close();
  });

  it('lists newest first and filters by tool', async () => {
    const { db, runs } = await setup();
    await runs.record(run({ startedAt: '2026-09-12T10:00:00.000Z', summary: 'oldest' }));
    await runs.record(run({ startedAt: '2026-09-12T10:00:02.000Z', summary: 'newest' }));
    await runs.record(
      run({ toolId: 'vlsm-calculator', startedAt: '2026-09-12T10:00:01.000Z', summary: 'middle' }),
    );

    const all = await runs.list();
    if (all.ok) expect(all.value.map((r) => r.summary)).toEqual(['newest', 'middle', 'oldest']);

    const limited = await runs.list({ limit: 2 });
    if (limited.ok) expect(limited.value.map((r) => r.summary)).toEqual(['newest', 'middle']);

    const filtered = await runs.list({ toolId: 'vlsm-calculator' });
    if (filtered.ok) expect(filtered.value.map((r) => r.summary)).toEqual(['middle']);
    db.close();
  });

  it('removes single runs and can clear everything', async () => {
    const { db, runs } = await setup();
    await runs.record(run());
    await runs.record(run());

    expect(await runs.remove('r_001')).toEqual({ ok: true, value: true });
    expect(await runs.remove('r_001')).toEqual({ ok: true, value: false });
    expect(await runs.count()).toEqual({ ok: true, value: 1 });
    expect(await runs.clear()).toEqual({ ok: true, value: 1 });
    expect(await runs.count()).toEqual({ ok: true, value: 0 });
    db.close();
  });

  it('prunes to the newest N runs (retention)', async () => {
    const { db, runs } = await setup();
    for (let i = 0; i < 10; i++) {
      await runs.record(
        run({
          startedAt: `2026-09-12T10:00:${String(i).padStart(2, '0')}.000Z`,
          summary: `run-${i}`,
        }),
      );
    }

    const pruned = await runs.prune(4);
    expect(pruned).toEqual({ ok: true, value: 6 });

    const remaining = await runs.list();
    if (remaining.ok) {
      expect(remaining.value.map((r) => r.summary)).toEqual(['run-9', 'run-8', 'run-7', 'run-6']);
    }

    // pruning again is a no-op once within the limit
    expect(await runs.prune(4)).toEqual({ ok: true, value: 0 });
    db.close();
  });

  it('prune(0) clears history, and invalid limits are rejected', async () => {
    const { db, runs } = await setup();
    await runs.record(run());
    expect(await runs.prune(-1)).toMatchObject({ ok: false });
    expect(await runs.prune(1.5)).toMatchObject({ ok: false });
    expect(await runs.prune(0)).toEqual({ ok: true, value: 1 });
    expect(await runs.count()).toEqual({ ok: true, value: 0 });
    db.close();
  });

  it('degrades corrupt status and payloads instead of throwing', async () => {
    const { db, runs } = await setup();
    await runs.record(run());
    await db.run(
      `UPDATE runs SET status = 'bogus', input = 'not json', detail = '{' WHERE id = ?`,
      ['r_001'],
    );

    const fetched = await runs.get('r_001');
    if (fetched.ok && fetched.value) {
      expect(fetched.value.status).toBe('error');
      expect(fetched.value.input).toBeNull();
      expect(fetched.value.detail).toBeNull();
    }
    db.close();
  });
});
