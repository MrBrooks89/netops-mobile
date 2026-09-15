# M6 HTTP diagnostics + TLS inspection - Checkpoint

- Task ID: 2026-09-14-m6-http-tls
- Current todo: Milestone complete — all slices done, verified, documented.
- Active slice: closeout (evidence + reflection recorded; verification doc written)
- Blocked on: none
- Next step: none within this task. M7 (history browser + tool filters) is the
  next milestone per docs/IMPLEMENTATION_PLAN.md.
- Device verification: docs/M6_VERIFICATION.md — all acceptance criteria met
  (redirect chain + timings, curl -v match, self-signed flag, < 14-day expiry
  warning, export, cleartext per ADR-007, https with TLS phase).
- Gates at closeout: 545/545 tests (47 suites), tsc clean, lint 0/0, format
  clean, coverage thresholds met (http.ts + tls.ts added to the map).
