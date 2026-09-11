/**
 * Pure form helpers for the saved-entity editor.
 *
 * Kept out of the component so the parsing rules are testable and identical
 * for hosts and networks.
 */

export interface SavedFormValues {
  readonly label: string;
  readonly value: string;
  /** Tags as typed: comma- or space-separated. */
  readonly tagsText: string;
  readonly notes: string;
}

export const EMPTY_FORM: SavedFormValues = { label: '', value: '', tagsText: '', notes: '' };

/**
 * Parse a tag string: commas, semicolons, and whitespace all separate tags.
 * Duplicates and blanks are removed by the repository's normalisation, so this
 * only has to be permissive.
 */
export function parseTagsText(text: string): string[] {
  return text
    .split(/[,;\s]+/)
    .map((tag) => tag.trim())
    .filter((tag) => tag !== '');
}

export function tagsToText(tags: readonly string[]): string {
  return tags.join(', ');
}

export function formFromEntity(entity: {
  label: string;
  tags: readonly string[];
  notes: string;
}): SavedFormValues {
  return {
    label: entity.label,
    value: '',
    tagsText: tagsToText(entity.tags),
    notes: entity.notes,
  };
}

/** A form is submittable once it has a value; the label may be blank. */
export function isFormSubmittable(form: SavedFormValues): boolean {
  return form.value.trim() !== '';
}
