/**
 * Route for a history entry's drill-in view: /run/:id
 */

import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { RunDetailScreen } from '../../src/features/history/RunDetailScreen';
import { Card, Screen, StyledText } from '../../src/ui/components';

export default function RunDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();

  if (typeof id !== 'string' || id === '') {
    return (
      <Screen>
        <Card>
          <StyledText>No history entry was specified.</StyledText>
        </Card>
      </Screen>
    );
  }

  return <RunDetailScreen runId={id} />;
}
