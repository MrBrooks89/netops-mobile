/**
 * TLS inspection models (M6, plan #42/#43) — pure data, no RN imports (§3.1).
 *
 * The native half captures the certificate chain presented by the server
 * *for display only* (plan §16.7): it must never disable validation for
 * any other network call. Each certificate is mapped to a plain shape;
 * the screen renders it, the expiry math lives here (testable, pure).
 */

/** One certificate in the presented chain, leaf first. */
export interface TlsCertificate {
  /** Subject DN, rendered (CN=example.com, O=Org). */
  readonly subject: string;
  /** Issuer DN, rendered. */
  readonly issuer: string;
  /** Subject Alternative Names, as parsed. */
  readonly sans: readonly string[];
  /** ISO-8601 (UTC) validity window. */
  readonly notBefore: string;
  readonly notAfter: string;
  /** Lowercase hex, no separators. */
  readonly serialNumber: string;
  /** Signature algorithm name (e.g. SHA256withRSA). */
  readonly signatureAlgorithm: string;
  /** Key algorithm + size (e.g. "RSA 2048"). */
  readonly keyInfo: string;
  /** True when subject == issuer (typical self-signed marker). */
  readonly selfSigned: boolean;
}

/** Report of one TLS inspection run (tool id `tls-inspector`). */
export interface TlsReport {
  readonly method: 'tls';
  readonly host: string;
  readonly port: number;
  /** The presented chain, leaf first — exactly what the server sent. */
  readonly chain: readonly TlsCertificate[];
  /** TLS version negotiated (e.g. "TLSv1.3"). */
  readonly tlsVersion: string | null;
  /** Cipher suite negotiated. */
  readonly cipherSuite: string | null;
  readonly finishedAt: number;
}

export const TLS_EXPIRY_WARNING_DAYS = 14;

export interface TlsExpiry {
  /** Whole days from "now" until notAfter; negative when already expired. */
  readonly daysRemaining: number;
  readonly expired: boolean;
  /** True when expiring within TLS_EXPIRY_WARNING_DAYS (and not expired). */
  readonly expiringSoon: boolean;
  readonly notAfter: string;
}

/**
 * Expiry math for a certificate — pure so tests pin the boundary cases
 * (< 14 days fires the warning; expired is its own state, never "soon").
 */
export function tlsExpiry(certificate: TlsCertificate, now: Date = new Date()): TlsExpiry {
  const notAfter = new Date(certificate.notAfter);
  const msRemaining = notAfter.getTime() - now.getTime();
  // Round toward zero-ish: 1.9 days left is "1 day", -0.1 is "0 days
  // (expired)". Math.floor keeps "expires today" at 0 until the moment
  // it flips negative.
  const daysRemaining = Math.floor(msRemaining / 86_400_000);
  const expired = msRemaining <= 0;
  return {
    daysRemaining,
    expired,
    expiringSoon: !expired && daysRemaining < TLS_EXPIRY_WARNING_DAYS,
    notAfter: certificate.notAfter,
  };
}
