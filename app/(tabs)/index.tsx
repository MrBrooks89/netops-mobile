/**
 * Dashboard — the registry-driven tool grid, grouped by category.
 * Adding a tool to TOOL_REGISTRY automatically makes it appear here.
 */

import React from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Card, Screen, StyledText, useTheme } from '../../src/ui/components';
import { toolsByCategory } from '../../src/core/registry/registry';
import { TOOL_CATEGORY_LABELS } from '../../src/core/registry/types';

export default function Dashboard() {
  const { theme } = useTheme();
  const router = useRouter();
  const grouped = toolsByCategory();

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <StyledText style={styles.heading}>NetOps Toolkit</StyledText>
        <StyledText dim style={styles.subheading}>
          Networking tools for engineers, support, and security teams
        </StyledText>
        {[...grouped.entries()].map(([category, tools]) => (
          <Card key={category} style={styles.categoryCard}>
            <StyledText dim style={styles.categoryLabel}>
              {TOOL_CATEGORY_LABELS[category as keyof typeof TOOL_CATEGORY_LABELS] ?? category}
            </StyledText>
            {tools.map((tool) => (
              <Pressable
                key={tool.id}
                onPress={() => router.push(`/tool/${tool.id}`)}
                style={({ pressed }) => [
                  styles.toolRow,
                  pressed && { backgroundColor: theme.colors.surfaceAlt },
                ]}
              >
                <Ionicons
                  name={iconName(tool.icon)}
                  size={22}
                  color={theme.colors.primary}
                  style={styles.toolIcon}
                />
                <StyledText style={styles.toolTitle}>{tool.title}</StyledText>
                <StyledText dim style={styles.toolDesc} numberOfLines={1}>
                  {tool.description}
                </StyledText>
              </Pressable>
            ))}
          </Card>
        ))}
      </ScrollView>
    </Screen>
  );
}

/** Map registry icon names to Ionicons glyphs. */
function iconName(name: string): keyof typeof Ionicons.glyphMap {
  const map: Record<string, keyof typeof Ionicons.glyphMap> = {
    calculator: 'calculator',
    'git-network': 'git-network',
    'swap-horizontal': 'swap-horizontal',
    layers: 'layers',
    list: 'list',
    search: 'search',
    'arrow-undo': 'arrow-undo',
    plug: 'flash', // tcp connect
    pulse: 'pulse',
    grid: 'grid',
    globe: 'globe',
    shield: 'shield',
    radar: 'navigate', // lan discovery
    wifi: 'wifi',
  };
  return map[name] ?? 'cube';
}

const styles = StyleSheet.create({
  content: { paddingBottom: 32 },
  heading: { fontSize: 26, fontWeight: '800' },
  subheading: { fontSize: 13, marginBottom: 16 },
  categoryCard: { paddingTop: 12 },
  categoryLabel: {
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  toolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    paddingHorizontal: 4,
  },
  toolIcon: { marginRight: 12 },
  toolTitle: { fontSize: 15, fontWeight: '600', flexShrink: 0 },
  toolDesc: { fontSize: 12, flex: 1, textAlign: 'right', marginLeft: 12 },
});
