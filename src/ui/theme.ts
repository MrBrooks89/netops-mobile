/**
 * Theme tokens — single source of truth for colors, spacing, typography.
 *
 * Design tokens are plain values (no react-native imports) so they're usable
 * in core-adjacent code and tests. Palette follows a dark-first networking
 * tool aesthetic with a clean light mode.
 *
 * M0 scope: tokens + ThemeProvider + useTheme. No iconography system yet.
 */

export interface ThemeColors {
  primary: string;
  primaryDim: string;
  background: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  textDim: string;
  textFaint: string;
  border: string;
  success: string;
  warning: string;
  error: string;
}

export interface Theme {
  dark: boolean;
  colors: ThemeColors;
  spacing: { xs: number; sm: number; md: number; lg: number; xl: number };
  radius: { sm: number; md: number; lg: number; full: number };
  typography: {
    mono: string; // for IPs, masks, code-ish values
  };
}

export const darkTheme: Theme = {
  dark: true,
  colors: {
    primary: '#4da3ff',
    primaryDim: '#2b6cb0',
    background: '#0f1216',
    surface: '#171b21',
    surfaceAlt: '#1f242c',
    text: '#e8ecf1',
    textDim: '#9aa4b0',
    textFaint: '#5c6670',
    border: '#2a303a',
    success: '#4ade80',
    warning: '#fbbf24',
    error: '#f87171',
  },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
  radius: { sm: 4, md: 8, lg: 12, full: 999 },
  typography: { mono: 'monospace' },
};

export const lightTheme: Theme = {
  dark: false,
  colors: {
    primary: '#1a73e8',
    primaryDim: '#8ab4f8',
    background: '#f6f8fa',
    surface: '#ffffff',
    surfaceAlt: '#eef1f4',
    text: '#1a2027',
    textDim: '#5f6b76',
    textFaint: '#9aa4b0',
    border: '#dde3e9',
    success: '#15803d',
    warning: '#b45309',
    error: '#b91c1c',
  },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
  radius: { sm: 4, md: 8, lg: 12, full: 999 },
  typography: { mono: 'monospace' },
};

export const themes = { dark: darkTheme, light: lightTheme };
export type ThemeName = keyof typeof themes;
