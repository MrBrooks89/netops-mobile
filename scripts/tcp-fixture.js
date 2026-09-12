#!/usr/bin/env node
/**
 * tcp-fixture.js — local TCP fixture server for M4 verification.
 *
 * Gives the acceptance criteria something deterministic to talk to from the
 * emulator (host loopback is 10.0.2.2 from inside the emulator):
 *
 *   - echo port       — accepts, replies after a deliberate ~15ms delay so the
 *                       connect tool reports a measurable latency
 *   - open ports      — a range of accepting ports for the 100-port scan
 *                       budget test (some open, so the report is non-trivial)
 *   - closed port     — nothing listens there; the OS answers RST → REFUSED
 *   - filtered port   — 10.255.255.1 (non-routable) → TIMEOUT
 *
 * Usage:
 *   node scripts/tcp-fixture.js              # defaults
 *   node scripts/tcp-fixture.js --json       # one line of bound ports, then serve
 *
 * The harness prints what it opened and keeps running until killed.
 */

const net = require('net');

const args = process.argv.slice(2);
const json = args.includes('--json');

/** Accepting server that answers after `delayMs` and echoes the input. */
function echoServer(port, delayMs) {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      socket.setTimeout(2000, () => socket.destroy());
      setTimeout(() => {
        try {
          socket.write('netops-fixture\r\n');
          socket.end();
        } catch {
          // the client may already be gone; fine for a fixture
        }
      }, delayMs);
    });
    server.on('error', reject);
    server.listen(port, '0.0.0.0', () => resolve(port));
  });
}

async function main() {
  const ECHO_PORT = 9701;
  const ECHO_DELAY_MS = 15;
  // Scan range for the 100-port budget test: 9800–9899.
  // Odd ports accept, even ports have nothing listening (REFUSED) — so the
  // report always has both open and closed entries.
  const SCAN_BASE = 9800;
  const SCAN_COUNT = 100;

  const opened = [];
  await echoServer(ECHO_PORT, ECHO_DELAY_MS);
  opened.push({ port: ECHO_PORT, role: 'echo', delayMs: ECHO_DELAY_MS });

  const scanPorts = [];
  for (let i = 0; i < SCAN_COUNT; i++) {
    const port = SCAN_BASE + i;
    if (port % 2 === 1) {
      await echoServer(port, 0);
      scanPorts.push(port);
    }
  }

  const summary = {
    echoPort: ECHO_PORT,
    echoDelayMs: ECHO_DELAY_MS,
    scanRange: [SCAN_BASE, SCAN_BASE + SCAN_COUNT - 1],
    scanOpenCount: scanPorts.length,
    closedPortExample: SCAN_BASE, // nothing listens on even offsets
    note: 'host is 10.0.2.2 from inside the emulator',
    pid: process.pid,
  };

  if (json) {
    console.log(JSON.stringify(summary));
  } else {
    console.error('[tcp-fixture] serving:');
    console.error(JSON.stringify(summary, null, 2));
  }
  process.on('SIGTERM', () => process.exit(0));
  process.on('SIGINT', () => process.exit(0));
}

main().catch((error) => {
  console.error('[tcp-fixture] failed to start:', error);
  process.exit(1);
});
