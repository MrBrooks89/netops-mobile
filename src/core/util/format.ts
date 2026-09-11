/**
 * Small formatting helpers shared by feature screens.
 *
 * Deliberately Intl-free: `toLocaleString` behaviour varies across Hermes
 * builds and test environments, and these strings are copyable values that
 * must be byte-stable.
 *
 * Pure TS — no React Native imports.
 */

const GROUP = /\B(?=(\d{3})+(?!\d))/g;

/** 4294967294 → "4,294,967,294" */
export function groupDigits(n: number): string {
  const sign = n < 0 ? '-' : '';
  return sign + Math.abs(n).toString().replace(GROUP, ',');
}

/** "1 host" / "254 hosts" */
export function hostsLabel(n: number): string {
  return `${groupDigits(n)} ${n === 1 ? 'host' : 'hosts'}`;
}

/** "1 address" / "256 addresses" */
export function addressesLabel(n: number): string {
  return `${groupDigits(n)} ${n === 1 ? 'address' : 'addresses'}`;
}
