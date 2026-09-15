/**
 * Generic tool route — /tool/:id renders whatever ToolModule the registry
 * holds. This is why adding a tool never touches routing code.
 *
 * A tool whose required capabilities are missing from this build renders the
 * degraded-state card instead of a screen whose every action would fail
 * (plan §6.4) — the case a bare iOS build hits for every native tool (M8).
 */

import React from 'react';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Card, Screen, StyledText } from '../../src/ui/components';
import { getTool } from '../../src/core/registry/registry';
import { CapabilityGate } from '../../src/features/_shared/CapabilityGate';

export default function ToolRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const tool = typeof id === 'string' ? getTool(id) : undefined;

  if (!tool) {
    return (
      <Screen>
        <Card>
          <StyledText style={{ fontWeight: '700' }}>Tool not found</StyledText>
          <StyledText dim>No tool registered with id &quot;{String(id)}&quot;.</StyledText>
        </Card>
      </Screen>
    );
  }

  const Component = tool.Component;
  return (
    <>
      <Stack.Screen options={{ title: tool.title }} />
      <CapabilityGate tool={tool}>
        <Component tool={tool} />
      </CapabilityGate>
    </>
  );
}
