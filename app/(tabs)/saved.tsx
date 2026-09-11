/**
 * Saved tab — hosts & networks CRUD lands in M2.
 */

import React from 'react';
import { Card, Screen, StyledText } from '../../src/ui/components';

export default function Saved() {
  return (
    <Screen>
      <StyledText style={{ fontSize: 22, fontWeight: '800', marginBottom: 12 }}>Saved</StyledText>
      <Card>
        <StyledText dim>
          Saved hosts and networks arrive in Milestone 2 (local SQLite storage).
        </StyledText>
      </Card>
    </Screen>
  );
}
