/**
 * CIDR calculator — mask ↔ prefix conversion, splitting, and summarisation.
 *
 * Four modes, one input network:
 *   Convert    — prefix ↔ netmask, wildcard, sizing
 *   Split      — divide into N equal subnets (N a power of two)
 *   Hosts      — subnets of "at least N hosts" that fit the base
 *   Summarise  — tightest common supernet of several networks
 */

import React, { useState } from 'react';
import { View } from 'react-native';
import {
  Card,
  Chip,
  CopyableValue,
  Field,
  Note,
  ScrollScreen,
  SectionTitle,
  StyledText,
  ToolHeader,
} from '../../ui/components';
import type { ToolScreenProps } from '../../core/registry/types';
import { cidrToString, prefixToMaskV4, wildcardMaskV4, type Ipv4Cidr } from '../../core/ip/cidr';
import { splitInto, subnetCount, subnetsForHosts, supernetOf } from '../../core/subnet/split';
import { usableHostCount } from '../../core/subnet/subnet';
import { addressesLabel, hostsLabel } from '../../core/util/format';
import { parseV4CidrInput } from '../_shared/input';
import { useCalculatorHistory } from '../_shared/useCalculatorHistory';

type Mode = 'convert' | 'split' | 'hosts' | 'summarise';

type SplitState = { kind: 'error'; message: string } | { kind: 'subnets'; subnets: Ipv4Cidr[] };

type HostsState =
  { kind: 'error'; message: string } | { kind: 'result'; subnets: Ipv4Cidr[]; childPrefix: number };

type SummariseState =
  { kind: 'error'; message: string } | { kind: 'result'; supernet: Ipv4Cidr; count: number };

const MODES: { id: Mode; label: string }[] = [
  { id: 'convert', label: 'Convert' },
  { id: 'split', label: 'Split into N' },
  { id: 'hosts', label: 'Fit ≥ N hosts' },
  { id: 'summarise', label: 'Summarise' },
];

const EXAMPLES = ['192.168.1.0/24', '10.0.0.0/8', '172.16.0.0/12', '203.0.113.0/26'];

/** Rendering cap — splitting a /8 into 65536 subnets must not lock the UI. */
const PREVIEW_LIMIT = 256;

// ---------------------------------------------------------------------------
// Mode computations (pure — no hooks, so they're cheap and compiler-friendly)
// ---------------------------------------------------------------------------

function computeSplit(cidr: Ipv4Cidr, countText: string): SplitState {
  const raw = countText.trim();
  if (raw === '') return { kind: 'error', message: 'Enter how many subnets you need.' };
  const n = Number(raw);
  if (!Number.isInteger(n)) {
    return { kind: 'error', message: 'Number of subnets must be a whole number.' };
  }
  const result = splitInto(cidr, n);
  if (!result.ok) return { kind: 'error', message: result.error.message };
  return { kind: 'subnets', subnets: result.value };
}

function computeHosts(cidr: Ipv4Cidr, hostsText: string): HostsState {
  const raw = hostsText.trim();
  if (raw === '') return { kind: 'error', message: 'Enter a minimum host count.' };
  const n = Number(raw);
  if (!Number.isInteger(n)) return { kind: 'error', message: 'Host count must be a whole number.' };
  const result = subnetsForHosts(cidr, n);
  if (!result.ok) return { kind: 'error', message: result.error.message };
  if (result.value.length === 0) {
    return { kind: 'error', message: 'No subnet of that size fits this network.' };
  }
  return { kind: 'result', subnets: result.value, childPrefix: result.value[0].prefixLength };
}

function computeSummarise(text: string): SummariseState {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (lines.length === 0) return { kind: 'error', message: 'Enter one network per line.' };

  const cidrs: Ipv4Cidr[] = [];
  for (const line of lines) {
    const entry = parseV4CidrInput(line);
    if (entry.state !== 'valid') {
      const detail = entry.state === 'error' ? entry.message : 'empty input';
      return { kind: 'error', message: `"${line}": ${detail}` };
    }
    cidrs.push(entry.cidr);
  }
  const result = supernetOf(cidrs);
  if (!result.ok) return { kind: 'error', message: result.error.message };
  return { kind: 'result', supernet: result.value, count: cidrs.length };
}

function SubnetList({ subnets }: { subnets: Ipv4Cidr[] }) {
  const shown = subnets.slice(0, PREVIEW_LIMIT);
  return (
    <Card>
      <SectionTitle>
        {subnets.length} subnet{subnets.length === 1 ? '' : 's'}
      </SectionTitle>
      {shown.map((child, index) => (
        <CopyableValue
          key={cidrToString(child)}
          label={`#${index + 1}`}
          value={cidrToString(child)}
        />
      ))}
      {subnets.length > shown.length && (
        <View style={{ marginTop: 10 }}>
          <Note tone="warn" testID="subnet-truncated">
            Showing the first {PREVIEW_LIMIT} of {subnets.length} subnets. Narrow the base network
            or the count to see the rest.
          </Note>
        </View>
      )}
    </Card>
  );
}

export function CidrCalculatorScreen({ tool }: ToolScreenProps) {
  const [mode, setMode] = useState<Mode>('convert');
  const [input, setInput] = useState('192.168.1.0/24');
  const [count, setCount] = useState('4');
  const [hosts, setHosts] = useState('50');
  const [summariseInput, setSummariseInput] = useState('192.168.0.0/24\n192.168.1.0/24');

  const parsed = parseV4CidrInput(input);

  const splitState: SplitState | null =
    mode === 'split' && parsed.state === 'valid' ? computeSplit(parsed.cidr, count) : null;

  const hostsState: HostsState | null =
    mode === 'hosts' && parsed.state === 'valid' ? computeHosts(parsed.cidr, hosts) : null;

  const summariseState: SummariseState | null =
    mode === 'summarise' ? computeSummarise(summariseInput) : null;

  const inputError = parsed.state === 'error' ? parsed.message : null;
  const historySummary =
    mode === 'convert' && parsed.state === 'valid'
      ? cidrToString(parsed.cidr)
      : mode === 'split' && splitState?.kind === 'subnets'
        ? `${splitState.subnets.length} subnets`
        : mode === 'hosts' && hostsState?.kind === 'result'
          ? `${hostsState.subnets.length} x /${hostsState.childPrefix}`
          : mode === 'summarise' && summariseState?.kind === 'result'
            ? cidrToString(summariseState.supernet)
            : null;

  useCalculatorHistory({
    toolId: 'cidr-calculator',
    input: `${mode}|${input}|${count}|${hosts}|${summariseInput}`,
    summary: historySummary,
    detail: historySummary === null ? null : { mode },
  });

  return (
    <ScrollScreen testID="cidr-screen">
      <ToolHeader title={tool.title} description={tool.description} />

      <Card>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {MODES.map((m) => (
            <Chip
              key={m.id}
              label={m.label}
              selected={mode === m.id}
              onPress={() => setMode(m.id)}
              testID={`mode-${m.id}`}
              radio
            />
          ))}
        </View>

        {mode === 'summarise' ? (
          <Field
            label="Networks (one per line)"
            value={summariseInput}
            onChangeText={setSummariseInput}
            placeholder={'192.168.0.0/24\n192.168.1.0/24'}
            error={summariseState?.kind === 'error' ? summariseState.message : null}
            hint="Returns the tightest single network covering all of them."
            mono
            multiline
            testID="cidr-summarise"
          />
        ) : (
          <>
            <Field
              label="Network"
              value={input}
              onChangeText={setInput}
              placeholder="192.168.1.0/24"
              error={inputError}
              hint="Accepts 192.168.1.0/24 or 192.168.1.0 255.255.255.0"
              mono
              testID="cidr-input"
            />
            <SectionTitle>Examples</SectionTitle>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {EXAMPLES.map((example) => (
                <Chip
                  key={example}
                  label={example}
                  selected={input.trim() === example}
                  onPress={() => setInput(example)}
                  testID={`cidr-example-${example}`}
                />
              ))}
            </View>
          </>
        )}

        {mode === 'split' && (
          <Field
            label="Number of subnets (power of two)"
            value={count}
            onChangeText={setCount}
            placeholder="4"
            hint="1, 2, 4, 8, 16, …"
            testID="cidr-count"
          />
        )}

        {mode === 'hosts' && (
          <Field
            label="Minimum hosts per subnet"
            value={hosts}
            onChangeText={setHosts}
            placeholder="50"
            hint="Each subnet will be the smallest that fits this many hosts."
            testID="cidr-hosts"
          />
        )}
      </Card>

      {parsed.state === 'empty' && mode !== 'summarise' && (
        <Note testID="cidr-empty">Enter a network to get started.</Note>
      )}

      {parsed.state === 'valid' && mode === 'convert' && (
        <Card>
          <SectionTitle>Conversion</SectionTitle>
          <CopyableValue label="CIDR" value={cidrToString(parsed.cidr)} />
          <CopyableValue label="Prefix length" value={`/${parsed.cidr.prefixLength}`} />
          <CopyableValue label="Netmask" value={prefixToMaskV4(parsed.cidr.prefixLength).value} />
          <CopyableValue
            label="Wildcard mask"
            value={wildcardMaskV4(parsed.cidr.prefixLength).value}
          />
          <CopyableValue
            label="Usable hosts"
            value={hostsLabel(usableHostCount(parsed.cidr.prefixLength))}
          />
          <CopyableValue
            label="Addresses in block"
            value={addressesLabel(2 ** (32 - parsed.cidr.prefixLength))}
          />
        </Card>
      )}

      {mode === 'split' && splitState?.kind === 'error' && (
        <Note tone="error" testID="cidr-split-error">
          {splitState.message}
        </Note>
      )}
      {mode === 'split' && splitState?.kind === 'subnets' && (
        <SubnetList subnets={splitState.subnets} />
      )}

      {mode === 'hosts' && hostsState?.kind === 'error' && (
        <Note tone="error" testID="cidr-hosts-error">
          {hostsState.message}
        </Note>
      )}
      {mode === 'hosts' && hostsState?.kind === 'result' && parsed.state === 'valid' && (
        <>
          <Card>
            <SectionTitle>Sizing</SectionTitle>
            <CopyableValue label="Subnet prefix" value={`/${hostsState.childPrefix}`} />
            <CopyableValue
              label="Hosts per subnet"
              value={hostsLabel(usableHostCount(hostsState.childPrefix))}
            />
            <CopyableValue
              label="Subnets that fit"
              value={String(subnetCount(parsed.cidr, hostsState.childPrefix))}
            />
          </Card>
          <SubnetList subnets={hostsState.subnets} />
        </>
      )}

      {mode === 'summarise' && summariseState?.kind === 'result' && (
        <Card>
          <SectionTitle>Summarised network</SectionTitle>
          <CopyableValue label="Supernet" value={cidrToString(summariseState.supernet)} />
          <CopyableValue
            label="Netmask"
            value={prefixToMaskV4(summariseState.supernet.prefixLength).value}
          />
          <CopyableValue label="Networks combined" value={String(summariseState.count)} />
        </Card>
      )}

      <StyledText dim style={{ fontSize: 12 }}>
        Tip: tap any value to copy it.
      </StyledText>
    </ScrollScreen>
  );
}
