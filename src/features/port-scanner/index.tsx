/**
 * Port scanner — bounded-concurrency TCP connects over a port list, with
 * presets drawn from the ports database, throttled live progress, cancel, and
 * service names on the results (plan #33, M4).
 *
 * The scan is a capability (ADR-006); the run is an operation (ADR-005).
 * Progress arrives as a few snapshots per second — the UI shows a counter and
 * a bar, never a per-socket firehose (plan §0.6).
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
import { parseHostInput, parsePortList } from '../../core/validation/host';
import { usePrefilledHost } from '../_shared/deepLink';
import { PORTS, searchPorts } from '../../core/ports/ports';
import { err } from '../../core/result/result';
import { toolError } from '../../core/result/toolError';
import type { ToolScreenProps } from '../../core/registry/types';
import type { PortScanReport } from '../../core/model/tcp';
import { getCapabilities } from '../../platform/registry';
import { useOperation } from '../../platform/operations/useOperation';
import { DEFAULT_SCAN_CONCURRENCY, DEFAULT_TCP_TIMEOUT_MS } from '../../platform/capabilities/tcp';

interface ScanInput {
  readonly host: string;
  readonly ports: readonly number[];
  readonly presetLabel: string;
}

/** Preset: the first N TCP ports from the curated dataset, port order. */
function presetPorts(count: number): number[] {
  return PORTS.filter((entry) => entry.proto === 'tcp')
    .slice(0, count)
    .map((entry) => entry.port);
}

/** The ~100-port acceptance preset: curated common services, ascending. */
function commonServicesPreset(): number[] {
  const picked = searchPorts('', { proto: 'tcp' }).filter((entry) => entry.port < 1024);
  return picked.map((entry) => entry.port).sort((a, b) => a - b);
}

const PRESETS: readonly { label: string; make: () => number[] }[] = [
  { label: 'Top 10', make: () => presetPorts(10) },
  { label: 'Top 25', make: () => presetPorts(25) },
  { label: 'Common <1024', make: commonServicesPreset },
];

export function PortScannerScreen({ tool }: ToolScreenProps) {
  // LAN discovery can hand us a host (/tool/port-scanner?host=10.0.2.2).
  const [host, setHost] = useState(usePrefilledHost('example.com'));
  const [presetIndex, setPresetIndex] = useState(0);
  const [customPorts, setCustomPorts] = useState('');
  const [progress, setProgress] = useState<{
    scanned: number;
    total: number;
    open: number;
    fraction: number;
  } | null>(null);

  const parsedHost = useMemo(() => parseHostInput(host), [host]);

  // Presets are stable lists computed once; the custom field overrides when
  // it parses to a non-empty list.
  const presetList = useMemo(() => PRESETS.map((preset) => preset.make()), []);

  const parsedCustom = useMemo(() => {
    const trimmed = customPorts.trim();
    if (trimmed === '') return null;
    const parsed = parsePortList(trimmed);
    if (!parsed) return null;
    return { label: 'Custom', ports: parsed };
  }, [customPorts]);

  const selection = parsedCustom ?? {
    label: PRESETS[presetIndex].label,
    ports: presetList[presetIndex],
  };

  const operation = useOperation<ScanInput, PortScanReport>({
    toolId: 'port-scanner',
    describeInput: (input) => `${input.host} (${input.presetLabel}, ${input.ports.length} ports)`,
    summarize: (input, report) => `${input.host}: ${report.openCount} open of ${report.scanned}`,
    run: (input, context) => {
      const capability = getCapabilities().tcpScan;
      if (!capability) {
        return Promise.resolve(
          err(
            toolError('CAPABILITY_UNAVAILABLE', 'Port scanning is not available in this build.', {
              technical: 'getCapabilities().tcpScan === null',
            }),
          ),
        );
      }
      setProgress(null);
      return capability.scan(input.host, input.ports, { signal: context.signal }, (snapshot) => {
        setProgress(snapshot);
      });
    },
  });

  const submit = () => {
    if (!parsedHost.ok || selection.ports.length === 0) return;
    operation.run({ host: parsedHost.value, ports: selection.ports, presetLabel: selection.label });
  };

  const report = operation.data;

  const openPorts = report?.ports.filter((result) => result.verdict === 'open') ?? [];

  return (
    <ScrollScreen testID="port-scanner-screen">
      <ToolHeader title={tool.title} description={tool.description} />

      <Card>
        <Field
          label="Host"
          value={host}
          onChangeText={setHost}
          placeholder="example.com or 192.168.1.1"
          error={!parsedHost.ok && host.trim() !== '' ? parsedHost.error.message : null}
          mono
          testID="port-scanner-host"
          onSubmitEditing={submit}
        />

        <SectionTitle>Port list</SectionTitle>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {PRESETS.map((preset, index) => (
            <Chip
              key={preset.label}
              label={`${preset.label} (${presetList[index].length})`}
              selected={!parsedCustom && presetIndex === index}
              onPress={() => {
                setCustomPorts('');
                setPresetIndex(index);
              }}
              testID={`port-scanner-preset-${index}`}
              radio
            />
          ))}
        </View>
        <Field
          label="Custom (ports, ranges, comma or space separated)"
          value={customPorts}
          onChangeText={setCustomPorts}
          placeholder="80 443 8080 or 9800-9899"
          mono
          testID="port-scanner-custom"
          onSubmitEditing={submit}
        />
        {customPorts.trim() !== '' && !parsedCustom && (
          <StyledText style={{ color: '#d32f2f', fontSize: 11 }}>
            Custom list must be port numbers 1–65535.
          </StyledText>
        )}

        <View style={{ alignItems: 'flex-start', marginTop: 4 }}>
          <Button
            title="Scan"
            onPress={submit}
            disabled={!parsedHost.ok || selection.ports.length === 0 || operation.isRunning}
            testID="port-scanner-submit"
          />
        </View>
        <StyledText dim style={{ fontSize: 11, marginTop: 6 }}>
          {selection.ports.length} ports · {DEFAULT_SCAN_CONCURRENCY} concurrent connects ·{' '}
          {DEFAULT_TCP_TIMEOUT_MS / 1000}s timeout each. Only scan hosts you own or have permission
          to test.
        </StyledText>
      </Card>

      <OperationStatus
        isRunning={operation.isRunning}
        runningLabel={
          progress !== null
            ? `Scanning ${host} — ${progress.scanned}/${progress.total} ports, ${progress.open} open…`
            : `Scanning ${host}…`
        }
        error={operation.error}
        canRetry={operation.canRetry}
        onRetry={operation.retry}
        onCancel={operation.cancel}
      />

      {operation.isRunning && progress !== null && (
        <Card testID="port-scanner-progress">
          <SectionTitle>
            {progress.scanned} of {progress.total} scanned
          </SectionTitle>
          <View
            style={{
              height: 8,
              borderRadius: 4,
              backgroundColor: '#e0e0e0',
              overflow: 'hidden',
            }}
            accessibilityRole="progressbar"
            testID="port-scanner-progress-bar"
          >
            <View
              style={{
                height: 8,
                width: `${Math.round(progress.fraction * 100)}%`,
                backgroundColor: '#1976d2',
              }}
            />
          </View>
        </Card>
      )}

      {report !== null && operation.dataInput !== null && (
        <Card testID="port-scanner-result">
          <SectionTitle>
            {report.host} — {report.openCount} open, {report.scanned} scanned in{' '}
            {(report.durationMs / 1000).toFixed(1)}s
          </SectionTitle>
          {openPorts.length === 0 ? (
            <StyledText dim testID="port-scanner-none-open">
              No ports accepted a connection.
            </StyledText>
          ) : (
            openPorts.map((result) => (
              <View key={result.port}>
                <StyledText mono testID={`port-scanner-open-${result.port}`}>
                  {result.port}/tcp open{result.service ? ` — ${result.service}` : ''}{' '}
                  {result.latencyMs !== undefined ? `(${result.latencyMs} ms)` : ''}
                </StyledText>
              </View>
            ))
          )}
          {report.ports.some((r) => r.verdict === 'filtered') && (
            <StyledText dim style={{ fontSize: 11, marginTop: 6 }}>
              Some ports timed out (filtered) — a firewall may be dropping instead of rejecting.
            </StyledText>
          )}
        </Card>
      )}

      {report === null && !operation.isRunning && !operation.error && (
        <Note testID="port-scanner-idle">
          Pick a preset or type a port list. Closed ports are refused connections; filtered ports
          time out. Results are saved to History.
        </Note>
      )}
    </ScrollScreen>
  );
}
