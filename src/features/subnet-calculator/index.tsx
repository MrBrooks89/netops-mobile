/**
 * Subnet calculator — IPv4 address + CIDR → full subnet breakdown.
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
import { subnetReport } from '../../core/subnet/subnet';
import { addressesLabel, hostsLabel } from '../../core/util/format';
import { parseV4CidrInput } from '../_shared/input';

const EXAMPLES = [
  '192.168.1.10/24',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '203.0.113.9/26',
  '192.168.1.1/31',
  '10.0.0.7/32',
  '0.0.0.0/0',
];

export function SubnetCalculatorScreen({ tool }: ToolScreenProps) {
  const [input, setInput] = useState('192.168.1.10/24');

  // Derived values are computed inline — the math takes microseconds, and
  // React Compiler memoises the component where it matters.
  const parsed = parseV4CidrInput(input);
  const report = parsed.state === 'valid' ? subnetReport(parsed.cidr) : null;

  return (
    <ScrollScreen testID="subnet-screen">
      <ToolHeader title={tool.title} description={tool.description} />

      <Card>
        <Field
          label="IPv4 address / CIDR"
          value={input}
          onChangeText={setInput}
          placeholder="192.168.1.10/24"
          error={parsed.state === 'error' ? parsed.message : null}
          hint="Accepts 192.168.1.10/24 or 192.168.1.10 255.255.255.0"
          mono
          testID="subnet-input"
        />
        <SectionTitle>Examples</SectionTitle>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {EXAMPLES.map((example) => (
            <Chip
              key={example}
              label={example}
              selected={input.trim() === example}
              onPress={() => setInput(example)}
              testID={`example-${example}`}
            />
          ))}
        </View>
      </Card>

      {parsed.state === 'empty' && (
        <Note testID="subnet-empty">
          Enter an IPv4 address with a prefix length to see the breakdown.
        </Note>
      )}

      {report && (
        <>
          <Card>
            <SectionTitle>Subnet</SectionTitle>
            <CopyableValue label="CIDR" value={report.cidrText} />
            <CopyableValue label="Network address" value={report.networkAddress} />
            <CopyableValue label="Netmask" value={report.netmask} />
            <CopyableValue label="Wildcard mask" value={report.wildcardMask} />
            <CopyableValue label="Broadcast" value={report.broadcastAddress ?? 'none (RFC 3021)'} />
            <CopyableValue label="First host" value={report.firstHost ?? '—'} />
            <CopyableValue label="Last host" value={report.lastHost ?? '—'} />
            <CopyableValue label="Host range" value={report.hostRange ?? '—'} />
          </Card>

          <Card>
            <SectionTitle>Sizing</SectionTitle>
            <CopyableValue label="Usable hosts" value={hostsLabel(report.hostCount)} />
            <CopyableValue label="Total addresses" value={addressesLabel(report.totalAddresses)} />
            <CopyableValue label="IP class (legacy)" value={`Class ${report.classLegacy}`} />
            <CopyableValue label="Scope" value={report.scope} />
          </Card>

          <Card>
            <SectionTitle>Binary</SectionTitle>
            <CopyableValue label="Address (binary)" value={report.binaryView.join('.')} />
            <CopyableValue label="Netmask (binary)" value={report.netmaskBinary.join('.')} />
          </Card>

          {report.notes.length > 0 && (
            <Card>
              <SectionTitle>Notes</SectionTitle>
              {report.notes.map((note) => (
                <Note key={note} tone="info">
                  {note}
                </Note>
              ))}
            </Card>
          )}
        </>
      )}

      {parsed.state === 'valid' && !report && (
        <Note tone="warn" testID="subnet-unexpected">
          Could not build a report for this input.
        </Note>
      )}

      <StyledText dim style={{ fontSize: 12 }}>
        Tip: tap any value to copy it.
      </StyledText>
    </ScrollScreen>
  );
}
