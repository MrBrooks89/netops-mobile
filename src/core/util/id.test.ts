import { createId, newHostId, newNetworkId, newRunId } from './id';

describe('createId', () => {
  it('builds a prefixed, readable id from the injected clock and random source', () => {
    const id = createId(
      'h',
      () => 0,
      () => 1_700_000_000_000,
    );
    expect(id).toBe(`h_${(1_700_000_000_000).toString(36)}000000`);
  });

  it('pads the random suffix to a stable width', () => {
    const short = createId(
      'x',
      () => 0,
      () => 0,
    );
    const suffix = short.split('_')[1].slice(-6);
    expect(suffix).toBe('000000');
  });

  it('produces different ids as the clock advances', () => {
    let clock = 1_000;
    const ids = new Set([
      createId(
        'n',
        () => 0.5,
        () => clock++,
      ),
      createId(
        'n',
        () => 0.5,
        () => clock++,
      ),
    ]);
    expect(ids.size).toBe(2);
  });

  it('uses the documented prefixes', () => {
    expect(
      newHostId(
        () => 0,
        () => 0,
      ).startsWith('h_'),
    ).toBe(true);
    expect(
      newNetworkId(
        () => 0,
        () => 0,
      ).startsWith('n_'),
    ).toBe(true);
    expect(
      newRunId(
        () => 0,
        () => 0,
      ).startsWith('r_'),
    ).toBe(true);
  });

  it('defaults to the real clock and RNG', () => {
    const a = createId('r');
    const b = createId('r');
    expect(a).toMatch(/^r_[0-9a-z]{7,}$/);
    expect(a).not.toBe(b);
  });
});
