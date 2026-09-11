/**
 * History tab — run history lands in M2 (calculator runs) and M3 (operations).
 */

import React from 'react';
import { Card, Screen, StyledText } from '../../src/ui/components';

export default function History() {
  return (
    <Screen>
      <StyledText style={{ fontSize: 22, fontWeight: '800', marginBottom: 12 }}>History</StyledText>
      <Card>
        <StyledText dim>Scan and calculator history arrives in Milestones 2–3.</StyledText>
      </Card>
    </Screen>
  );
}
