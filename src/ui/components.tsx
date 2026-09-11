/**
 * UI primitives — the entire app renders through these so a future design
 * overhaul (or Paper swap, D6) never touches feature code.
 */

import React, { createContext, useContext, useMemo, useState } from 'react';
import { StyleSheet, Text, TextProps, View, ViewProps } from 'react-native';
import { themes, type Theme, type ThemeName } from './theme';

// ---------------------------------------------------------------------------
// Theme context (system follow is wired in M2 settings; M0 defaults to dark)
// ---------------------------------------------------------------------------

const ThemeCtx = createContext<{ theme: Theme; setTheme: (t: ThemeName) => void }>({
  theme: themes.dark,
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [name, setName] = useState<ThemeName>('dark');
  const value = useMemo(() => ({ theme: themes[name], setTheme: setName }), [name]);
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export const useTheme = () => useContext(ThemeCtx);

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export function Screen(props: ViewProps) {
  const { theme } = useTheme();
  return (
    <View
      {...props}
      style={[styles.screen, { backgroundColor: theme.colors.background }, props.style]}
    />
  );
}

export function Card(props: ViewProps) {
  const { theme } = useTheme();
  return (
    <View
      {...props}
      style={[
        styles.card,
        { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
        props.style,
      ]}
    />
  );
}

export function Row(props: ViewProps & { gap?: number }) {
  const { gap } = props;
  return <View {...props} style={[styles.row, gap != null && { gap }, props.style]} />;
}

export function StyledText(props: TextProps & { dim?: boolean; mono?: boolean }) {
  const { theme } = useTheme();
  const { dim, mono, style, ...rest } = props;
  return (
    <Text
      {...rest}
      style={[
        { color: dim ? theme.colors.textDim : theme.colors.text },
        mono && { fontFamily: theme.typography.mono },
        style,
      ]}
    />
  );
}

/** Monospace value row — the workhorse of calculator results. */
export function ValueRow({ label, value }: { label: string; value: string }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.valueRow, { borderBottomColor: theme.colors.border }]}>
      <StyledText dim style={styles.valueLabel}>
        {label}
      </StyledText>
      <StyledText mono style={styles.valueText}>
        {value}
      </StyledText>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 16 },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  valueRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  valueLabel: { fontSize: 14 },
  valueText: { fontSize: 14, fontWeight: '600' },
});
