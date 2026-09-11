/**
 * Ports reference — searchable list of common TCP/UDP ports.
 *
 * Search matches port number (exact first, then prefix), service name, and
 * description, and accepts protocol tokens ("udp 53"). Rows come from the
 * database (seeded from the bundled dataset at startup) while ranking stays in
 * core/ports, so there is still one owner for "what a good match looks like".
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import {
  Card,
  Chip,
  Field,
  Note,
  Screen,
  SectionTitle,
  StyledText,
  ToolHeader,
  useTheme,
} from '../../ui/components';
import { useAppData } from '../../../src/providers/AppProviders';
import type { ToolScreenProps } from '../../core/registry/types';
import { portStats, searchPorts, type PortEntry, type PortProto } from '../../core/ports/ports';
import { groupDigits } from '../../core/util/format';

type ProtoFilter = 'all' | PortProto;

const FILTERS: { id: ProtoFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'tcp', label: 'TCP' },
  { id: 'udp', label: 'UDP' },
];

export function PortsReferenceScreen({ tool }: ToolScreenProps) {
  const data = useAppData();
  const [query, setQuery] = useState('');
  const [proto, setProto] = useState<ProtoFilter>('all');
  const [entries, setEntries] = useState<readonly PortEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // The database is the source of truth (seeded from the bundled dataset at
  // startup); ranking stays in core/ports, and filtering runs against the
  // loaded rows so typing stays synchronous.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await data.ports.search('');
      if (cancelled) return;
      if (result.ok) setEntries(result.value);
      else setLoadError(result.error.message);
    })();
    return () => {
      cancelled = true;
    };
  }, [data]);

  const results = entries === null ? [] : searchPorts(query, { proto, entries });
  const stats = portStats(entries ?? []);

  return (
    <Screen testID="ports-screen">
      <ToolHeader title={tool.title} description={tool.description} />

      {loadError && (
        <Note tone="error" testID="ports-load-error">
          {loadError}
        </Note>
      )}

      <Card>
        <Field
          label="Search"
          value={query}
          onChangeText={setQuery}
          placeholder="443, ssh, udp 53…"
          hint={
            entries === null
              ? 'Loading the port reference…'
              : `${groupDigits(stats.total)} ports · ${groupDigits(stats.tcp)} TCP · ${groupDigits(stats.udp)} UDP`
          }
          testID="ports-search"
        />
        <SectionTitle>Protocol</SectionTitle>
        <View style={styles.filters}>
          {FILTERS.map((filter) => (
            <Chip
              key={filter.id}
              label={filter.label}
              selected={proto === filter.id}
              onPress={() => setProto(filter.id)}
              testID={`ports-filter-${filter.id}`}
            />
          ))}
        </View>
      </Card>

      <View style={styles.resultHeader}>
        <SectionTitle>{`${results.length} result${results.length === 1 ? '' : 's'}`}</SectionTitle>
        {results.length > 0 && (
          <StyledText dim style={styles.resultHint}>
            Tap a row to copy the port number.
          </StyledText>
        )}
      </View>

      {results.length === 0 ? (
        <Note testID="ports-empty">
          No ports match “{query.trim()}”. Try a port number, a service name, or a protocol.
        </Note>
      ) : (
        <FlatList
          testID="ports-list"
          data={results}
          keyExtractor={(entry) => `${entry.port}/${entry.proto}`}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={20}
          windowSize={10}
          renderItem={({ item }) => <PortRow entry={item} />}
          ListFooterComponent={
            <StyledText dim style={styles.footer}>
              Curated list of common ports — not the full IANA registry.
            </StyledText>
          }
        />
      )}
    </Screen>
  );
}

function PortRow({ entry }: { entry: PortEntry }) {
  const { theme } = useTheme();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const onCopy = useCallback(async () => {
    await Clipboard.setStringAsync(String(entry.port));
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1200);
  }, [entry.port]);

  return (
    <Pressable
      onPress={onCopy}
      accessibilityRole="button"
      accessibilityLabel={`Copy port ${entry.port}`}
      testID={`port-row-${entry.port}-${entry.proto}`}
      style={({ pressed }) => [
        styles.portRow,
        {
          borderBottomColor: theme.colors.border,
          backgroundColor: pressed ? theme.colors.surfaceAlt : 'transparent',
        },
      ]}
    >
      <View style={styles.portNumber}>
        <StyledText mono style={styles.portText}>
          {entry.port}
        </StyledText>
        <StyledText
          mono
          style={[
            styles.protoTag,
            {
              color: entry.proto === 'tcp' ? theme.colors.primary : theme.colors.warning,
              borderColor: entry.proto === 'tcp' ? theme.colors.primary : theme.colors.warning,
            },
          ]}
        >
          {entry.proto}
        </StyledText>
      </View>
      <View style={styles.portBody}>
        <StyledText style={styles.service}>{entry.service}</StyledText>
        <StyledText dim style={styles.description} numberOfLines={2}>
          {entry.description}
        </StyledText>
      </View>
      <Ionicons
        name={copied ? 'checkmark' : 'copy-outline'}
        size={16}
        color={copied ? theme.colors.success : theme.colors.textFaint}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', flexWrap: 'wrap' },
  resultHeader: { marginTop: 4 },
  resultHint: { fontSize: 12, marginBottom: 6 },
  portRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  portNumber: { width: 74, alignItems: 'flex-start' },
  portText: { fontSize: 16, fontWeight: '700' },
  protoTag: {
    fontSize: 10,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 4,
    marginTop: 2,
  },
  portBody: { flex: 1 },
  service: { fontSize: 15, fontWeight: '600' },
  description: { fontSize: 13, marginTop: 2 },
  footer: { fontSize: 12, paddingVertical: 14, textAlign: 'center' },
});
