import { darkTheme, lightTheme, resolveThemeName, themes } from './theme';

describe('resolveThemeName', () => {
  it('uses the device scheme for the "system" preference', () => {
    expect(resolveThemeName('system', 'light')).toBe('light');
    expect(resolveThemeName('system', 'dark')).toBe('dark');
  });

  it('falls back to dark when the platform reports nothing', () => {
    expect(resolveThemeName('system', null)).toBe('dark');
    expect(resolveThemeName('system', undefined)).toBe('dark');
    // React Native reports 'unspecified' on platforms without a scheme
    expect(resolveThemeName('system', 'unspecified')).toBe('dark');
  });

  it('honours an explicit preference regardless of the device', () => {
    expect(resolveThemeName('light', 'dark')).toBe('light');
    expect(resolveThemeName('dark', 'light')).toBe('dark');
  });

  it('resolves to a palette that exists', () => {
    for (const preference of ['system', 'light', 'dark'] as const) {
      expect(themes[resolveThemeName(preference, 'light')]).toBeDefined();
    }
    expect(themes.light).toBe(lightTheme);
    expect(themes.dark).toBe(darkTheme);
  });
});
