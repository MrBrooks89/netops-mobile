/**
 * Dashboard tab tests: first-run onboarding, favorite pinning and the
 * recently-used list.
 *
 * The test lives here rather than beside the route in app/ because expo-router
 * picks up any .tsx under app/ as a route.
 */

import React from 'react';
import { act, fireEvent, within } from '@testing-library/react-native';
import Dashboard from '../../../app/(tabs)/index';
import type { RunRecordInput } from '../../../src/core/model/entities';
import type { ToolId } from '../../../src/core/registry/types';
import { readSettings } from '../../../src/data/settings/appSettings';
import { renderWithApp } from '../../../test-utils/appTestKit';

/**
 * expo-router only contributes the router and the focus effect here. The mock
 * captures the focus callback so a test can simulate the tab regaining focus
 * after a tool recorded a run.
 */
let mockRunFocusEffect: (() => void) | null = null;

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useFocusEffect: (run: () => void) => {
    mockRunFocusEffect = run;
  },
  useLocalSearchParams: () => ({}),
  router: { push: jest.fn() },
  Link: () => null,
}));

/** Fire the focus callback the way expo-router does when the tab regains focus. */
async function refocus() {
  await act(async () => {
    mockRunFocusEffect?.();
  });
}

const run = (toolId: ToolId, startedAt: string): RunRecordInput => ({
  toolId,
  status: 'success',
  input: {},
  summary: `${toolId} ran`,
  detail: null,
  startedAt,
  finishedAt: startedAt,
  durationMs: 5,
});

/** TestIDs of the rows inside a section card, in render order. */
const rowIds = (card: ReturnType<typeof within>, prefix: string): string[] =>
  card
    .getAllByTestId(new RegExp(`^${prefix}-row-`))
    .map((node) => String(node.props.testID).replace(`${prefix}-row-`, ''));

beforeEach(() => {
  mockRunFocusEffect = null;
});

describe('Dashboard', () => {
  it('shows the first-run onboarding card and keeps it dismissed after a press', async () => {
    const utils = await renderWithApp(<Dashboard />);

    expect(utils.getByTestId('onboarding-card')).toBeTruthy();
    expect(utils.getByText('Before you start')).toBeTruthy();

    await fireEvent.press(utils.getByTestId('onboarding-dismiss'));

    expect(utils.queryByTestId('onboarding-card')).toBeNull();
    // Persisted, not just hidden: a later render reads the stored flag.
    expect(readSettings(utils.data.settings).onboardingDismissed).toBe(true);
  });

  it('honours a stored dismissal on the first frame', async () => {
    const utils = await renderWithApp(<Dashboard />, {
      appSettings: { onboardingDismissed: true },
    });

    expect(utils.queryByTestId('onboarding-card')).toBeNull();
  });

  it('marks tools this build cannot run, and only those', async () => {
    const utils = await renderWithApp(<Dashboard />, {
      appSettings: { onboardingDismissed: true },
    });

    // jest-expo runs as iOS, so the real capability registry reports every
    // native-backed tool as missing — the exact "bare iOS build" state M8 is
    // about. The row says so before the user taps it.
    expect(utils.getByTestId('browse-unavailable-port-scanner')).toBeTruthy();
    expect(utils.getByTestId('browse-unavailable-lan-discovery')).toBeTruthy();
    // Pure tools are not marked…
    expect(utils.queryByTestId('browse-unavailable-subnet-calculator')).toBeNull();
    // …and neither are the fetch-based DNS tools.
    expect(utils.queryByTestId('browse-unavailable-dns-lookup')).toBeNull();
  });

  it('pins a tool from the browse list and unpins it from Favorites', async () => {
    const utils = await renderWithApp(<Dashboard />, {
      appSettings: { onboardingDismissed: true },
    });

    expect(utils.queryByTestId('favorites-card')).toBeNull();

    const star = utils.getByTestId('browse-star-subnet-calculator');
    expect(star.props.accessibilityLabel).toBe('Add Subnet Calculator to favorites');
    expect(star.props.accessibilityState).toEqual({ selected: false });

    await fireEvent.press(star);

    expect(within(utils.getByTestId('favorites-card')).getByText('Subnet Calculator')).toBeTruthy();
    expect(readSettings(utils.data.settings).favoriteToolIds).toEqual(['subnet-calculator']);
    const pinned = utils.getByTestId('favorite-star-subnet-calculator');
    expect(pinned.props.accessibilityLabel).toBe('Remove Subnet Calculator from favorites');
    expect(pinned.props.accessibilityState).toEqual({ selected: true });

    await fireEvent.press(pinned);

    expect(utils.queryByTestId('favorites-card')).toBeNull();
    expect(readSettings(utils.data.settings).favoriteToolIds).toEqual([]);
  });

  it('renders stored favorites in pin order and skips ids the registry does not ship', async () => {
    const utils = await renderWithApp(<Dashboard />, {
      appSettings: {
        onboardingDismissed: true,
        favoriteToolIds: ['ghost-tool', 'tcp-ping', 'dns-lookup'],
      },
    });

    expect(rowIds(within(utils.getByTestId('favorites-card')), 'favorite')).toEqual([
      'tcp-ping',
      'dns-lookup',
    ]);
  });

  it('lists the five most recently used tools, newest first, when the tab regains focus', async () => {
    const utils = await renderWithApp(<Dashboard />, {
      appSettings: { onboardingDismissed: true },
    });

    expect(utils.queryByTestId('recent-card')).toBeNull();

    // Runs recorded while the tab was unfocused, oldest first. The last entry
    // repeats an older tool, and one older run must fall off the five-tool cap.
    const history: readonly (readonly [ToolId, string])[] = [
      ['subnet-calculator', '2026-01-01T00:00:01.000Z'],
      ['cidr-calculator', '2026-01-01T00:00:02.000Z'],
      ['dns-lookup', '2026-01-01T00:00:03.000Z'],
      ['tcp-ping', '2026-01-01T00:00:04.000Z'],
      ['reverse-dns', '2026-01-01T00:00:05.000Z'],
      ['tcp-connect', '2026-01-01T00:00:06.000Z'],
      ['dns-lookup', '2026-01-01T00:00:07.000Z'],
    ];
    for (const [toolId, startedAt] of history) {
      const recorded = utils.data.runs.record(run(toolId, startedAt));
      if (!recorded.ok) throw new Error('could not seed a run');
    }

    expect(utils.queryByTestId('recent-card')).toBeNull();

    await refocus();

    expect(rowIds(within(utils.getByTestId('recent-card')), 'recent')).toEqual([
      'dns-lookup',
      'tcp-connect',
      'reverse-dns',
      'tcp-ping',
      'cidr-calculator',
    ]);
  });
});
