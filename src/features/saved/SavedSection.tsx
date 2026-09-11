/**
 * One editor/list implementation for both saved hosts and saved networks.
 *
 * The two sections differ only in labels, the value column and the repository
 * behind them, so they share this component — otherwise the add/edit/delete
 * flows would inevitably drift apart.
 */

import React, { useState } from 'react';
import { Alert, View } from 'react-native';
import type { SavedEntityBase } from '../../core/model/entities';
import type { ExportFormat } from '../../data/export/codecs';
import type { Result } from '../../core/result/result';
import {
  Button,
  Card,
  Chip,
  Field,
  Note,
  SectionTitle,
  StyledText,
  useTheme,
} from '../../ui/components';
import {
  EMPTY_FORM,
  formFromEntity,
  isFormSubmittable,
  parseTagsText,
  type SavedFormValues,
} from './form';

const EXPORT_FORMATS: readonly ExportFormat[] = ['json', 'csv', 'text'];

export interface SavedSectionProps<T extends SavedEntityBase> {
  readonly title: string;
  readonly valueLabel: string;
  readonly valuePlaceholder: string;
  readonly valueHint: string;
  readonly items: readonly T[];
  readonly valueOf: (item: T) => string;
  readonly onCreate: (input: {
    label: string;
    value: string;
    tags: string[];
    notes: string;
  }) => Promise<Result<unknown>>;
  readonly onUpdate: (
    id: string,
    input: { label: string; value: string; tags: string[]; notes: string },
  ) => Promise<Result<unknown>>;
  readonly onDelete: (id: string) => Promise<Result<boolean>>;
  readonly onExport: (format: ExportFormat) => void;
  readonly onChanged: () => void;
}

export function SavedSection<T extends SavedEntityBase>(props: SavedSectionProps<T>) {
  const { theme } = useTheme();
  const [form, setForm] = useState<SavedFormValues>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setError(null);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    const input = {
      label: form.label,
      value: form.value,
      tags: parseTagsText(form.tagsText),
      notes: form.notes,
    };
    const result = editingId ? await props.onUpdate(editingId, input) : await props.onCreate(input);
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    reset();
    props.onChanged();
  };

  const startEdit = (item: T) => {
    setEditingId(item.id);
    setForm({ ...formFromEntity(item), value: props.valueOf(item) });
    setError(null);
  };

  const confirmDelete = (item: T) => {
    Alert.alert('Delete item', `Delete “${item.label}”?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const result = await props.onDelete(item.id);
          if (!result.ok) setError(result.error.message);
          else props.onChanged();
        },
      },
    ]);
  };

  return (
    <Card>
      <SectionTitle>{props.title}</SectionTitle>

      {props.items.length === 0 ? (
        <StyledText dim style={{ marginBottom: 10 }}>
          Nothing saved yet.
        </StyledText>
      ) : (
        props.items.map((item) => (
          <View
            key={item.id}
            style={{
              borderTopWidth: 1,
              borderTopColor: theme.colors.border,
              paddingVertical: 10,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <View style={{ flex: 1 }}>
              <StyledText style={{ fontWeight: '600' }}>{item.label}</StyledText>
              <StyledText mono dim style={{ fontSize: 13 }}>
                {props.valueOf(item)}
              </StyledText>
              {item.tags.length > 0 && (
                <StyledText dim style={{ fontSize: 12, marginTop: 2 }}>
                  {item.tags.join(' · ')}
                </StyledText>
              )}
              {item.notes !== '' && (
                <StyledText dim style={{ fontSize: 12, marginTop: 2 }}>
                  {item.notes}
                </StyledText>
              )}
            </View>
            <Button
              title="Edit"
              variant="secondary"
              onPress={() => startEdit(item)}
              testID={`edit-${item.id}`}
            />
            <Button
              title="Delete"
              variant="danger"
              onPress={() => confirmDelete(item)}
              testID={`delete-${item.id}`}
            />
          </View>
        ))
      )}

      <View style={{ marginTop: 12, gap: 8 }}>
        <Field
          label={editingId ? `${props.valueLabel} (editing)` : props.valueLabel}
          value={form.value}
          onChangeText={(value) => setForm((f) => ({ ...f, value }))}
          placeholder={props.valuePlaceholder}
          hint={props.valueHint}
          mono
          testID={`${props.title}-value`}
        />
        <Field
          label="Label (optional)"
          value={form.label}
          onChangeText={(label) => setForm((f) => ({ ...f, label }))}
          placeholder="Shown in the list"
          testID={`${props.title}-label`}
        />
        <Field
          label="Tags (optional)"
          value={form.tagsText}
          onChangeText={(tagsText) => setForm((f) => ({ ...f, tagsText }))}
          placeholder="core, edge"
          testID={`${props.title}-tags`}
        />
        <Field
          label="Notes (optional)"
          value={form.notes}
          onChangeText={(notes) => setForm((f) => ({ ...f, notes }))}
          placeholder="Location, owner, anything useful"
          testID={`${props.title}-notes`}
        />

        {error && (
          <Note tone="error" testID={`${props.title}-error`}>
            {error}
          </Note>
        )}

        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button
            title={editingId ? 'Save changes' : 'Add'}
            onPress={submit}
            disabled={busy || !isFormSubmittable(form)}
            testID={`${props.title}-submit`}
          />
          {editingId && (
            <Button
              title="Cancel"
              variant="secondary"
              onPress={reset}
              testID={`${props.title}-cancel`}
            />
          )}
        </View>

        {props.items.length > 0 && (
          <View style={{ marginTop: 4 }}>
            <StyledText dim style={{ fontSize: 12, marginBottom: 6 }}>
              Export this list
            </StyledText>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {EXPORT_FORMATS.map((format) => (
                <Chip
                  key={format}
                  label={format.toUpperCase()}
                  onPress={() => props.onExport(format)}
                  testID={`${props.title}-export-${format}`}
                />
              ))}
            </View>
          </View>
        )}
      </View>
    </Card>
  );
}
