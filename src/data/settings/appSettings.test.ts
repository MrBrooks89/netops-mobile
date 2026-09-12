import { createMemorySettingsStore } from '../../../test-utils/memorySettingsStore';
import {
  DEFAULT_SETTINGS,
  parseDohProvider,
  RETENTION_MAX,
  RETENTION_MIN,
  SETTINGS_KEYS,
  parseBooleanSetting,
  parseRetention,
  parseTheme,
  readSettings,
  writeSettings,
} from './appSettings';

describe('settings parsing', () => {
  it('accepts known themes and falls back otherwise', () => {
    expect(parseTheme('light')).toBe('light');
    expect(parseTheme('dark')).toBe('dark');
    expect(parseTheme('system')).toBe('system');
    expect(parseTheme('neon')).toBe(DEFAULT_SETTINGS.theme);
    expect(parseTheme(null)).toBe(DEFAULT_SETTINGS.theme);
  });

  it('parses booleans from their stored spellings', () => {
    expect(parseBooleanSetting('true', false)).toBe(true);
    expect(parseBooleanSetting('1', false)).toBe(true);
    expect(parseBooleanSetting('false', true)).toBe(false);
    expect(parseBooleanSetting('0', true)).toBe(false);
    expect(parseBooleanSetting('maybe', true)).toBe(true);
    expect(parseBooleanSetting(null, false)).toBe(false);
  });

  it('clamps retention to the supported range', () => {
    expect(parseRetention('250')).toBe(250);
    expect(parseRetention(String(RETENTION_MIN - 1))).toBe(RETENTION_MIN);
    expect(parseRetention(String(RETENTION_MAX + 1000))).toBe(RETENTION_MAX);
    expect(parseRetention('12.5')).toBe(DEFAULT_SETTINGS.historyRetentionLimit);
    expect(parseRetention('lots')).toBe(DEFAULT_SETTINGS.historyRetentionLimit);
    expect(parseRetention(null)).toBe(DEFAULT_SETTINGS.historyRetentionLimit);
  });
});

describe('reading and writing settings', () => {
  it('returns defaults from an empty store', () => {
    const store = createMemorySettingsStore();
    expect(readSettings(store)).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips a full write', () => {
    const store = createMemorySettingsStore();
    const saved = writeSettings(store, {
      theme: 'light',
      historyEnabled: false,
      historyRetentionLimit: 120,
      dohProvider: 'google',
      customDohUrl: 'https://doh.example/q',
    });
    expect(saved).toEqual({
      theme: 'light',
      historyEnabled: false,
      historyRetentionLimit: 120,
      dohProvider: 'google',
      customDohUrl: 'https://doh.example/q',
    });
    expect(readSettings(store)).toEqual(saved);
    expect(store.snapshot()).toEqual({
      [SETTINGS_KEYS.theme]: 'light',
      [SETTINGS_KEYS.historyEnabled]: 'false',
      [SETTINGS_KEYS.historyRetentionLimit]: '120',
      [SETTINGS_KEYS.dohProvider]: 'google',
      [SETTINGS_KEYS.customDohUrl]: 'https://doh.example/q',
    });
  });

  it('applies partial updates without disturbing other values', () => {
    const store = createMemorySettingsStore();
    writeSettings(store, { theme: 'dark', historyRetentionLimit: 50, dohProvider: 'google' });
    const next = writeSettings(store, { historyEnabled: false });
    expect(next).toEqual({
      theme: 'dark',
      historyEnabled: false,
      historyRetentionLimit: 50,
      dohProvider: 'google',
      customDohUrl: '',
    });
  });

  it('round-trips the DoH provider choice and trims a custom URL', () => {
    const store = createMemorySettingsStore();
    const saved = writeSettings(store, {
      dohProvider: 'custom',
      customDohUrl: '  https://doh.example/q  ',
    });
    expect(saved.dohProvider).toBe('custom');
    expect(saved.customDohUrl).toBe('https://doh.example/q');
    expect(parseDohProvider(store.get(SETTINGS_KEYS.dohProvider))).toBe('custom');
  });

  it('falls back to the default provider for an unknown stored value', () => {
    expect(parseDohProvider('nope')).toBe(DEFAULT_SETTINGS.dohProvider);
    expect(parseDohProvider(null)).toBe(DEFAULT_SETTINGS.dohProvider);
    expect(parseDohProvider('google')).toBe('google');
    expect(parseDohProvider('custom')).toBe('custom');
  });

  it('normalises invalid input on write', () => {
    const store = createMemorySettingsStore();
    const saved = writeSettings(store, { theme: 'purple' as never, historyRetentionLimit: -5 });
    expect(saved.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(saved.historyRetentionLimit).toBe(RETENTION_MIN);
  });

  it('survives values written by another build', () => {
    const store = createMemorySettingsStore({
      [SETTINGS_KEYS.theme]: 'dark',
      [SETTINGS_KEYS.historyEnabled]: 'yes-please',
      [SETTINGS_KEYS.historyRetentionLimit]: '99999',
      [SETTINGS_KEYS.dohProvider]: 'some-old-provider',
    });
    expect(readSettings(store)).toEqual({
      theme: 'dark',
      historyEnabled: DEFAULT_SETTINGS.historyEnabled,
      historyRetentionLimit: RETENTION_MAX,
      dohProvider: DEFAULT_SETTINGS.dohProvider,
      customDohUrl: '',
    });
  });
});
