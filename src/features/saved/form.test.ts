import { EMPTY_FORM, formFromEntity, isFormSubmittable, parseTagsText, tagsToText } from './form';

describe('parseTagsText', () => {
  it('splits on commas, semicolons and whitespace', () => {
    expect(parseTagsText('core, edge')).toEqual(['core', 'edge']);
    expect(parseTagsText('core;edge;lab')).toEqual(['core', 'edge', 'lab']);
    expect(parseTagsText('core edge  lab')).toEqual(['core', 'edge', 'lab']);
    expect(parseTagsText('  spaced ,, out , ')).toEqual(['spaced', 'out']);
  });

  it('returns nothing for blank input', () => {
    expect(parseTagsText('')).toEqual([]);
    expect(parseTagsText('   ,  ; ')).toEqual([]);
  });

  it('round-trips through tagsToText', () => {
    expect(parseTagsText(tagsToText(['a', 'b']))).toEqual(['a', 'b']);
  });
});

describe('form helpers', () => {
  it('starts empty and requires a value to submit', () => {
    expect(EMPTY_FORM).toEqual({ label: '', value: '', tagsText: '', notes: '' });
    expect(isFormSubmittable(EMPTY_FORM)).toBe(false);
    expect(isFormSubmittable({ ...EMPTY_FORM, value: '  ' })).toBe(false);
    expect(isFormSubmittable({ ...EMPTY_FORM, value: '192.168.1.1' })).toBe(true);
  });

  it('builds a form from an existing entity', () => {
    const form = formFromEntity({ label: 'Router', tags: ['core', 'edge'], notes: 'rack 3' });
    expect(form).toEqual({ label: 'Router', value: '', tagsText: 'core, edge', notes: 'rack 3' });
  });
});
