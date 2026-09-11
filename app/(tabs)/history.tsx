/**
 * History tab — recorded calculator runs, with per-item delete, clear-all and
 * export through the share sheet.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import type { RunRecord } from '../../src/core/model/entities';
import { getTool } from '../../src/core/registry/registry';
import { exportRunHistory, type ExportFormat } from '../../src/data/export/codecs';
import { shareExport } from '../../src/data/export/share';
import { useAppData, useAppSettings } from '../../src/providers/AppProviders';
import {
  Button,
  Card,
  Chip,
  Note,
  ScrollScreen,
  SectionTitle,
  StyledText,
  ToolHeader,
} from '../../src/ui/components';

const FORMATS: readonly ExportFormat[] = ['json', 'csv', 'text'];
/** Display cap: history may hold thousands of runs; the list shows the newest. */
const DISPLAY_LIMIT = 200;

const toolTitle = (toolId: string): string => getTool(toolId)?.title ?? toolId;

const formatWhen = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.toISOString().replace('T', ' ').slice(0, 19)}Z`;
};

export default function HistoryTab() {
  const data = useAppData();
  const { settings } = useAppSettings();
  const [runs, setRuns] = useState<readonly RunRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [list, count] = await Promise.all([
      data.runs.list({ limit: DISPLAY_LIMIT }),
      data.runs.count(),
    ]);
    if (list.ok) setRuns(list.value);
    else setMessage(list.error.message);
    if (count.ok) setTotal(count.value);
  }, [data]);

  // Load-on-mount effect. React Query (M3, plan 12) replaces this pattern for
  // networked operations; until then a screen-scoped load is the simplest
  // correct option, and the state updates happen after `await`.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load-on-mount; React Query replaces this pattern in M3 (plan §12)
    void reload();
  }, [reload]);

  const share = useCallback(
    async (format: ExportFormat) => {
      const file = exportRunHistory(runs, format);
      const result = await shareExport(file);
      setMessage(result.ok ? `Shared ${file.filename}` : result.error.message);
    },
    [runs],
  );

  const remove = (run: RunRecord) => {
    Alert.alert('Delete entry', `Delete “${run.summary}”?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const result = await data.runs.remove(run.id);
          if (!result.ok) setMessage(result.error.message);
          await reload();
        },
      },
    ]);
  };

  const clearAll = () => {
    Alert.alert('Clear history', `Delete all ${total} entries?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete all',
        style: 'destructive',
        onPress: async () => {
          const result = await data.runs.clear();
          if (!result.ok) setMessage(result.error.message);
          await reload();
        },
      },
    ]);
  };

  return (
    <ScrollScreen testID="history-screen">
      <ToolHeader
        title="History"
        description={`Calculator runs recorded on this device (${total})`}
      />

      {!settings.historyEnabled && (
        <Note tone="warn" testID="history-disabled">
          Recording is off, so new runs will not appear. Turn it on in Settings.
        </Note>
      )}

      {message && <Note testID="history-message">{message}</Note>}

      {runs.length === 0 ? (
        <Card>
          <StyledText dim testID="history-empty">
            No runs yet. Calculator results are recorded here once you have a valid input.
          </StyledText>
        </Card>
      ) : (
        <>
          <Card>
            <SectionTitle>Export ({runs.length} shown)</SectionTitle>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {FORMATS.map((format) => (
                <Chip
                  key={format}
                  label={format.toUpperCase()}
                  onPress={() => void share(format)}
                  testID={`history-export-${format}`}
                />
              ))}
            </View>
          </Card>

          {runs.map((run) => (
            <Card key={run.id}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <StyledText style={{ fontWeight: '700', flex: 1 }}>
                  {toolTitle(run.toolId)}
                </StyledText>
                <StyledText mono dim style={{ fontSize: 11 }}>
                  {run.status}
                </StyledText>
              </View>
              <StyledText mono style={{ marginTop: 4 }}>
                {run.summary}
              </StyledText>
              <StyledText dim style={{ fontSize: 12, marginTop: 4 }}>
                {formatWhen(run.startedAt)}
                {run.errorMessage ? ` — ${run.errorMessage}` : ''}
              </StyledText>
              <View style={{ marginTop: 10, alignItems: 'flex-start' }}>
                <Button
                  title="Delete"
                  variant="danger"
                  onPress={() => remove(run)}
                  testID={`history-delete-${run.id}`}
                />
              </View>
            </Card>
          ))}

          {total > runs.length && (
            <Note tone="info">
              Showing the newest {runs.length} of {total} runs. Export includes only what is shown.
            </Note>
          )}

          <View style={{ marginTop: 4 }}>
            <Button
              title={`Clear all history (${total})`}
              variant="danger"
              onPress={clearAll}
              testID="history-clear"
            />
          </View>
        </>
      )}
    </ScrollScreen>
  );
}
