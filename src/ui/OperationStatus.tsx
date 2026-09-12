/**
 * Loading / error / retry presentation for a networked operation.
 *
 * Every networked tool shows the same three states, and the plan's error
 * strategy asks for two audiences at once (§14.3): a plain-language sentence for
 * everyone, plus the raw technical detail for whoever needs it. Doing that in one
 * component keeps the message shape identical across tools.
 */

import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import type { ToolError } from '../core/result/toolError';
import { Button, Note, StyledText, useTheme } from './components';

export function OperationStatus({
  isRunning,
  runningLabel,
  error,
  canRetry,
  onRetry,
}: {
  isRunning: boolean;
  runningLabel: string;
  error: ToolError | null;
  canRetry: boolean;
  onRetry?: () => void;
}) {
  const { theme } = useTheme();

  if (isRunning) {
    return (
      <View
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 }}
        testID="operation-running"
      >
        <ActivityIndicator color={theme.colors.primary} />
        <StyledText dim>{runningLabel}</StyledText>
      </View>
    );
  }

  if (!error) return null;

  return (
    <View testID="operation-error">
      <Note tone="error">{error.message}</Note>
      {error.technical ? (
        <StyledText dim style={{ fontSize: 11, marginBottom: 8 }} testID="operation-technical">
          {error.technical}
        </StyledText>
      ) : null}
      {canRetry && onRetry ? (
        <View style={{ alignItems: 'flex-start', marginBottom: 8 }}>
          <Button
            title="Try again"
            variant="secondary"
            onPress={onRetry}
            testID="operation-retry"
          />
        </View>
      ) : null}
    </View>
  );
}
