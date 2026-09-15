/**
 * LAN discovery (plan #46, M7).
 *
 * Sweep the local network for live hosts and feed what it finds straight into
 * the other tools: every discovered row can be saved, port-scanned, or pinged
 * in one tap (the milestone's "≤ 2 taps" criterion).
 *
 * The screen is deliberately thin: `lanDiscovery` owns the sweep (ADR-005
 * operation for state/cancel/history) and this file owns the form, the
 * progress bar, and the per-host actions.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
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
  useTheme,
} from '../../ui/components';
import { parseV4CidrInput } from '../_shared/input';
import { parsePortList } from '../../core/validation/host';
import { cidrToString, type Ipv4Cidr } from '../../core/ip/cidr';
import type { LanHit, LanSource } from '../../core/lan/lan';
import type { ToolScreenProps } from '../../core/registry/types';
import { err } from '../../core/result/result';
import { toolError } from '../../core/result/toolError';
import type { LanDiscoveryReport, LanProgress } from '../../platform/capabilities/lan';
import {
  DEFAULT_LAN_BUDGET_MS as LAN_BUDGET_MS,
  DEFAULT_LAN_PORTS,
} from '../../platform/capabilities/lan';
import { getCapabilities } from '../../platform/registry';
import { useOperation } from '../../platform/operations/useOperation';
import { useAppData } from '../../providers/AppProviders';

interface DiscoverInput {
  readonly cidr: Ipv4Cidr;
  readonly cidrLabel: string;
  readonly ports: readonly number[];
  readonly mdns: boolean;
}

/** Tag applied to hosts saved from a sweep, so they are recognisable later. */
const DISCOVERED_TAG = 'discovered';

/** Addresses already in Saved hosts; a failed read degrades to "none saved". */
function savedHostAddresses(data: ReturnType<typeof useAppData>): string[] {
  const result = data.hosts.list();
  return result.ok ? result.value.map((host) => host.host) : [];
}

export function LanDiscoveryScreen({ tool }: ToolScreenProps) {
  const router = useRouter();
  const { theme } = useTheme();
  const data = useAppData();

  // Capability presence is knowable synchronously (it is data, not a probe),
  // so the "no native module" state is the initial state rather than
  // something an effect has to discover.
  const capability = useMemo(() => getCapabilities().lanDiscovery, []);

  const [cidrText, setCidrText] = useState('');
  const [detecting, setDetecting] = useState(capability !== null);
  const [detectMessage, setDetectMessage] = useState<string | null>(
    capability === null ? 'LAN discovery is not available in this build.' : null,
  );
  const [portsText, setPortsText] = useState(DEFAULT_LAN_PORTS.join(', '));
  const [useMdns, setUseMdns] = useState(true);
  const [progress, setProgress] = useState<LanProgress | null>(null);
  // The host list is a synchronous repository read (ADR-004), so the
  // "already saved" set is the initial state of this screen, not a fetch.
  const [savedHosts, setSavedHosts] = useState<ReadonlySet<string>>(
    () => new Set(savedHostAddresses(data)),
  );
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // Default target: the device's own subnet, so "scan my network" is one tap.
  // A build without an association leaves the field empty and says why — the
  // screen never guesses a network to sweep.
  useEffect(() => {
    if (capability === null) return;
    let active = true;
    void capability.localSubnet({}).then((result) => {
      if (!active) return;
      setDetecting(false);
      if (result.ok) setCidrText(cidrToString(result.value));
      else setDetectMessage(result.error.message);
    });
    return () => {
      active = false;
    };
  }, [capability]);

  const parsedCidr = useMemo(() => parseV4CidrInput(cidrText), [cidrText]);
  const trimmedPorts = portsText.trim();
  const parsedPorts = useMemo(
    () => (trimmedPorts === '' ? null : parsePortList(trimmedPorts)),
    [trimmedPorts],
  );

  const operation = useOperation<DiscoverInput, LanDiscoveryReport>({
    toolId: 'lan-discovery',
    describeInput: (input) => `${input.cidrLabel} (${input.ports.length} ports)`,
    summarize: (_input, report) => `${report.cidr}: ${report.summary}`,
    run: (input, context) => {
      const capability = getCapabilities().lanDiscovery;
      if (!capability) {
        return Promise.resolve(
          err(
            toolError('CAPABILITY_UNAVAILABLE', 'LAN discovery is not available in this build.', {
              technical: 'getCapabilities().lanDiscovery === null',
            }),
          ),
        );
      }
      setProgress(null);
      return capability.discover(input.cidr, {
        ports: input.ports,
        mdns: input.mdns,
        signal: context.signal,
        onProgress: setProgress,
      });
    },
  });

  const submit = () => {
    if (parsedCidr.state !== 'valid' || !parsedPorts) return;
    setSaveMessage(null);
    operation.run({
      cidr: parsedCidr.cidr,
      cidrLabel: cidrToString(parsedCidr.cidr),
      ports: parsedPorts,
      mdns: useMdns,
    });
  };

  const saveHost = useCallback(
    (hit: LanHit) => {
      setSaveMessage(null);
      const result = data.hosts.create({
        label: hit.hostname ?? hit.ip,
        host: hit.ip,
        tags: [DISCOVERED_TAG],
        notes: hit.openPorts.length === 0 ? '' : `Open: ${hit.openPorts.join(', ')}`,
      });
      if (!result.ok) {
        setSaveMessage(result.error.message);
        return;
      }
      setSavedHosts((previous) => new Set(previous).add(hit.ip));
      setSaveMessage(`Saved ${hit.ip} to Saved hosts.`);
    },
    [data],
  );

  const report = operation.data;
  const canSubmit = parsedCidr.state === 'valid' && parsedPorts !== null && !operation.isRunning;

  return (
    <ScrollScreen testID="lan-discovery-screen">
      <ToolHeader title={tool.title} description={tool.description} />

      <Card>
        <Field
          label="Network (CIDR)"
          value={cidrText}
          onChangeText={setCidrText}
          placeholder={detecting ? 'Detecting your network…' : '192.168.1.0/24'}
          error={parsedCidr.state === 'error' ? parsedCidr.message : null}
          mono
          testID="lan-discovery-cidr"
          onSubmitEditing={submit}
        />
        {detectMessage !== null && (
          <StyledText dim style={{ fontSize: 11 }} testID="lan-discovery-detect-message">
            {detectMessage}
          </StyledText>
        )}

        <Field
          label="Ports to probe (a host is found when one of these is open)"
          value={portsText}
          onChangeText={setPortsText}
          placeholder="80, 443, 22, 8080"
          error={trimmedPorts !== '' && parsedPorts === null ? 'Ports must be 1–65535.' : null}
          mono
          testID="lan-discovery-ports"
          onSubmitEditing={submit}
        />

        <SectionTitle>Sources</SectionTitle>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}>
          <Chip
            label={useMdns ? 'mDNS browse: on' : 'mDNS browse: off'}
            selected={useMdns}
            onPress={() => setUseMdns((value) => !value)}
            testID="lan-discovery-source-mdns"
          />
          <StyledText dim style={{ fontSize: 11, marginLeft: 8 }}>
            TCP sweep always runs
          </StyledText>
        </View>

        <View style={{ alignItems: 'flex-start', marginTop: 4 }}>
          <Button
            title="Discover"
            onPress={submit}
            disabled={!canSubmit}
            testID="lan-discovery-submit"
          />
        </View>
        <StyledText dim style={{ fontSize: 11, marginTop: 6 }}>
          {parsedPorts?.length ?? DEFAULT_LAN_PORTS.length} ports per address, up to{' '}
          {LAN_BUDGET_MS / 1000}s · cancels any time. Only scan networks you own or have permission
          to test.
        </StyledText>
      </Card>

      <OperationStatus
        isRunning={operation.isRunning}
        runningLabel={
          progress !== null
            ? `Sweeping — ${progress.done}/${progress.total} addresses, ${progress.found} found…`
            : 'Sweeping…'
        }
        error={operation.error}
        canRetry={operation.canRetry}
        onRetry={operation.retry}
        onCancel={operation.cancel}
      />

      {operation.isRunning && progress !== null && (
        <Card testID="lan-discovery-progress">
          <SectionTitle>
            {progress.done} of {progress.total} addresses probed
          </SectionTitle>
          <View
            style={{ height: 8, borderRadius: 4, backgroundColor: '#e0e0e0', overflow: 'hidden' }}
            accessibilityRole="progressbar"
            testID="lan-discovery-progress-bar"
          >
            <View
              style={{
                height: 8,
                width: `${Math.round(progress.fraction * 100)}%`,
                backgroundColor: theme.colors.primary,
              }}
            />
          </View>
        </Card>
      )}

      {report !== null && operation.dataInput !== null && (
        <Card testID="lan-discovery-result">
          <SectionTitle>
            {report.cidr} — {report.summary} in {(report.durationMs / 1000).toFixed(1)}s
            {report.stopped === 'cancelled' ? ' (cancelled)' : ''}
          </SectionTitle>

          {report.stopped === 'budget' && (
            <Note tone="warn" testID="lan-discovery-budget">
              Stopped at the {(LAN_BUDGET_MS / 1000).toFixed(0)}s time budget after probing{' '}
              {report.probed} of {report.total} addresses. Addresses that stay silent cost the full
              timeout each — narrow the CIDR or shorten the port list for a complete sweep.
            </Note>
          )}

          {report.mdns === 'unavailable' && (
            <Note tone="warn" testID="lan-discovery-mdns-unavailable">
              mDNS browsing is unavailable{report.mdnsReason ? ` (${report.mdnsReason})` : ''} —
              these results come from the TCP sweep alone.
            </Note>
          )}
          {report.truncated && (
            <Note tone="warn" testID="lan-discovery-truncated">
              That block has {report.total.toLocaleString()} usable addresses; the sweep covered the
              first {report.probed}. Narrow the CIDR for complete coverage.
            </Note>
          )}
          {report.hosts.length === 0 && (
            <StyledText dim testID="lan-discovery-none-found">
              No host answered on {report.ports.join(', ')}. Add ports (445, 631, 8008) or check you
              are on the network you meant to sweep.
            </StyledText>
          )}

          {report.hosts.map((hit) => (
            <HostRow
              key={hit.ip}
              hit={hit}
              saved={savedHosts.has(hit.ip)}
              onSave={() => saveHost(hit)}
              onScan={() => router.push(`/tool/port-scanner?host=${hit.ip}`)}
              onPing={() => router.push(`/tool/tcp-ping?host=${hit.ip}`)}
            />
          ))}
        </Card>
      )}

      {saveMessage !== null && <Note testID="lan-discovery-save-message">{saveMessage}</Note>}

      {report === null && !operation.isRunning && operation.error === null && (
        <Note testID="lan-discovery-idle">
          Discovery probes a handful of ports on every address in the block. A device with none of
          those ports open will not appear — add ports to widen the net. Results are saved to
          History.
        </Note>
      )}
    </ScrollScreen>
  );
}

/** One discovered host: identity, evidence, and the one-tap follow-ups. */
function HostRow({
  hit,
  saved,
  onSave,
  onScan,
  onPing,
}: {
  hit: LanHit;
  saved: boolean;
  onSave: () => void;
  onScan: () => void;
  onPing: () => void;
}) {
  const { theme } = useTheme();
  return (
    <View
      style={{
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
        paddingVertical: 10,
      }}
      testID={`lan-host-${hit.ip}`}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
        <StyledText mono style={{ fontWeight: '700' }}>
          {hit.ip}
        </StyledText>
        {hit.sources.map((source) => (
          <SourceBadge key={source} source={source} />
        ))}
        {hit.latencyMs !== null && (
          <StyledText dim style={{ fontSize: 11 }}>
            {hit.latencyMs} ms
          </StyledText>
        )}
      </View>
      {hit.hostname !== null && (
        <StyledText dim style={{ fontSize: 12 }} testID={`lan-hostname-${hit.ip}`}>
          {hit.hostname}
        </StyledText>
      )}
      <StyledText dim style={{ fontSize: 12 }}>
        {hit.openPorts.length === 0 ? 'No probed port open' : `Open: ${hit.openPorts.join(', ')}`}
      </StyledText>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 }}>
        <View style={styles.action}>
          <Button title="Scan ports" onPress={onScan} testID={`lan-scan-${hit.ip}`} />
        </View>
        <View style={styles.action}>
          <Button title="Ping" onPress={onPing} testID={`lan-ping-${hit.ip}`} />
        </View>
        <View style={styles.action}>
          <Button
            title={saved ? 'Saved' : 'Save host'}
            onPress={onSave}
            disabled={saved}
            testID={`lan-save-${hit.ip}`}
          />
        </View>
      </View>
    </View>
  );
}

/** Why an address is in the list — the evidence, not a decoration. */
function SourceBadge({ source }: { source: LanSource }) {
  const { theme } = useTheme();
  const label = source === 'tcp' ? 'TCP' : 'mDNS';
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={`Found by ${label}`}
      style={{
        marginLeft: 6,
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: 6,
        backgroundColor: theme.colors.surfaceAlt,
        borderWidth: 1,
        borderColor: theme.colors.border,
      }}
      testID={`lan-source-${source}`}
    >
      <StyledText style={{ fontSize: 10, fontWeight: '700' }}>{label}</StyledText>
    </View>
  );
}

const styles = StyleSheet.create({
  action: { marginRight: 8, marginBottom: 8 },
});
