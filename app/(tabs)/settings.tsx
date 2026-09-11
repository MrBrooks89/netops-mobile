/**
 * Settings tab — theme, DoH provider, timeouts, retention (M2+).
 */

import React from 'react';
import { Card, Screen, StyledText } from '../../src/ui/components';

export default function Settings() {
  return (
    <Screen>
      <StyledText style={{ fontSize: 22, fontWeight: '800', marginBottom: 12 }}>
        Settings
      </StyledText>
      <Card>
        <StyledText dim>
          Settings (theme, DoH provider, timeouts, history retention) arrive in Milestone 2.
        </StyledText>
      </Card>
    </Screen>
  );
}
