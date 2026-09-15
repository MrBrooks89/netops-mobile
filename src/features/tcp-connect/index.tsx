/**
 * TCP connect test — open one connection to host:port, report the handshake
 * time, and map failures onto the taxonomy (REFUSED = closed, TIMEOUT =
 * filtered) so the result explains itself.
 *
 * The connection is a capability (ADR-006) and the run is an operation
 * (ADR-005): cancel, history and offline handling come from the platform.
 */

import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import {
  Button,
  Card,
  CopyableValue,
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
import type { TcpConnectReport } from '../../core/model/tcp';
import { getCapabilities } from '../../platform/registry';
import { useOperation } from '../../platform/operations/useOperation';
import { DEFAULT_TCP_TIMEOUT_MS } from '../../platform/capabilities/tcp';

interface ConnectInput {
  readonly host: string;
  readonly port: number;
}

const EXAMPLES: readonly { host: string; port: number }[] = [
  { host: 'example.com', port: 443 },
  { host: 'example.com', port: 80 },
  { host: '1.1.1.1', port: 53 },
];

export function TcpConnectScreen({ tool }: ToolScreenProps) {
  // LAN discovery can hand us a host (/tool/tcp-ping?host=10.0.2.2).
  const [host, setHost] = useState(usePrefilledHost('example.com'));
  const [portText, setPortText] = useState('443');

  const parsedHost = useMemo(() => parseHostInput(host), [host]);
  const parsedPort = useMemo(() => parsePortInput(portText), [portText]);

  const operation = useOperation<ConnectInput, TcpConnectReport>({
    toolId: 'tcp-connect',
    describeInput: (input) => `${input.host}:${input.port}`,
    summarize: (input, report) =>
      report.ok
        ? `${input.host}:${input.port} open in ${report.latencyMs} ms`
        : `${input.host}:${input.port} failed (${report.errorCode ?? 'unknown'})`,
    run: (input, context) => {
      const capability = getCapabilities().tcpConnect;
      if (!capability) {
        return Promise.resolve(
          err(
            toolError(
              'CAPABILITY_UNAVAILABLE',
              'TCP connections are not available in this build.',
              {
                technical: 'getCapabilities().tcpConnect === null',
              },
            ),
          ),
        );
      }
      return capability.connect(input.host, input.port, { signal: context.signal });
    },
  });

  const submit = () => {
    if (!parsedHost.ok || !parsedPort.ok) return;
    operation.run({ host: parsedHost.value, port: parsedPort.value });
  };

  const report = operation.data;

  return (
    <ScrollScreen testID="tcp-connect-screen">
      <ToolHeader title={tool.title} description={tool.description} />

      <Card>
        <Field
          label="Host"
          value={host}
          onChangeText={setHost}
          placeholder="example.com or 192.168.1.1"
          error={!parsedHost.ok && host.trim() !== '' ? parsedHost.error.message : null}
          mono
          testID="tcp-connect-host"
          onSubmitEditing={submit}
        />
        <Field
          label="Port"
          value={portText}
          onChangeText={setPortText}
          placeholder="443"
          error={!parsedPort.ok && portText.trim() !== '' ? parsedPort.error.message : null}
          mono
          testID="tcp-connect-port"
          onSubmitEditing={submit}
        />

        <View style={{ alignItems: 'flex-start', marginTop: 4 }}>
          <Button
            title="Connect"
            onPress={submit}
            disabled={!parsedHost.ok || !parsedPort.ok || operation.isRunning}
            testID="tcp-connect-submit"
          />
        </View>

        <SectionTitle>Examples</SectionTitle>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {EXAMPLES.map((example) => (
            <StyledText key={`${example.host}:${example.port}`} style={{ marginRight: 12 }}>
              {example.host}:{example.port}
            </StyledText>
          ))}
        </View>
        <StyledText dim style={{ fontSize: 11, marginTop: 6 }}>
          Timeout {DEFAULT_TCP_TIMEOUT_MS / 1000}s per attempt. REFUSED means the port answered
          closed; TIMEOUT means nothing answered (filtered).
        </StyledText>
      </Card>

      <OperationStatus
        isRunning={operation.isRunning}
        runningLabel={`Connecting to ${host}:${portText}…`}
        error={operation.error}
        canRetry={operation.canRetry}
        onRetry={operation.retry}
        onCancel={operation.cancel}
      />

      {report !== null && operation.dataInput !== null && (
        <Card testID="tcp-connect-result">
          <SectionTitle>
            {report.host}:{report.port} — {report.ok ? 'open' : 'failed'}
          </SectionTitle>
          {report.ok ? (
            <>
              <CopyableValue label="TCP handshake" value={`${report.latencyMs} ms`} />
              <StyledText dim style={{ fontSize: 11, marginTop: 4 }}>
                Connection established and closed cleanly.
              </StyledText>
            </>
          ) : (
            <>
              <StyledText testID="tcp-connect-failure">{report.errorMessage}</StyledText>
              <StyledText dim style={{ fontSize: 11, marginTop: 4 }}>
                Code {report.errorCode} · tried at {new Date(report.finishedAt).toLocaleString()}
              </StyledText>
            </>
          )}
        </Card>
      )}

      {report === null && !operation.isRunning && !operation.error && (
        <Note testID="tcp-connect-idle">
          Enter a host and port. One TCP connection is opened, timed, and closed — nothing is sent
          over it. Runs are saved to History.
        </Note>
      )}
    </ScrollScreen>
  );
}
