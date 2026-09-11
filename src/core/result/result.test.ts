import { err, flatMap, map, ok, unwrap, all } from '../result/result';
import { toolError } from '../result/toolError';

describe('Result', () => {
  it('ok wraps a value', () => {
    expect(ok(42)).toEqual({ ok: true, value: 42 });
  });

  it('err wraps an error', () => {
    const e = toolError('INVALID_INPUT', 'bad');
    expect(err(e)).toEqual({ ok: false, error: e });
  });

  it('map transforms the success value', () => {
    expect(map(ok(2), (v) => v * 2)).toEqual({ ok: true, value: 4 });
    const e = toolError('UNKNOWN', 'x');
    expect(map(err(e), (v: number) => v * 2)).toEqual({ ok: false, error: e });
  });

  it('flatMap chains Result-returning functions', () => {
    const dbl = (n: number) => ok(n * 2);
    expect(flatMap(ok(2), dbl)).toEqual({ ok: true, value: 4 });
    const e = toolError('UNKNOWN', 'x');
    expect(flatMap(err(e), dbl)).toEqual({ ok: false, error: e });
  });

  it('all collects successes and fail-fasts on the first error', () => {
    expect(all([ok(1), ok(2), ok(3)])).toEqual({ ok: true, value: [1, 2, 3] });
    const e = toolError('INVALID_INPUT', 'bad');
    const r = all([ok(1), err(e), ok(3)]);
    expect(r.ok).toBe(false);
  });

  it('unwrap throws on err (test-only helper)', () => {
    const e = toolError('UNKNOWN', 'x');
    expect(() => unwrap(err(e))).toThrow(e);
  });
});

describe('toolError defaults', () => {
  it('marks network-ish codes retryable and validation fatal', () => {
    expect(toolError('INVALID_INPUT', 'x').retryable).toBe(false);
    expect(toolError('TIMEOUT', 'x').retryable).toBe(true);
    expect(toolError('NETWORK_UNREACHABLE', 'x').retryable).toBe(true);
    expect(toolError('PERMISSION_DENIED', 'x').retryable).toBe(false);
  });

  it('carries technical detail when given', () => {
    const e = toolError('DNS_FAILURE', 'nope', { technical: 'EAI_AGAIN' });
    expect(e.technical).toBe('EAI_AGAIN');
  });
});
