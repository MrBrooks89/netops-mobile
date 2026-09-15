/**
 * Ping — one tool, two methods (plan D4, M5).
 *
 * TCP ping (default) measures handshake latency over a transport every
 * phone can use. ICMP (best-effort) uses the netops module's
 * InetAddress.isReachable() — no privileges needed, but also no timing
 * data, so it reports reachability only and says so honestly. The method
 * chip is the only difference in the UI; the stats card, probes list,
 * cancel and history recording are shared.
 *
 * The tool id stays `tcp-ping` (M4 history rows and deep links keep
 * working); the dashboard card is simply titled "Ping".
 *
 * The run is an operation (ADR-005): cancel stops between probes and a
 * cancelled series records nothing.
 */

import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import {
  Button,
  Card,
  Chip,
  Field,
  Note,
  OperationStatus,
  ScrollScreen,
  SectionTitle,
  StyledText,
  ToolHeader,
} from '../../ui/components';
import { parseHostInput, parsePortInput } from '../../core/validation/host';
import { usePrefilledHost } from '../_shared/deepLink';
import { err } from '../../core/result/result';
import { toolError } from '../../core/result/toolError';
import type { ToolScreenProps } from '../../core/registry/types';
import type { TcpPingReport } from '../../core/model/tcp';
import type { IcmpPingReport } from '../../core/model/ping';
import { getCapabilities } from '../../platform/registry';
import { useOperation } from '../../platform/operations/useOperation';
import {
  DEFAULT_TCP_PING_INTERVAL_MS,
  DEFAULT_TCP_TIMEOUT_MS,
} from '../../platform/capabilities/tcp';
import {
  DEFAULT_ICMP_INTERVAL_MS,
  DEFAULT_ICMP_TIMEOUT_MS,
} from '../../platform/capabilities/icmp';

/** Either ping method's report — the union the stats card renders. */
export type PingReport = TcpPingReport | IcmpPingReport;

/** The view-model both methods reduce to for rendering. */
interface PingView {
  readonly label: string;
  readonly received: number;
  readonly sent: number;
  readonly lossPercent: number;
  readonly minMs: number | null;
  readonly avgMs: number | null;
  readonly maxMs: number | null;
  readonly probes: readonly {
    seq: number;
    ok: boolean;
    latencyMs: number | null;
    errorCode?: string;
  }[];
}

function toView(report: PingReport): PingView {
  return {
    label:
      report.method === 'tcp'
        ? `${report.host}:${report.port} (TCP)`
        : `${report.host} (ICMP, best-effort)`,
    received: report.received,
    sent: report.sent,
    lossPercent: report.lossPercent,
    minMs: report.minMs,
    avgMs: report.avgMs,
    maxMs: report.maxMs,
    probes: report.probes,
  };
}

interface PingInput {
  readonly host: string;
  readonly method: 'tcp' | 'icmp';
  readonly port: number;
  readonly count: number;
}

const COUNTS: readonly number[] = [4, 10, 25];

export function PingScreen({ tool }: ToolScreenProps) {
  // LAN discovery can hand us a host (/tool/tcp-ping?host=10.0.2.2).
  const [host, setHost] = useState(usePrefilledHost('example.com'));
  const [portText, setPortText] = useState('443');
  const [count, setCount] = useState<number>(4);
  const [method, setMethod] = useState<'tcp' | 'icmp'>('tcp');

  const parsedHost = useMemo(() => parseHostInput(host), [host]);
  const parsedPort = useMemo(() => parsePortInput(portText), [portText]);

  const operation = useOperation<PingInput, PingReport>({
    toolId: 'tcp-ping',
    describeInput: (input) =>
      input.method === 'tcp'
        ? `${input.host}:${input.port} ×${input.count} (TCP)`
        : `${input.host} ×${input.count} (ICMP)`,
    summarize: (input, report) =>
      input.method === 'tcp'
        ? `${input.host}:${input.port} ×${report.received}/${report.sent} avg ${
            report.avgMs ?? '—'
          } ms`
        : `${input.host} ×${report.received}/${report.sent} reachable (ICMP best-effort)`,
    run: (input, context) => {
      const capabilities = getCapabilities();
      if (input.method === 'tcp') {
        if (!capabilities.tcpPing) {
          return Promise.resolve(
            err(
              toolError('CAPABILITY_UNAVAILABLE', 'TCP ping is not available in this build.', {
                technical: 'getCapabilities().tcpPing === null',
              }),
            ),
          );
        }
        return capabilities.tcpPing.ping(input.host, input.port, input.count, {
          signal: context.signal,
        });
      }
      if (!capabilities.icmpPing) {
        return Promise.resolve(
          err(
            toolError(
              'CAPABILITY_UNAVAILABLE',
              'ICMP ping is not available in this build. TCP ping works everywhere.',
              {
                technical: 'getCapabilities().icmpPing === null',
              },
            ),
          ),
        );
      }
      return capabilities.icmpPing.ping(input.host, input.count, {
        signal: context.signal,
      });
    },
  });

  const submit = () => {
    if (!parsedHost.ok) return;
    const port = parsedPort.ok ? parsedPort.value : 0;
    if (method === 'tcp' && !parsedPort.ok) return;
    operation.run({ host: parsedHost.value, method, port, count });
  };

  const report = operation.data;
  const view = report !== null ? toView(report) : null;

  return (
    <ScrollScreen testID="ping-screen">
      <ToolHeader title={tool.title} description={tool.description} />

      <Card>
        <SectionTitle>Method</SectionTitle>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          <Chip
            label="TCP (default)"
            selected={method === 'tcp'}
            onPress={() => setMethod('tcp')}
            testID="ping-method-tcp"
            radio
          />
          <Chip
            label="ICMP — best-effort"
            selected={method === 'icmp'}
            onPress={() => setMethod('icmp')}
            testID="ping-method-icmp"
            radio
          />
        </View>
        {method === 'icmp' && (
          <StyledText dim style={{ fontSize: 11, marginTop: 6 }} testID="ping-method-note">
            Best-effort reachability only (no timing data) — mobile apps cannot send real ICMP
            echoes. TCP ping measures latency and works everywhere.
          </StyledText>
        )}

        <Field
          label="Host"
          value={host}
          onChangeText={setHost}
          placeholder="example.com or 192.168.1.1"
          error={!parsedHost.ok && host.trim() !== '' ? parsedHost.error.message : null}
          mono
          testID="ping-host"
          onSubmitEditing={submit}
        />
        {method === 'tcp' && (
          <Field
            label="Port"
            value={portText}
            onChangeText={setPortText}
            placeholder="443"
            error={!parsedPort.ok && portText.trim() !== '' ? parsedPort.error.message : null}
            mono
            testID="ping-port"
            onSubmitEditing={submit}
          />
        )}

        <SectionTitle>Probes</SectionTitle>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {COUNTS.map((value) => (
            <Chip
              key={value}
              label={`${value}`}
              selected={count === value}
              onPress={() => setCount(value)}
              testID={`ping-count-${value}`}
              radio
            />
          ))}
        </View>

        <View style={{ alignItems: 'flex-start', marginTop: 4 }}>
          <Button
            title="Ping"
            onPress={submit}
            disabled={!parsedHost.ok || (method === 'tcp' && !parsedPort.ok) || operation.isRunning}
            testID="ping-submit"
          />
        </View>
        <StyledText dim style={{ fontSize: 11, marginTop: 6 }}>
          {count} sequential probes,{' '}
          {(method === 'tcp' ? DEFAULT_TCP_PING_INTERVAL_MS : DEFAULT_ICMP_INTERVAL_MS) / 1000}s
          apart, {(method === 'tcp' ? DEFAULT_TCP_TIMEOUT_MS : DEFAULT_ICMP_TIMEOUT_MS) / 1000}s
          timeout each.
        </StyledText>
      </Card>

      <OperationStatus
        isRunning={operation.isRunning}
        runningLabel={`Pinging ${
          method === 'tcp' ? `${host}:${portText}` : host
        } (probe ${(report?.probes.length ?? 0) + 1} of ${count})…`}
        error={operation.error}
        canRetry={operation.canRetry}
        onRetry={operation.retry}
        onCancel={operation.cancel}
      />

      {view !== null && operation.dataInput !== null && (
        <Card testID="ping-result">
          <SectionTitle>
            {view.label} — {view.received}/{view.sent} received
          </SectionTitle>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            <StyledText style={{ marginRight: 16 }}>min {view.minMs ?? '—'} ms</StyledText>
            <StyledText style={{ marginRight: 16 }}>avg {view.avgMs ?? '—'} ms</StyledText>
            <StyledText style={{ marginRight: 16 }}>max {view.maxMs ?? '—'} ms</StyledText>
            <StyledText>loss {view.lossPercent}%</StyledText>
          </View>

          <SectionTitle>Probes</SectionTitle>
          {view.probes.map((probe) => (
            <StyledText
              key={probe.seq}
              mono
              style={{ fontSize: 12 }}
              testID={`ping-probe-${probe.seq}`}
            >
              #{probe.seq}{' '}
              {probe.ok
                ? probe.latencyMs !== null
                  ? `ok ${probe.latencyMs} ms`
                  : 'reachable'
                : `failed (${probe.errorCode})`}
            </StyledText>
          ))}
        </Card>
      )}

      {report === null && !operation.isRunning && !operation.error && (
        <Note testID="ping-idle">
          {method === 'tcp'
            ? 'Each probe opens a fresh TCP connection and measures the handshake. Cancel stops before the next probe; runs are saved to History.'
            : 'Best-effort reachability probes. Cancel stops before the next probe; runs are saved to History.'}
        </Note>
      )}
    </ScrollScreen>
  );
}
