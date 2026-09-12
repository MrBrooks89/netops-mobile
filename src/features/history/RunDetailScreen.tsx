/**
 * Run detail — the drill-in view for a history entry.
 *
 * Shows the recorded input and detail payloads (pretty-printed), the outcome,
 * timings and the full error when there was one. This is the "engineer" half of
 * the two-audience rule: the history list gives a summary, this gives everything
 * that was stored.
 */

import React from 'react';
import { Alert, View } from 'react-native';
import { router, Stack } from 'expo-router';
import {
  Button,
  Card,
  CopyableValue,
  Note,
  Screen,
  ScrollScreen,
  SectionTitle,
  StyledText,
  useTheme,
} from '../../ui/components';
import type { RunRecord } from '../../core/model/entities';
import { getTool } from '../../core/registry/registry';
import { useAppData } from '../../providers/AppProviders';

const prettyJson = (value: unknown): string => {
  if (value === null || value === undefined) return '—';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const formatTimestamp = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toISOString().replace('T', ' ').slice(0, 23);
};

export function RunDetailScreen({ runId }: { runId: string }) {
  const data = useAppData();
  const { theme } = useTheme();

  // Reads are synchronous, so the entry is available during render.
  const result = data.runs.get(runId);
  const run: RunRecord | null = result.ok ? result.value : null;

  const remove = () => {
    Alert.alert('Delete entry', 'Delete this history entry?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          data.runs.remove(runId);
          if (router.canGoBack()) router.back();
          else router.replace('/history');
        },
      },
    ]);
  };

  if (!result.ok) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Run detail' }} />
        <Note tone="error" testID="run-error">
          {result.error.message}
        </Note>
      </Screen>
    );
  }

  if (!run) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Run detail' }} />
        <Card>
          <StyledText testID="run-missing">
            That history entry is no longer stored. It may have been purged by the retention limit.
          </StyledText>
        </Card>
      </Screen>
    );
  }

  const tool = getTool(run.toolId);

  return (
    <ScrollScreen testID="run-detail-screen">
      <Stack.Screen options={{ title: 'Run detail' }} />

      <Card>
        <SectionTitle>Outcome</SectionTitle>
        <CopyableValue label="Tool" value={tool?.title ?? run.toolId} />
        <CopyableValue label="Status" value={run.status} />
        <CopyableValue label="Summary" value={run.summary} mono={false} />
        <CopyableValue label="Started" value={formatTimestamp(run.startedAt)} mono={false} />
        <CopyableValue
          label="Finished"
          value={run.finishedAt ? formatTimestamp(run.finishedAt) : '—'}
          mono={false}
        />
        <CopyableValue
          label="Duration"
          value={run.durationMs === null ? '—' : `${run.durationMs} ms`}
        />
      </Card>

      {run.errorCode || run.errorMessage ? (
        <Card>
          <SectionTitle>Error</SectionTitle>
          <Note tone="error">{run.errorMessage ?? 'The run failed.'}</Note>
          {run.errorCode ? <CopyableValue label="Error code" value={run.errorCode} /> : null}
        </Card>
      ) : null}

      <Card>
        <SectionTitle>Input</SectionTitle>
        <StyledText
          mono
          selectable
          testID="run-input"
          style={{
            fontSize: 12,
            color: theme.colors.textDim,
            backgroundColor: theme.colors.surfaceAlt,
            padding: 10,
            borderRadius: 6,
          }}
        >
          {prettyJson(run.input)}
        </StyledText>
      </Card>

      <Card>
        <SectionTitle>Detail</SectionTitle>
        <StyledText
          mono
          selectable
          testID="run-detail"
          style={{
            fontSize: 12,
            color: theme.colors.textDim,
            backgroundColor: theme.colors.surfaceAlt,
            padding: 10,
            borderRadius: 6,
          }}
        >
          {prettyJson(run.detail)}
        </StyledText>
      </Card>

      <View style={{ alignItems: 'flex-start' }}>
        <Button title="Delete entry" variant="danger" onPress={remove} testID="run-delete" />
      </View>
    </ScrollScreen>
  );
}
