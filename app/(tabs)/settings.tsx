/**
 * Settings tab — theme, history recording, retention and local-data controls.
 */

import React, { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Alert, View } from 'react-native';
import type { ThemePreference } from '../../src/core/model/settings';
import { DOH_PROVIDERS, type DohProviderId } from '../../src/core/dns/types';
import { describeProvider, parseCustomDohUrl } from '../../src/core/dns/provider';
import {
  DEFAULT_HISTORY_RETENTION,
  RETENTION_MAX,
  RETENTION_MIN,
} from '../../src/data/settings/appSettings';
import { useAppData, useAppSettings } from '../../src/providers/AppProviders';
import {
  Button,
  Card,
  Chip,
  Field,
  Note,
  ScrollScreen,
  SectionTitle,
  StyledText,
  ToolHeader,
  ValueRow,
} from '../../src/ui/components';

const THEMES: readonly { id: ThemePreference; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

const RETENTION_CHOICES: readonly number[] = [
  100,
  250,
  DEFAULT_HISTORY_RETENTION,
  1000,
  RETENTION_MAX,
];

const DOH_CHOICES: readonly { id: DohProviderId; label: string }[] = [
  { id: 'cloudflare', label: DOH_PROVIDERS.cloudflare.label },
  { id: 'google', label: DOH_PROVIDERS.google.label },
  { id: 'custom', label: 'Custom' },
];

export default function SettingsTab() {
  const data = useAppData();
  const { settings, updateSettings } = useAppSettings();
  const [counts, setCounts] = useState({ hosts: 0, networks: 0, runs: 0, ports: 0 });
  const [message, setMessage] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [hosts, networks, runs, ports] = await Promise.all([
      data.hosts.count(),
      data.networks.count(),
      data.runs.count(),
      data.ports.count(),
    ]);
    setCounts({
      hosts: hosts.ok ? hosts.value : 0,
      networks: networks.ok ? networks.value : 0,
      runs: runs.ok ? runs.value : 0,
      ports: ports.ok ? ports.value : 0,
    });
  }, [data]);

  // Reload whenever the tab regains focus: history is written by the
  // calculator screens and saved items can change from elsewhere, so a
  // mount-only load would show stale data.
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const purgeHistory = () => {
    Alert.alert('Clear history', `Delete all ${counts.runs} recorded runs?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete all',
        style: 'destructive',
        onPress: async () => {
          const result = await data.runs.clear();
          setMessage(result.ok ? `Deleted ${result.value} runs.` : result.error.message);
          await reload();
        },
      },
    ]);
  };

  return (
    <ScrollScreen testID="settings-screen">
      <ToolHeader title="Settings" description="Appearance, history and local data" />

      {message && <Note testID="settings-message">{message}</Note>}

      <Card>
        <SectionTitle>Appearance</SectionTitle>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {THEMES.map((theme) => (
            <Chip
              key={theme.id}
              label={theme.label}
              selected={settings.theme === theme.id}
              onPress={() => updateSettings({ theme: theme.id })}
              testID={`theme-${theme.id}`}
              radio
            />
          ))}
        </View>
        <StyledText dim style={{ fontSize: 12 }}>
          System follows your device&apos;s light or dark setting.
        </StyledText>
      </Card>

      <Card>
        <SectionTitle>DNS resolver</SectionTitle>
        <StyledText dim style={{ fontSize: 13, marginBottom: 8 }}>
          Lookups use DNS over HTTPS, so they bypass the system resolver on this device. Where your
          queries go is your choice.
        </StyledText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {DOH_CHOICES.map((choice) => (
            <Chip
              key={choice.id}
              label={choice.label}
              selected={settings.dohProvider === choice.id}
              onPress={() => updateSettings({ dohProvider: choice.id })}
              testID={`doh-${choice.id}`}
              radio
            />
          ))}
        </View>

        {settings.dohProvider === 'custom' && (
          <Field
            label="Custom endpoint"
            value={settings.customDohUrl}
            onChangeText={(customDohUrl) => updateSettings({ customDohUrl })}
            placeholder="https://dns.example/dns-query"
            error={
              settings.customDohUrl.trim() === ''
                ? null
                : parseCustomDohUrl(settings.customDohUrl).ok
                  ? null
                  : 'Enter an https:// URL that speaks the DoH JSON format.'
            }
            hint="Must be https:// and follow the Cloudflare/Google JSON convention."
            mono
            testID="doh-custom-url"
          />
        )}

        <StyledText dim style={{ fontSize: 12 }}>
          Currently using {describeProvider(settings.dohProvider, settings.customDohUrl)}. New
          lookups use this immediately.
        </StyledText>
      </Card>

      <Card>
        <SectionTitle>History</SectionTitle>
        <StyledText dim style={{ fontSize: 13, marginBottom: 8 }}>
          Tool runs are recorded locally on this device. Nothing leaves the device.
        </StyledText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          <Chip
            label="Recording on"
            selected={settings.historyEnabled}
            onPress={() => updateSettings({ historyEnabled: true })}
            testID="history-toggle-on"
            radio
          />
          <Chip
            label="Recording off"
            selected={!settings.historyEnabled}
            onPress={() => updateSettings({ historyEnabled: false })}
            testID="history-toggle-off"
            radio
          />
        </View>

        <SectionTitle>Keep at most</SectionTitle>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {RETENTION_CHOICES.map((limit) => (
            <Chip
              key={limit}
              label={String(limit)}
              selected={settings.historyRetentionLimit === limit}
              onPress={() => updateSettings({ historyRetentionLimit: limit })}
              testID={`retention-${limit}`}
              radio
            />
          ))}
        </View>
        <StyledText dim style={{ fontSize: 12, marginBottom: 10 }}>
          Older runs are pruned automatically ({RETENTION_MIN}–{RETENTION_MAX}).
        </StyledText>

        <View style={{ alignItems: 'flex-start' }}>
          <Button
            title="Clear history now"
            variant="danger"
            onPress={purgeHistory}
            disabled={counts.runs === 0}
            testID="settings-clear-history"
          />
        </View>
      </Card>

      <Card>
        <SectionTitle>Stored on this device</SectionTitle>
        <ValueRow label="Saved hosts" value={String(counts.hosts)} testID="settings-count-hosts" />
        <ValueRow
          label="Saved networks"
          value={String(counts.networks)}
          testID="settings-count-networks"
        />
        <ValueRow
          label="History entries"
          value={String(counts.runs)}
          testID="settings-count-runs"
        />
        <ValueRow
          label="Ports reference"
          value={String(counts.ports)}
          testID="settings-count-ports"
        />
      </Card>

      <Card>
        <SectionTitle>About</SectionTitle>
        <ValueRow label="App" value="NetOps Mobile" />
        <ValueRow label="Milestone" value="M2 — persistence" />
        <StyledText dim style={{ fontSize: 12, marginTop: 8 }}>
          All data stays on this device. There are no accounts and no telemetry.
        </StyledText>
      </Card>
    </ScrollScreen>
  );
}
