import { icmpStats, type IcmpProbe } from './ping';

describe('icmpStats', () => {
  it('counts received/sent/loss from probes', () => {
    const probes: IcmpProbe[] = [
      { seq: 1, ok: true, latencyMs: null },
      { seq: 2, ok: false, latencyMs: null, errorCode: 'UNREACHABLE' },
      { seq: 3, ok: true, latencyMs: null },
      { seq: 4, ok: true, latencyMs: null },
    ];
    const stats = icmpStats(probes);
    expect(stats.sent).toBe(4);
    expect(stats.received).toBe(3);
    expect(stats.lossPercent).toBe(25);
  });

  it('keeps min/avg/max null — isReachable reports no timing', () => {
    const probes: IcmpProbe[] = [{ seq: 1, ok: true, latencyMs: null }];
    const stats = icmpStats(probes);
    expect(stats.minMs).toBeNull();
    expect(stats.avgMs).toBeNull();
    expect(stats.maxMs).toBeNull();
  });

  it('reports 100% loss when every probe failed', () => {
    const probes: IcmpProbe[] = [
      { seq: 1, ok: false, latencyMs: null, errorCode: 'UNREACHABLE' },
      { seq: 2, ok: false, latencyMs: null, errorCode: 'UNREACHABLE' },
    ];
    const stats = icmpStats(probes);
    expect(stats.lossPercent).toBe(100);
    expect(stats.received).toBe(0);
  });

  it('returns zeroed stats for an empty series', () => {
    const stats = icmpStats([]);
    expect(stats.sent).toBe(0);
    expect(stats.lossPercent).toBe(0);
    expect(stats.avgMs).toBeNull();
  });
});
