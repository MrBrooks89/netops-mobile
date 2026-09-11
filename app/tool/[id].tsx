/**
 * Generic tool route — /tool/:id renders whatever ToolModule the registry
 * holds. This is why adding a tool never touches routing code.
 */

import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Card, Screen, StyledText } from '../../src/ui/components';
import { getTool } from '../../src/core/registry/registry';

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
  return <Component tool={tool} />;
}
