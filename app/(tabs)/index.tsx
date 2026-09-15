/**
 * Dashboard — pinned favorites, recently used tools, and the registry-driven
 * tool grid grouped by category.
 *
 * Everything here renders from the registry plus two persisted inputs: starred
 * tool ids in settings and the newest runs in history. Adding a tool to
 * TOOL_REGISTRY still requires no change in this file.
 */

import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, Screen, StyledText, useTheme } from '../../src/ui/components';
import { getTool, toolsByCategory } from '../../src/core/registry/registry';
import { TOOL_CATEGORY_LABELS, type ToolModule } from '../../src/core/registry/types';
import { useAppData, useAppSettings } from '../../src/providers/AppProviders';
import { isToolAvailable } from '../../src/features/_shared/CapabilityGate';
import { getCapabilities } from '../../src/platform/registry';

/** Distinct tools shown in the Recent section. */
const RECENT_LIMIT = 5;
/**
 * Newest runs scanned for those. One query, mapped in memory: 200 is far more
 * than a five-tool list needs, and the cap keeps the dashboard cheap when
 * history holds thousands of runs.
 */
const RECENT_SCAN_LIMIT = 200;

/** Registry lookup that silently drops ids this build no longer ships. */
const resolveTools = (ids: readonly string[]): readonly ToolModule[] =>
  ids.map((id) => getTool(id)).filter((tool): tool is ToolModule => tool !== undefined);

export default function Dashboard() {
  const router = useRouter();
  const data = useAppData();
  const { settings, updateSettings } = useAppSettings();
  const [recentToolIds, setRecentToolIds] = useState<readonly string[]>([]);
  const grouped = toolsByCategory();
  // One capability snapshot for the whole list (each row asks it the same
  // question, and the map is rebuilt on every call).
  const available = getCapabilities();

  // Recent is derived from persisted runs, so it reloads whenever the tab
  // regains focus: running a tool from here and coming back must update it.
  const reloadRecent = useCallback(() => {
    const result = data.runs.list({ limit: RECENT_SCAN_LIMIT });
    if (!result.ok) return;
    const seen: string[] = [];
    for (const run of result.value) {
      if (seen.includes(run.toolId) || !getTool(run.toolId)) continue;
      seen.push(run.toolId);
      if (seen.length === RECENT_LIMIT) break;
    }
    setRecentToolIds(seen);
  }, [data]);

  useFocusEffect(
    useCallback(() => {
      reloadRecent();
    }, [reloadRecent]),
  );

  const favorites = resolveTools(settings.favoriteToolIds);
  const recents = resolveTools(recentToolIds);

  const toggleFavorite = (id: string) => {
    const current = settings.favoriteToolIds;
    updateSettings({
      favoriteToolIds: current.includes(id)
        ? current.filter((entry) => entry !== id)
        : [...current, id],
    });
  };

  const row = (tool: ToolModule, section: 'favorite' | 'recent' | 'browse') => (
    <ToolRow
      key={tool.id}
      tool={tool}
      section={section}
      favorite={settings.favoriteToolIds.includes(tool.id)}
      unavailable={!isToolAvailable(tool, available)}
      onOpen={() => router.push(`/tool/${tool.id}`)}
      onToggleFavorite={toggleFavorite}
    />
  );

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <StyledText style={styles.heading}>NetOps Toolkit</StyledText>
        <StyledText dim style={styles.subheading}>
          Networking tools for engineers, support, and security teams
        </StyledText>

        {!settings.onboardingDismissed && (
          <Card testID="onboarding-card">
            <StyledText style={styles.onboardingTitle}>Before you start</StyledText>
            <StyledText style={styles.onboardingLine}>
              Use these tools only on networks you own or have permission to test.
            </StyledText>
            <StyledText dim style={styles.onboardingLine}>
              Results stay on this device. No accounts, no telemetry.
            </StyledText>
            <StyledText dim style={styles.onboardingLine}>
              Tap the star beside any tool to pin it to the top.
            </StyledText>
            <View style={styles.onboardingAction}>
              <Button
                title="Got it"
                onPress={() => updateSettings({ onboardingDismissed: true })}
                testID="onboarding-dismiss"
              />
            </View>
          </Card>
        )}

        {favorites.length > 0 && (
          <Card testID="favorites-card">
            <StyledText dim style={styles.categoryLabel}>
              Favorites
            </StyledText>
            {favorites.map((tool) => row(tool, 'favorite'))}
          </Card>
        )}

        {recents.length > 0 && (
          <Card testID="recent-card">
            <StyledText dim style={styles.categoryLabel}>
              Recent
            </StyledText>
            {recents.map((tool) => row(tool, 'recent'))}
          </Card>
        )}

        {[...grouped.entries()].map(([category, tools]) => (
          <Card key={category} style={styles.categoryCard}>
            <StyledText dim style={styles.categoryLabel}>
              {TOOL_CATEGORY_LABELS[category as keyof typeof TOOL_CATEGORY_LABELS] ?? category}
            </StyledText>
            {tools.map((tool) => row(tool, 'browse'))}
          </Card>
        ))}
      </ScrollView>
    </Screen>
  );
}

/**
 * One dashboard row: the tool itself plus its pin toggle. The star is a sibling
 * of the row's touch target rather than a child, so a press can only mean one
 * thing and each target keeps its own accessibility label.
 */
function ToolRow({
  tool,
  section,
  favorite,
  unavailable,
  onOpen,
  onToggleFavorite,
}: {
  tool: ToolModule;
  /** Where the row is rendered; keeps testIDs unique when a tool is listed twice. */
  section: 'favorite' | 'recent' | 'browse';
  favorite: boolean;
  /** This build lacks a capability the tool declares (plan §6.4). */
  unavailable: boolean;
  onOpen: () => void;
  onToggleFavorite: (id: string) => void;
}) {
  const { theme } = useTheme();
  return (
    <View style={styles.toolRow}>
      <Pressable
        onPress={onOpen}
        testID={`${section}-row-${tool.id}`}
        style={({ pressed }) => [
          styles.toolMain,
          pressed && { backgroundColor: theme.colors.surfaceAlt },
        ]}
      >
        <Ionicons
          name={iconName(tool.icon)}
          size={22}
          color={theme.colors.primary}
          style={styles.toolIcon}
        />
        <StyledText style={[styles.toolTitle, unavailable && { color: theme.colors.textDim }]}>
          {tool.title}
        </StyledText>
        {unavailable ? (
          <StyledText
            dim
            style={styles.toolDesc}
            numberOfLines={1}
            testID={`${section}-unavailable-${tool.id}`}
          >
            Not available in this build
          </StyledText>
        ) : (
          <StyledText dim style={styles.toolDesc} numberOfLines={1}>
            {tool.description}
          </StyledText>
        )}
      </Pressable>
      <Pressable
        onPress={() => onToggleFavorite(tool.id)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityState={{ selected: favorite }}
        accessibilityLabel={
          favorite ? `Remove ${tool.title} from favorites` : `Add ${tool.title} to favorites`
        }
        testID={`${section}-star-${tool.id}`}
        style={({ pressed }) => [styles.star, pressed && { opacity: 0.6 }]}
      >
        <Ionicons
          name={favorite ? 'star' : 'star-outline'}
          size={20}
          color={favorite ? theme.colors.warning : theme.colors.textDim}
        />
      </Pressable>
    </View>
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
  onboardingTitle: { fontSize: 15, fontWeight: '700', marginBottom: 6 },
  onboardingLine: { fontSize: 13, marginBottom: 4 },
  onboardingAction: { alignItems: 'flex-start', marginTop: 10 },
  categoryCard: { paddingTop: 12 },
  categoryLabel: {
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  toolRow: { flexDirection: 'row', alignItems: 'center' },
  toolMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    paddingHorizontal: 4,
  },
  toolIcon: { marginRight: 12 },
  toolTitle: { fontSize: 15, fontWeight: '600', flexShrink: 0 },
  toolDesc: { fontSize: 12, flex: 1, textAlign: 'right', marginLeft: 12 },
  star: { padding: 6, marginLeft: 4 },
});
