/**
 * CopyableValue — one-tap copy for every result value (M1 acceptance).
 *
 * Copying is the single most common action in a subnet calculator: type on
 * the phone, paste into a device. Every value the user might need is
 * therefore rendered through this row.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { StyledText, useTheme } from './primitives';

export function CopyableValue({
  label,
  value,
  mono = true,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
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
    await Clipboard.setStringAsync(value);
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1200);
  }, [value]);

  return (
    <View style={[styles.row, { borderBottomColor: theme.colors.border }]}>
      <StyledText dim style={styles.label}>
        {label}
      </StyledText>
      <View style={styles.valueWrap}>
        <StyledText mono={mono} selectable style={styles.value}>
          {value}
        </StyledText>
        <Pressable
          onPress={onCopy}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={`Copy ${label}`}
          testID={`copy-${label}`}
          style={styles.copyButton}
        >
          <Ionicons
            name={copied ? 'checkmark' : 'copy-outline'}
            size={16}
            color={copied ? theme.colors.success : theme.colors.primary}
          />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  label: { fontSize: 14, flexShrink: 1, paddingRight: 8 },
  valueWrap: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
  value: { fontSize: 14, fontWeight: '600', textAlign: 'right' },
  copyButton: { paddingLeft: 10 },
});
