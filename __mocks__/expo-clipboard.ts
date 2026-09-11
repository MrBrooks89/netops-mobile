/**
 * Automatic mock for expo-clipboard in Jest (node_modules mocks placed here
 * apply without an explicit jest.mock call).
 *
 * The clipboard is native; tests assert on the call instead of the effect.
 */

export const setStringAsync = jest.fn(async () => true);
export const getStringAsync = jest.fn(async () => '');
export const setString = jest.fn();
export const getString = jest.fn(() => '');
