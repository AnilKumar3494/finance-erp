/**
 * MUI theme builder.
 *
 * Reads computed CSS variables off <html> at theme-creation time and feeds
 * them into MUI's palette/typography/shape so MUI's components share the
 * exact same tokens as our hand-rolled CSS. Re-built when the theme mode
 * changes (light <-> dark) via useMemo in providers.tsx.
 *
 * Rule of thumb:
 *   - Color/radius/shadow/font defaults  ->  here, sourced from tokens.css
 *   - Component-specific overrides       ->  here, in the `components` block
 *   - One-off page styles                ->  inline sx using theme.palette.*
 *   - Never hard-code hex outside tokens.css.
 */

import { createTheme, type ThemeOptions } from '@mui/material/styles';

type Mode = 'light' | 'dark';

/** Read a CSS custom property off <html>, with a literal fallback. */
const readVar = (name: string, fallback: string): string => {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
};

export function buildMuiTheme(mode: Mode) {
  // Force the theme attribute BEFORE reading vars so getComputedStyle
  // returns the right palette. Caller (providers.tsx) also sets this for CSS.
  if (typeof document !== 'undefined') {
    if (mode === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
  }

  const tokens = {
    bg: readVar('--bg', '#f4f6fb'),
    surface: readVar('--surface', '#ffffff'),
    surfaceAlt: readVar('--surface-alt', '#f7f9fc'),
    border: readVar('--border', '#e2e8f0'),
    borderStrong: readVar('--border-strong', '#cbd5e1'),
    text: readVar('--text', '#1e293b'),
    textSub: readVar('--text-sub', '#64748b'),
    textMuted: readVar('--text-muted', '#94a3b8'),
    accent: readVar('--accent', '#3b6ef0'),
    accentLight: readVar('--accent-light', '#eef2fd'),
    accentStrong: readVar('--accent-strong', '#2956d4'),
    success: readVar('--success', '#16a34a'),
    successLight: readVar('--success-light', '#f0fdf4'),
    warning: readVar('--warning', '#d97706'),
    warningLight: readVar('--warning-light', '#fffbeb'),
    danger: readVar('--danger', '#dc2626'),
    dangerLight: readVar('--danger-light', '#fef2f2'),
    fontSans: readVar(
      '--font-sans',
      'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
    ),
    fontMono: readVar('--font-mono', 'Inter, ui-monospace, monospace'),
    shadowCard: readVar('--shadow-card', '0 1px 4px rgba(15,23,42,0.06)'),
  };

  const options: ThemeOptions = {
    palette: {
      mode,
      primary: { main: tokens.accent, dark: tokens.accentStrong, contrastText: '#fff' },
      success: { main: tokens.success, light: tokens.successLight },
      warning: { main: tokens.warning, light: tokens.warningLight },
      error: { main: tokens.danger, light: tokens.dangerLight },
      background: { default: tokens.bg, paper: tokens.surface },
      text: {
        primary: tokens.text,
        secondary: tokens.textSub,
        disabled: tokens.textMuted,
      },
      divider: tokens.border,
    },

    typography: {
      fontFamily: tokens.fontSans,
      htmlFontSize: 14,
      fontSize: 14,
      h1: { fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em' },
      h2: { fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' },
      h3: { fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em' },
      h4: { fontSize: 14, fontWeight: 700 },
      body1: { fontSize: 14, lineHeight: 1.5 },
      body2: { fontSize: 13, lineHeight: 1.45, color: tokens.textSub },
      button: { fontWeight: 700, letterSpacing: '0.02em', textTransform: 'none' },
      caption: { fontSize: 11, color: tokens.textSub },
      overline: {
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: tokens.textMuted,
      },
    },

    shape: { borderRadius: 9 },

    // Disable MUI's elevation scale; we use the single --shadow-card token.
    shadows: [
      'none',
      tokens.shadowCard,
      tokens.shadowCard,
      tokens.shadowCard,
      tokens.shadowCard,
      tokens.shadowCard,
      tokens.shadowCard,
      tokens.shadowCard,
      tokens.shadowCard,
      tokens.shadowCard,
      tokens.shadowCard,
      tokens.shadowCard,
      tokens.shadowCard,
      tokens.shadowCard,
      tokens.shadowCard,
      tokens.shadowCard,
      tokens.shadowCard,
      tokens.shadowCard,
      tokens.shadowCard,
      tokens.shadowCard,
      tokens.shadowCard,
      tokens.shadowCard,
      tokens.shadowCard,
      tokens.shadowCard,
      tokens.shadowCard,
    ] as ThemeOptions['shadows'],

    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            backgroundColor: tokens.bg,
            color: tokens.text,
          },
        },
      },

      // ---- Buttons -----------------------------------------------------
      // App code uses <Btn variant="primary|ghost|success|danger" size="sm|md"/>
      // which maps onto the underlying MUI Button props. Variants are added
      // via `variants` so MUI honors them.
      MuiButton: {
        defaultProps: { disableElevation: true, disableRipple: false },
        styleOverrides: {
          root: {
            borderRadius: 9,
            fontWeight: 600,
            textTransform: 'none',
            boxShadow: 'none',
            '&:hover': { boxShadow: 'none' },
          },
        },
      },

      // ---- Text fields / inputs ---------------------------------------
      MuiTextField: {
        defaultProps: { size: 'small', variant: 'outlined' },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: 9,
            backgroundColor: tokens.surface,
            fontSize: 13,
            '& fieldset': { borderWidth: 1.5, borderColor: tokens.border },
            '&:hover fieldset': { borderColor: tokens.borderStrong },
            '&.Mui-focused fieldset': {
              borderColor: tokens.accent,
              borderWidth: 1.5,
            },
          },
          input: { padding: '10px 12px' },
        },
      },

      // ---- Paper / Card -----------------------------------------------
      MuiPaper: {
        defaultProps: { elevation: 1 },
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            border: `1px solid ${tokens.border}`,
            borderRadius: 14,
          },
        },
      },

      // ---- Dialog (modals) --------------------------------------------
      MuiDialog: {
        styleOverrides: {
          paper: {
            borderRadius: 16,
            padding: 28,
            border: `1px solid ${tokens.border}`,
          },
        },
      },

      // ---- Chip (used by our Badge family underneath) ------------------
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: 99,
            height: 22,
            fontSize: 11,
            fontWeight: 600,
            padding: '0 9px',
          },
          label: { padding: 0 },
        },
      },
    },
  };

  return createTheme(options);
}
