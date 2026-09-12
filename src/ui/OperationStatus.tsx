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
// Direct imports (not the ./components barrel): OperationStatus is re-exported
// by that barrel, so importing from it creates a require cycle.
import { Button } from './components/inputs';
import { Note, StyledText, useTheme } from './components/primitives';

export function OperationStatus({
  isRunning,
  runningLabel,
  error,
  canRetry,
  onRetry,
  onCancel,
}: {
  isRunning: boolean;
  runningLabel: string;
  error: ToolError | null;
  canRetry: boolean;
  onRetry?: () => void;
  /** Abort the in-flight request. Pass the operation's `cancel`. */
  onCancel?: () => void;
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
        {onCancel ? (
          <View style={{ marginLeft: 'auto' }}>
            <Button
              title="Cancel"
              variant="secondary"
              onPress={onCancel}
              testID="operation-cancel"
            />
          </View>
        ) : null}
      </View>
    );
  }

  // A cancellation is a user action, not a failure — by design the UI stays
  // silent about it (the abort mapping in platform/http exists for this).
  if (!error || error.code === 'CANCELLED') return null;

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
