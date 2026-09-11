# ADR-002: Hand-rolled UI primitives instead of a component library

**Status:** Accepted (M1)
**Deciders:** implementation agent + repo owner (M1 approval)
**Date:** 2026-09-12 (M1 implementation)
**Relates to:** plan D6 ("UI kit: react-native-paper, wrapped in `ui/` tokens so swappable")

## Context

The implementation plan (D6) recommended `react-native-paper` for speed, citing its
`DataTable` as a good fit for VLSM/subnet output, while explicitly allowing an
alternative ("gluestack/Tamagui (styling-only) if Paper feels heavy") and wrapping
everything in `ui/` tokens so the choice stays swappable.

M0 shipped a small custom primitive set (`Screen`, `Card`, `Row`, `StyledText`,
`ValueRow`, `useTheme`) because the dashboard needed almost nothing. M1 needed to
add: text fields with inline validation, buttons, filter chips, a copy affordance on
every value row, and callout notes.

## Decision

Continue with hand-rolled primitives under `src/ui/components/`
(`primitives.tsx`, `inputs.tsx`, `CopyableValue.tsx`, barrel `index.tsx`).
Do **not** adopt react-native-paper for M1.

## Rationale

1. **The seam already exists.** Features never import a component library directly —
   they import `ui/components`. Adopting Paper later is a rewrite of one directory,
   not of the five tool screens.
2. **M1's widget list is small and stable.** One `TextInput` variant, one button, a
   chip, a two-column row, and a bordered note. Paper's equivalent surface would be
   a multi-megabyte dependency plus its own theming layer underneath ours.
3. **`DataTable` was the stated reason to pick Paper, and it turned out not to be
   needed.** The VLSM output is a list of per-subnet cards with copyable values,
   which reads better on a phone than a horizontally scrolling data table.
4. **Bundle and review cost.** Every dependency is attack surface and cold-start
   time; the plan's own §16.8 requires a justification for native deps, and the same
   discipline is cheap to apply to a large JS dep.

## Consequences

- We own ~330 lines of primitives. They are theme-token driven (dark/light ready)
  and covered by screen tests, so the maintenance cost is bounded and visible.
- We forgo ready-made widgets we have not needed yet: data tables, autocomplete,
  date pickers, snackbars, portals.
- **Revisit trigger:** when a single screen needs two or more complex widgets
  (autocomplete, data table, picker) or when visual polish starts costing more than
  the dependency would. At that point, swap the implementation behind
  `src/ui/components/index.tsx` — feature code should not need to change, and if it
  does, that is a signal the seam leaked.
