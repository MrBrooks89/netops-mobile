#!/usr/bin/env node
/**
 * http-fixture.js — local HTTP/TLS fixture server for M6 verification.
 *
 * Deterministic targets the HTTP diagnostics + TLS inspector tools can
 * probe from the emulator (host loopback = 10.0.2.2):
 *
 *   - 9805 plain HTTP: /start → 301 /login → 200 (a real redirect chain)
 *   - 9806 plain HTTP: direct 200 with distinctive headers + a body
 *   - 9443 HTTPS (self-signed CN=fixture.local): 200 over TLS — exercises
 *     the connectTLS exchange AND gives the TLS inspector a self-signed
 *     chain to flag (364-day cert)
 *   - 9444 HTTPS (self-signed CN=expiring.fixture.local, 3-day validity):
 *     fires the < 14-day expiry warning
 *
 * Certs are PKCS12 keystores generated with the project JDK's keytool
 * (scripts/fixtures/certs); Node's tls server accepts them as pfx.
 *
 * Usage:
 *   node scripts/http-fixture.js
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const HOST_BIND = '0.0.0.0';
// Run from the repo root (like tcp-fixture.js): certs live next to this
// script's fixtures directory.
const CERT_DIR = path.join('scripts', 'fixtures', 'certs');

function pfx(name) {
  return fs.readFileSync(path.join(CERT_DIR, name));
}

function plainServer(port, handler) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.on('error', reject);
    server.listen(port, HOST_BIND, () => resolve(port));
  });
}

function tlsServer(port, keystore, handler) {
  return new Promise((resolve, reject) => {
    const server = https.createServer(
      { pfx: pfx(keystore), passphrase: 'netopsfix' },
      handler,
    );
    server.on('error', reject);
    server.listen(port, HOST_BIND, () => resolve(port));
  });
}

async function main() {
  const opened = [];

  // Redirect chain: /start → 301 /login → 200.
  await plainServer(9805, (req, res) => {
    if (req.url === '/start') {
      res.writeHead(301, { Location: '/login', 'X-Fixture': 'redirect-hop-1' });
      res.end();
      return;
    }
    if (req.url === '/login') {
      res.writeHead(200, {
        'Content-Type': 'text/plain',
        'X-Fixture': 'final-hop',
        'X-Directive': 'netops-m6-fixture',
      });
      res.end('fixture login page reached');
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  });
  opened.push({ port: 9805, role: 'redirect-chain' });

  // Direct 200 with headers a spot-check can compare against curl -v.
  await plainServer(9806, (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/plain',
      'X-Fixture': 'plain-200',
      'Content-Length': String('hello from the m6 fixture'.length),
    });
    res.end('hello from the m6 fixture');
  });
  opened.push({ port: 9806, role: 'plain-200' });

  // Self-signed HTTPS: the inspector must flag selfSigned and show the chain.
  await tlsServer(9443, 'm6-keystore.p12', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/plain',
      'X-Fixture': 'tls-self-signed',
    });
    res.end('secure fixture');
  });
  opened.push({ port: 9443, role: 'https-self-signed' });

  // Expiring self-signed HTTPS (3-day cert) → "expiring soon" warning.
  await tlsServer(9444, 'm6-expiring.p12', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/plain',
      'X-Fixture': 'tls-expiring',
    });
    res.end('expiring fixture');
  });
  opened.push({ port: 9444, role: 'https-expiring' });

  console.error('[http-fixture] serving:');
  console.error(
    JSON.stringify(
      {
        ports: opened,
        hostNote: '10.0.2.2 from inside the emulator',
        pid: process.pid,
      },
      null,
      2,
    ),
  );
  process.on('SIGTERM', () => process.exit(0));
  process.on('SIGINT', () => process.exit(0));
}

main().catch((error) => {
  console.error('[http-fixture] failed to start:', error);
  process.exit(1);
});
