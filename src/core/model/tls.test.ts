import { tlsExpiry, TLS_EXPIRY_WARNING_DAYS, type TlsCertificate } from './tls';

function certificate(notAfter: string, notBefore = '2020-01-01T00:00:00Z'): TlsCertificate {
  return {
    subject: 'CN=example.com',
    issuer: 'CN=Example CA',
    sans: ['example.com', 'www.example.com'],
    notBefore,
    notAfter,
    serialNumber: 'abc123',
    signatureAlgorithm: 'SHA256withRSA',
    keyInfo: 'RSA 2048',
    selfSigned: false,
  };
}

describe('tlsExpiry', () => {
  const NOW = new Date('2026-09-14T12:00:00Z');

  it('counts whole days remaining (floor, not round)', () => {
    // 1.9 days left reads as 1 day, not 2.
    const notAfter = new Date(NOW.getTime() + 1.9 * 86_400_000).toISOString();
    const expiry = tlsExpiry(certificate(notAfter), NOW);
    expect(expiry.daysRemaining).toBe(1);
    expect(expiry.expired).toBe(false);
    expect(expiry.expiringSoon).toBe(true);
  });

  it('fires the warning inside the 14-day window but not at exactly 14', () => {
    const inside = new Date(NOW.getTime() + 13 * 86_400_000).toISOString();
    expect(tlsExpiry(certificate(inside), NOW).expiringSoon).toBe(true);

    // 14.5 days: floor → 14 → not inside the window (< 14).
    const edge = new Date(NOW.getTime() + 14.5 * 86_400_000).toISOString();
    const expiry = tlsExpiry(certificate(edge), NOW);
    expect(expiry.daysRemaining).toBe(14);
    expect(expiry.expiringSoon).toBe(false);
    expect(TLS_EXPIRY_WARNING_DAYS).toBe(14);
  });

  it('expired is its own state, never "expiring soon"', () => {
    const notAfter = new Date(NOW.getTime() - 86_400_000).toISOString();
    const expiry = tlsExpiry(certificate(notAfter), NOW);
    expect(expiry.expired).toBe(true);
    expect(expiry.expiringSoon).toBe(false);
    expect(expiry.daysRemaining).toBe(-1);
  });

  it('expires-today is not yet expired at floor 0', () => {
    const notAfter = new Date(NOW.getTime() + 6 * 3_600_000).toISOString();
    const expiry = tlsExpiry(certificate(notAfter), NOW);
    expect(expiry.expired).toBe(false);
    expect(expiry.daysRemaining).toBe(0);
    expect(expiry.expiringSoon).toBe(true);
  });

  it('carries the raw notAfter string through', () => {
    const expiry = tlsExpiry(certificate('2030-01-01T00:00:00Z'), NOW);
    expect(expiry.notAfter).toBe('2030-01-01T00:00:00Z');
    expect(expiry.expired).toBe(false);
  });
});
