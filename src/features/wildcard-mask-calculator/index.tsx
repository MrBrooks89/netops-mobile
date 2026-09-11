/**
 * Wildcard mask calculator — Cisco-style wildcard masks from a CIDR, a dotted
 * netmask, or a bare prefix length.
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
import { prefixToMaskV4, wildcardMaskV4 } from '../../core/ip/cidr';
import { binaryOctets, usableHostCount } from '../../core/subnet/subnet';
import { hostsLabel } from '../../core/util/format';
import { aclForm, parseWildcardInput } from './parse';

const EXAMPLES = ['/24', '255.255.255.0', '192.168.1.0/24', '255.255.255.252', '/31', '/32', '/0'];

export function WildcardMaskScreen({ tool }: ToolScreenProps) {
  const [input, setInput] = useState('255.255.255.0');

  const parsed = parseWildcardInput(input);
  const prefix = parsed.state === 'valid' ? parsed.prefix : null;

  return (
    <ScrollScreen testID="wildcard-screen">
      <ToolHeader title={tool.title} description={tool.description} />

      <Card>
        <Field
          label="Netmask, CIDR, or prefix"
          value={input}
          onChangeText={setInput}
          placeholder="255.255.255.0"
          error={parsed.state === 'error' ? parsed.message : null}
          hint="Try a netmask (255.255.255.0), a CIDR (192.168.1.0/24), or a prefix (/24)."
          mono
          testID="wildcard-input"
        />
        <SectionTitle>Examples</SectionTitle>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {EXAMPLES.map((example) => (
            <Chip
              key={example}
              label={example}
              selected={input.trim() === example}
              onPress={() => setInput(example)}
              testID={`wildcard-example-${example}`}
            />
          ))}
        </View>
      </Card>

      {parsed.state === 'empty' && (
        <Note testID="wildcard-empty">
          Enter a netmask, CIDR, or prefix length to see the matching wildcard mask.
        </Note>
      )}

      {prefix != null && (
        <>
          <Card>
            <SectionTitle>Masks</SectionTitle>
            <CopyableValue label="Netmask" value={prefixToMaskV4(prefix).value} />
            <CopyableValue label="Wildcard mask" value={wildcardMaskV4(prefix).value} />
            <CopyableValue label="Prefix length" value={`/${prefix}`} />
          </Card>

          <Card>
            <SectionTitle>Access list form</SectionTitle>
            <CopyableValue
              label="ACL wildcard"
              value={aclForm(prefix, wildcardMaskV4(prefix).value)}
            />
            <CopyableValue label="Usable hosts" value={hostsLabel(usableHostCount(prefix))} />
          </Card>

          <Card>
            <SectionTitle>Binary</SectionTitle>
            <CopyableValue
              label="Netmask bits"
              value={binaryOctets(prefixToMaskV4(prefix).int).join('.')}
            />
            <CopyableValue
              label="Wildcard bits"
              value={binaryOctets(wildcardMaskV4(prefix).int).join('.')}
            />
          </Card>
        </>
      )}

      <StyledText dim style={{ fontSize: 12 }}>
        Tip: tap any value to copy it.
      </StyledText>
    </ScrollScreen>
  );
}
