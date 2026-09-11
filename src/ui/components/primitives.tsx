/**
 * UI primitives — the entire app renders through these so a future design
 * overhaul (or a Paper swap, plan D6) never touches feature code.
 */

import React, { createContext, useContext, useMemo, useState } from 'react';
import {
  ScrollView,
  ScrollViewProps,
  StyleSheet,
  Text,
  TextProps,
  View,
  ViewProps,
} from 'react-native';
import { themes, type Theme, type ThemeName } from '../theme';

// ---------------------------------------------------------------------------
// Theme context (system follow is wired in M2 settings; M1 defaults to dark)
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
// Layout
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

/** Screen that scrolls — used by every calculator (results can be long). */
export function ScrollScreen(props: ScrollViewProps) {
  const { theme } = useTheme();
  return (
    <ScrollView
      {...props}
      style={[styles.scroll, { backgroundColor: theme.colors.background }, props.style]}
      contentContainerStyle={[styles.scrollContent, props.contentContainerStyle]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
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

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

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

export function SectionTitle({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  return (
    <StyledText dim style={[styles.sectionTitle, { color: theme.colors.textDim }]}>
      {children}
    </StyledText>
  );
}

/** Screen header: tool name + one-line explanation. */
export function ToolHeader({ title, description }: { title: string; description: string }) {
  return (
    <View style={styles.toolHeader}>
      <StyledText style={styles.toolTitle}>{title}</StyledText>
      <StyledText dim style={styles.toolDescription}>
        {description}
      </StyledText>
    </View>
  );
}

/** Monospace value row without a copy affordance (info only). */
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

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

export type NoteTone = 'info' | 'warn' | 'error' | 'success';

/** Inline callout: RFC notes, validation errors, "does not fit" warnings. */
export function Note({
  tone = 'info',
  children,
  testID,
}: {
  tone?: NoteTone;
  children: React.ReactNode;
  testID?: string;
}) {
  const { theme } = useTheme();
  const color =
    tone === 'error'
      ? theme.colors.error
      : tone === 'warn'
        ? theme.colors.warning
        : tone === 'success'
          ? theme.colors.success
          : theme.colors.primary;
  return (
    <View
      testID={testID}
      style={[styles.note, { borderLeftColor: color, backgroundColor: theme.colors.surfaceAlt }]}
    >
      <StyledText style={styles.noteText}>{children}</StyledText>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 16 },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  sectionTitle: {
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  toolHeader: { marginBottom: 12 },
  toolTitle: { fontSize: 22, fontWeight: '700', marginBottom: 4 },
  toolDescription: { fontSize: 14, lineHeight: 20 },
  valueRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  valueLabel: { fontSize: 14, flexShrink: 1 },
  valueText: { fontSize: 14, fontWeight: '600' },
  note: {
    borderLeftWidth: 3,
    borderRadius: 6,
    padding: 10,
    marginBottom: 8,
  },
  noteText: { fontSize: 13, lineHeight: 18 },
});
