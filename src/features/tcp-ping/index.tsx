/**
 * TCP ping — N sequential connect probes with per-probe latency, min/avg/max
 * and loss, the way ping reports reachability but over a transport that works
 * without ICMP privileges.
 *
 * The probe series is a capability (ADR-006); the run is an operation
 * (ADR-005) so cancel stops between probes and nothing is recorded when it
 * does.
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
import { err } from '../../core/result/result';
import { toolError } from '../../core/result/toolError';
import type { ToolScreenProps } from '../../core/registry/types';
import type { TcpPingReport } from '../../core/model/tcp';
import { getCapabilities } from '../../platform/registry';
import { useOperation } from '../../platform/operations/useOperation';
import {
  DEFAULT_TCP_PING_INTERVAL_MS,
  DEFAULT_TCP_TIMEOUT_MS,
} from '../../platform/capabilities/tcp';

interface PingInput {
  readonly host: string;
  readonly port: number;
  readonly count: number;
}

const COUNTS: readonly number[] = [4, 10, 25];

export function TcpPingScreen({ tool }: ToolScreenProps) {
  const [host, setHost] = useState('example.com');
  const [portText, setPortText] = useState('443');
  const [count, setCount] = useState<number>(4);

  const parsedHost = useMemo(() => parseHostInput(host), [host]);
  const parsedPort = useMemo(() => parsePortInput(portText), [portText]);

  const operation = useOperation<PingInput, TcpPingReport>({
    toolId: 'tcp-ping',
    describeInput: (input) => `${input.host}:${input.port} ×${input.count}`,
    summarize: (input, report) =>
      `${input.host}:${input.port} ×${report.received}/${report.sent} avg ${
        report.avgMs ?? '—'
      } ms`,
    run: (input, context) => {
      const capability = getCapabilities().tcpPing;
      if (!capability) {
        return Promise.resolve(
          err(
            toolError('CAPABILITY_UNAVAILABLE', 'TCP ping is not available in this build.', {
              technical: 'getCapabilities().tcpPing === null',
            }),
          ),
        );
      }
      return capability.ping(input.host, input.port, input.count, {
        signal: context.signal,
      });
    },
  });

  const submit = () => {
    if (!parsedHost.ok || !parsedPort.ok) return;
    operation.run({ host: parsedHost.value, port: parsedPort.value, count });
  };

  const report = operation.data;

  return (
    <ScrollScreen testID="tcp-ping-screen">
      <ToolHeader title={tool.title} description={tool.description} />

      <Card>
        <Field
          label="Host"
          value={host}
          onChangeText={setHost}
          placeholder="example.com or 192.168.1.1"
          error={!parsedHost.ok && host.trim() !== '' ? parsedHost.error.message : null}
          mono
          testID="tcp-ping-host"
          onSubmitEditing={submit}
        />
        <Field
          label="Port"
          value={portText}
          onChangeText={setPortText}
          placeholder="443"
          error={!parsedPort.ok && portText.trim() !== '' ? parsedPort.error.message : null}
          mono
          testID="tcp-ping-port"
          onSubmitEditing={submit}
        />

        <SectionTitle>Probes</SectionTitle>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {COUNTS.map((value) => (
            <Chip
              key={value}
              label={`${value}`}
              selected={count === value}
              onPress={() => setCount(value)}
              testID={`tcp-ping-count-${value}`}
              radio
            />
          ))}
        </View>

        <View style={{ alignItems: 'flex-start', marginTop: 4 }}>
          <Button
            title="Ping"
            onPress={submit}
            disabled={!parsedHost.ok || !parsedPort.ok || operation.isRunning}
            testID="tcp-ping-submit"
          />
        </View>
        <StyledText dim style={{ fontSize: 11, marginTop: 6 }}>
          {count} sequential probes, {DEFAULT_TCP_PING_INTERVAL_MS / 1000}s apart,{' '}
          {DEFAULT_TCP_TIMEOUT_MS / 1000}s timeout each.
        </StyledText>
      </Card>

      <OperationStatus
        isRunning={operation.isRunning}
        runningLabel={`Pinging ${host}:${portText} (probe ${
          (report?.probes.length ?? 0) + 1
        } of ${count})…`}
        error={operation.error}
        canRetry={operation.canRetry}
        onRetry={operation.retry}
        onCancel={operation.cancel}
      />

      {report !== null && operation.dataInput !== null && (
        <Card testID="tcp-ping-result">
          <SectionTitle>
            {report.host}:{report.port} — {report.received}/{report.sent} received
          </SectionTitle>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            <StyledText style={{ marginRight: 16 }}>min {report.minMs ?? '—'} ms</StyledText>
            <StyledText style={{ marginRight: 16 }}>avg {report.avgMs ?? '—'} ms</StyledText>
            <StyledText style={{ marginRight: 16 }}>max {report.maxMs ?? '—'} ms</StyledText>
            <StyledText>loss {report.lossPercent}%</StyledText>
          </View>

          <SectionTitle>Probes</SectionTitle>
          {report.probes.map((probe) => (
            <StyledText
              key={probe.seq}
              mono
              style={{ fontSize: 12 }}
              testID={`tcp-ping-probe-${probe.seq}`}
            >
              #{probe.seq} {probe.ok ? `ok ${probe.latencyMs} ms` : `failed (${probe.errorCode})`}
            </StyledText>
          ))}
        </Card>
      )}

      {report === null && !operation.isRunning && !operation.error && (
        <Note testID="tcp-ping-idle">
          Each probe opens a fresh TCP connection and measures the handshake. Cancel stops before
          the next probe; runs are saved to History.
        </Note>
      )}
    </ScrollScreen>
  );
}
