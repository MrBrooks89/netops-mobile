/**
 * IPv6 calculator — an IPv6 address + prefix → the breakdown an engineer
 * actually needs when planning or troubleshooting v6: canonical and expanded
 * forms, network, first/last address, exact block size, scope, and the /64
 * rules that trip people up.
 *
 * The plan promised this tool in §1.1 ("IPv6 subnet/CIDR calculator") and D16
 * ("v6 feature screens M2+"); the core has been address-family-aware since M1,
 * so this screen is thin: parse, call `subnet6Report`, render.
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
import { subnet6Report } from '../../core/subnet/subnet6';
import { parseV6CidrInput } from '../_shared/input';
import { useCalculatorHistory } from '../_shared/useCalculatorHistory';

const EXAMPLES = [
  '2001:db8::1/64',
  '2001:db8:abcd:12::/64',
  'fd12:3456:789a::/48',
  'fe80::1/64',
  '64:ff9b::192.0.2.33/96',
  '::/0',
];

/**
 * Prefix presets applied to the address currently typed. These are the lengths
 * that come up in IPv6 planning: /48 site, /56 and /64 subnets, /112 and /127
 * links, /128 host route.
 */
const PREFIX_PRESETS = [48, 56, 64, 112, 127, 128] as const;

/** Replace the prefix of whatever address is in the field. */
function withPrefix(input: string, prefix: number): string {
  const address = input.trim().split('/')[0];
  return `${address}/${prefix}`;
}

export function Ipv6CalculatorScreen({ tool }: ToolScreenProps) {
  const [input, setInput] = useState('2001:db8:abcd:12::1/64');

  const parsed = parseV6CidrInput(input);
  const report = parsed.state === 'valid' ? subnet6Report(parsed.cidr) : null;

  useCalculatorHistory({
    toolId: 'ipv6-calculator',
    input,
    summary: report ? report.cidrText : null,
    detail: report,
  });

  return (
    <ScrollScreen testID="ipv6-screen">
      <ToolHeader title={tool.title} description={tool.description} />

      <Card>
        <Field
          label="IPv6 address / prefix"
          value={input}
          onChangeText={setInput}
          placeholder="2001:db8:abcd:12::1/64"
          error={parsed.state === 'error' ? parsed.message : null}
          hint="Accepts 2001:db8::1/64 (compressed or expanded), or a bare address: the prefix then defaults to /64"
          mono
          testID="ipv6-input"
        />

        <SectionTitle>Prefix</SectionTitle>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {PREFIX_PRESETS.map((prefix) => (
            <Chip
              key={prefix}
              label={`/${prefix}`}
              selected={parsed.state === 'valid' && parsed.cidr.prefixLength === prefix}
              onPress={() => setInput((current) => withPrefix(current, prefix))}
              testID={`ipv6-prefix-${prefix}`}
            />
          ))}
        </View>

        <SectionTitle>Examples</SectionTitle>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {EXAMPLES.map((example) => (
            <Chip
              key={example}
              label={example}
              selected={input.trim() === example}
              onPress={() => setInput(example)}
              testID={`ipv6-example-${example}`}
            />
          ))}
        </View>
      </Card>

      {parsed.state === 'empty' && (
        <Note testID="ipv6-empty">
          Enter an IPv6 address with a prefix length to see the breakdown.
        </Note>
      )}

      {report && (
        <>
          <Card>
            <SectionTitle>Network</SectionTitle>
            <CopyableValue label="CIDR" value={report.cidrText} />
            <CopyableValue label="Network address" value={report.networkAddress} />
            <CopyableValue label="Last address" value={report.lastAddress} />
            <CopyableValue label="Prefix mask" value={report.prefixMask} />
          </Card>

          <Card>
            <SectionTitle>Sizing</SectionTitle>
            {/* One row, not two: the count form is already adaptive
                (grouped digits up to 2^64-ish, 2^n beyond that), so a separate
                "exact" row would just print the same string again. */}
            <CopyableValue label="Addresses in block" value={report.addressCountText} />
            <CopyableValue label="Scope" value={report.scope} />
          </Card>

          <Card>
            <SectionTitle>Forms</SectionTitle>
            <CopyableValue label="Canonical (RFC 5952)" value={report.address} />
            <CopyableValue label="Expanded" value={report.expanded} />
            <CopyableValue label="Binary (8 × 16 bits)" value={report.binaryView.join(' ')} />
          </Card>

          {report.notes.length > 0 && (
            <Card>
              <SectionTitle>Notes</SectionTitle>
              {report.notes.map((note) => (
                <Note key={note} tone="info" testID="ipv6-note">
                  {note}
                </Note>
              ))}
            </Card>
          )}
        </>
      )}

      <StyledText dim style={{ fontSize: 12 }}>
        Tip: tap any value to copy it. IPv6 has no broadcast address and no netmask notation — the
        prefix length is the whole story.
      </StyledText>
    </ScrollScreen>
  );
}
