/**
 * Degraded-state primitive (plan §6.4).
 *
 * One card the whole app uses when a tool cannot run on this build — because
 * the native module is absent (a bare iOS build, for example) or because a
 * runtime permission the tool depends on is not granted.
 *
 * This is presentation only: it never asks the platform what is available.
 * The caller decides *why* a tool is unavailable (see
 * `src/features/_shared/CapabilityGate.tsx`) and passes the copy; keeping the
 * detection out of `ui/` is what stops platform checks leaking into
 * presentation code.
 */

import React from 'react';
import { View } from 'react-native';
import { Card, SectionTitle, StyledText } from './primitives';

export type UnavailableKind = 'module' | 'permission';

export function UnavailableState({
  kind,
  title,
  message,
  reasons = [],
  testID,
}: {
  /** `module` = this build lacks the capability; `permission` = the user must grant it. */
  kind: UnavailableKind;
  title: string;
  message: string;
  /** Per-capability lines explaining exactly what is missing. */
  reasons?: readonly string[];
  testID?: string;
}) {
  return (
    <Card testID={testID}>
      <SectionTitle>{title}</SectionTitle>
      <StyledText style={{ fontSize: 13 }}>{message}</StyledText>
      {reasons.length > 0 && (
        <View style={{ marginTop: 8 }}>
          {reasons.map((reason) => (
            <StyledText key={reason} dim style={{ fontSize: 12, marginBottom: 2 }}>
              • {reason}
            </StyledText>
          ))}
        </View>
      )}
      {kind === 'module' && (
        <StyledText dim style={{ fontSize: 11, marginTop: 10 }}>
          Everything that does not need native code still works on this device: the IPv4
          calculators, the ports reference, saved hosts and networks, history, and DNS over HTTPS.
        </StyledText>
      )}
    </Card>
  );
}
