/**
 * M0 placeholder screen — replaced per-tool by real feature modules (M1+).
 * Renders the registry metadata so the generic route + dashboard are testable.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Card, Screen, StyledText, ValueRow, useTheme } from '../../ui/components';
import type { ToolScreenProps } from '../../core/registry/types';

export function PlaceholderTool({ tool }: ToolScreenProps) {
  const { theme } = useTheme();

  return (
    <Screen>
      <Card>
        <StyledText style={styles.title}>{tool.title}</StyledText>
        <StyledText dim style={styles.desc}>
          {tool.description}
        </StyledText>
      </Card>
      <Card>
        <StyledText dim style={styles.sectionLabel}>
          Implementation pending
        </StyledText>
        <StyledText>
          This tool is registered in the roadmap ({tool.category} category) and arrives in a later
          milestone. The dashboard, routing, and capability gating are already wired.
        </StyledText>
        <View style={styles.spacer} />
        <ValueRow label="Tool id" value={tool.id} />
        <ValueRow label="Category" value={tool.category} />
        <ValueRow
          label="Capabilities"
          value={
            tool.requiredCapabilities.length ? tool.requiredCapabilities.join(', ') : 'none (pure)'
          }
        />
        <ValueRow label="Theme" value={theme.dark ? 'dark' : 'light'} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: '700', marginBottom: 4 },
  desc: { fontSize: 14, marginBottom: 8 },
  sectionLabel: { fontSize: 12, textTransform: 'uppercase', marginBottom: 8, letterSpacing: 0.5 },
  spacer: { height: 8 },
});
