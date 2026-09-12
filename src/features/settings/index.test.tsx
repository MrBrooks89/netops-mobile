import React from 'react';
import { act, fireEvent, waitFor, within } from '@testing-library/react-native';
import SettingsTab from '../../../app/(tabs)/settings';
import { renderWithApp } from '../../../test-utils/appTestKit';

/**
 * expo-router only contributes useFocusEffect here. The mock captures the
 * focus callback so a test can simulate the tab regaining focus. The test
 * lives next to the feature rather than in app/ because expo-router picks up
 * any .tsx under app/ as a route.
 */
let mockRunFocusEffect: (() => void) | null = null;

jest.mock('expo-router', () => ({
  useFocusEffect: (run: () => void) => {
    mockRunFocusEffect = run;
  },
}));

/** Fire the focus callback the way expo-router does when the tab regains focus. */
async function refocus() {
  await act(async () => {
    mockRunFocusEffect?.();
  });
}

const RUN = {
  toolId: 'dns-lookup' as const,
  status: 'success' as const,
  input: { name: 'example.com', type: 'A' },
  summary: 'A example.com → 93.184.216.34',
  detail: [{ type: 'A', value: '93.184.216.34', ttl: 300 }],
  startedAt: '2026-09-13T10:00:00.000Z',
  finishedAt: '2026-09-13T10:00:00.120Z',
  durationMs: 120,
};

beforeEach(() => {
  mockRunFocusEffect = null;
});

describe('SettingsTab', () => {
  it('reports the active theme as a checked radio from the first render', async () => {
    const { getByRole, getByTestId } = await renderWithApp(<SettingsTab />);

    // Fresh render, before any interaction: the checked state must already be
    // visible to the accessibility tree (this is the M2 follow-up).
    expect(getByRole('radio', { name: 'System', checked: true })).toBeTruthy();
    expect(getByTestId('theme-light').props.accessibilityState.checked).toBe(false);

    await fireEvent.press(getByTestId('theme-light'));
    expect(getByTestId('theme-light').props.accessibilityState.checked).toBe(true);
    expect(getByTestId('theme-system').props.accessibilityState.checked).toBe(false);
  });

  it('honours a stored dark preference on the first render', async () => {
    const { getByTestId } = await renderWithApp(<SettingsTab />, {
      appSettings: { theme: 'dark' },
    });

    expect(getByTestId('theme-dark').props.accessibilityState.checked).toBe(true);
    expect(getByTestId('theme-system').props.accessibilityState.checked).toBe(false);
  });

  it('moves the history recording radio between on and off', async () => {
    const { getByTestId } = await renderWithApp(<SettingsTab />);

    expect(getByTestId('history-toggle-on').props.accessibilityState.checked).toBe(true);
    expect(getByTestId('history-toggle-off').props.accessibilityState.checked).toBe(false);

    await fireEvent.press(getByTestId('history-toggle-off'));
    expect(getByTestId('history-toggle-off').props.accessibilityState.checked).toBe(true);
    expect(getByTestId('history-toggle-on').props.accessibilityState.checked).toBe(false);
  });

  it('reports a stored non-default retention choice as checked', async () => {
    const { getByTestId } = await renderWithApp(<SettingsTab />, {
      appSettings: { historyRetentionLimit: 250 },
    });

    expect(getByTestId('retention-250').props.accessibilityState.checked).toBe(true);
    expect(getByTestId('retention-500').props.accessibilityState.checked).toBe(false);
  });

  it('switches the retention radio on press', async () => {
    const { getByTestId } = await renderWithApp(<SettingsTab />);

    await fireEvent.press(getByTestId('retention-100'));
    expect(getByTestId('retention-100').props.accessibilityState.checked).toBe(true);
    expect(getByTestId('retention-500').props.accessibilityState.checked).toBe(false);
  });

  it('exposes the active DNS resolver as a checked radio and shows the custom field', async () => {
    const { getByTestId, queryByTestId } = await renderWithApp(<SettingsTab />);

    expect(getByTestId('doh-cloudflare').props.accessibilityState.checked).toBe(true);
    expect(getByTestId('doh-google').props.accessibilityState.checked).toBe(false);
    expect(queryByTestId('doh-custom-url')).toBeNull();

    await fireEvent.press(getByTestId('doh-custom'));
    expect(getByTestId('doh-custom').props.accessibilityState.checked).toBe(true);
    expect(getByTestId('doh-cloudflare').props.accessibilityState.checked).toBe(false);
    expect(getByTestId('doh-custom-url')).toBeTruthy();
  });

  it('refreshes the stored-on-device counts when the tab regains focus', async () => {
    const utils = await renderWithApp(<SettingsTab />);
    const runCount = () => within(utils.getByTestId('settings-count-runs'));

    await refocus();
    expect(runCount().getByText('0')).toBeTruthy();

    // A calculator screen records a run while this tab is unfocused; the
    // screen must not show the new value until it reloads on focus.
    const recorded = utils.data.runs.record(RUN);
    if (!recorded.ok) throw new Error('could not seed a run');
    expect(runCount().queryByText('1')).toBeNull();

    await refocus();
    await waitFor(() => expect(runCount().getByText('1')).toBeTruthy());
  });
});
