/**
 * Input primitives: text fields with inline validation, buttons, filter chips.
 */

import React from 'react';
import { Pressable, StyleSheet, TextInput, TextInputProps, View } from 'react-native';
import { StyledText, useTheme } from './primitives';

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  error,
  hint,
  mono,
  multiline,
  testID,
  autoFocus,
  onSubmitEditing,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  /** Inline validation message; also flips the border to the error colour. */
  error?: string | null;
  hint?: string;
  mono?: boolean;
  /** Multi-line input (one value per line, e.g. CIDR summarisation). */
  multiline?: boolean;
  testID?: string;
  autoFocus?: boolean;
  onSubmitEditing?: TextInputProps['onSubmitEditing'];
}) {
  const { theme } = useTheme();
  return (
    <View style={styles.field}>
      <StyledText dim style={styles.fieldLabel}>
        {label}
      </StyledText>
      <TextInput
        testID={testID}
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.textFaint}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus={autoFocus}
        onSubmitEditing={onSubmitEditing}
        multiline={multiline}
        returnKeyType="done"
        style={[
          styles.input,
          multiline && styles.inputMultiline,
          {
            color: theme.colors.text,
            backgroundColor: theme.colors.surfaceAlt,
            borderColor: error ? theme.colors.error : theme.colors.border,
          },
          mono && { fontFamily: theme.typography.mono },
        ]}
      />
      {error ? (
        <StyledText
          testID={`${testID ?? label}-error`}
          style={[styles.helper, { color: theme.colors.error }]}
        >
          {error}
        </StyledText>
      ) : hint ? (
        <StyledText dim style={styles.helper}>
          {hint}
        </StyledText>
      ) : null}
    </View>
  );
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  testID,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  testID?: string;
}) {
  const { theme } = useTheme();
  const background =
    variant === 'primary'
      ? theme.colors.primary
      : variant === 'danger'
        ? theme.colors.error
        : theme.colors.surfaceAlt;
  const color = variant === 'secondary' ? theme.colors.text : theme.dark ? '#0b0e12' : '#ffffff';
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: background, opacity: disabled ? 0.4 : pressed ? 0.8 : 1 },
      ]}
    >
      <StyledText style={[styles.buttonText, { color }]}>{title}</StyledText>
    </Pressable>
  );
}

/** Selectable filter chip (protocol filters, calculator modes, examples). */
export function Chip({
  label,
  selected,
  onPress,
  testID,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      accessibilityLabel={label}
      style={[
        styles.chip,
        {
          backgroundColor: selected ? theme.colors.primary : theme.colors.surfaceAlt,
          borderColor: selected ? theme.colors.primary : theme.colors.border,
        },
      ]}
    >
      <StyledText
        style={[styles.chipText, { color: selected && theme.dark ? '#0b0e12' : theme.colors.text }]}
        mono
      >
        {label}
      </StyledText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  field: { marginBottom: 12 },
  fieldLabel: { fontSize: 13, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  inputMultiline: { minHeight: 88, textAlignVertical: 'top' },
  helper: { fontSize: 12, marginTop: 6, lineHeight: 16 },
  button: {
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 11,
    alignItems: 'center',
  },
  buttonText: { fontSize: 15, fontWeight: '600' },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
    marginBottom: 8,
  },
  chipText: { fontSize: 13 },
});
