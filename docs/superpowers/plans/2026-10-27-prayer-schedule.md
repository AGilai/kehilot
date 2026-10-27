# Prayer schedule — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** a Kehila prayer schedule with formula times, edited by gabbaim in a PC web editor with live
phone/sheet preview, shown to members on Home and a full-schedule screen, and printed/shared as a sheet.

**Architecture:** the server stores the schedule (sections, rows, formulas, week overrides, sheet
settings) per Kehila and validates its shape; it never computes times. One shared TypeScript module
computes a week (`computeWeek`) from the schedule + zmanim for the Kehila's location; the editor, Home,
full schedule and the sheet all call it. One sheet component renders preview, print page, PNG and PDF.

**Spec:** `docs/superpowers/specs/2026-10-27-prayer-schedule-design.md` (incl. §3a and the CTO rulings).
Design: `docs/UX-DESIGN.md` §14, frames P20 (editor), P21 (Home), P22 (full schedule + Print), P23 (sheet).

## Global Constraints

- Schedule week = Friday → following Thursday; weekday rows have one time per week (fixed, or
  earliest/latest of Sun–Thu of that week). Overrides are per week and expire after it.
- Formula = anchor zman (spec list) × day source × offset (before/after, minutes) × rounding (none/down/up/
  nearest × 1/5/10/15) × optional bounds (not earlier / not later than HH:MM). Rounding is applied after the
  offset, bounds last. Times are Asia/Jerusalem wall-clock.
- Zmanim: computed offline for the Kehila's coordinates and elevation choice, matching the existing Home
  zmanim rules (`src/zmanim.ts`, "כללי אתר ישיבה") so Home and the schedule never disagree. If a library
  is needed for offline calculation, `@hebcal/core` (same family as the existing `@hebcal/hdate`) — pin
  the exact version; justify any other.
- Saves are explicit (gabbai "Save"); members see the saved schedule immediately.
- Sheet: fixed paper palette, never a second page (§14.5 fitting rules). Guests' print omits mazal tov
  unless guests may see it (type rules).
- Logo: the Kehila's uploaded logo (existing feature); placeholders in fixtures. Invented names only.
- Server: `.venv/bin/python -m unittest discover -s server/tests`; client: `npm test`, `npm run typecheck`.

## Review Focus

1. DST-switch weeks (late March, late October): weekday "earliest sunset" and Shabbat times correct.
2. Rounding + bounds edge cases: exactly on a 5-minute mark, bound tighter than the formula, bounds crossing.
3. A week with a "this week only" hide/extra row: Home "next" skips hidden rows and includes extras.
4. Long labels / many rows: the sheet still fits one page per §14.5; the phone layout wraps, never clips.
5. A member opening Home with no schedule saved yet: the city zmanim card is open, no empty schedule card.

---

### Task 1: the calculation module

**Files:** `src/schedule/types.ts`, `src/schedule/formula.ts` (`evaluate(formula, week, zmanimFor) → "HH:MM"
| null`, `describe(formula, lang) → string` — the plain-language summary per §14), `src/schedule/week.ts`
(`scheduleWeekOf(date)`, `computeWeek(schedule, weekStart, zmanimFor) → ComputedWeek` with overrides
applied and each row marked fixed/formula/override), `src/schedule/zmanim.ts` (offline zmanim per date
for the Kehila location, consistent with `src/zmanim.ts`), tests `tests/schedule.test.ts`.

- [ ] Tests first with pinned dates (a normal week, the October and March DST weeks, a winter week):
      `= shkia`, `= shkia − 5`, `= shkia − 5 round down 5`, `= min(Sun–Thu shkia) − 15 round down 5 not later
      than 18:30`, candle lighting (Kehila minutes), tzeit, Shabbat end; overrides (time, hide, extra row);
      `describe` he/en strings from §14; next-row selection per §14.1. Compare a few zmanim to the existing
      `src/zmanim.ts` values for the same date (within 1 minute). Commit.

### Task 2: server storage

**Files:** `server/cloud/routes_schedule.py`, `server/cloud/repo_schedule.py`, `handler.py`, `API.md`, tests.

**Produces:** `GET /v1/kehilot/{k}/schedule` (any member/listener) → `{sections, sheet, location, updatedAt}`;
`PUT …/admin/schedule` (gabbai) full replace with strict validation (section/row counts and lengths, formula
shape and enums, HH:MM bounds); `PUT …/admin/schedule/weeks/{weekStart}` overrides; `DELETE` of a week's
overrides; Kehila location settings (lat, lon, elevation choice, candle minutes, the sheet's two candle
cities) in the existing settings route. Items `SCHED` / `SCHEDWK#<date>` (TTL after the week).

- [ ] Tests first (validation, roles, size limits, override expiry). Commit.

### Task 3: member views — Home card, collapsible zmanim, full schedule

**Files:** Home (P21 order: greeting, test-build card, seat card, P7 card, schedule card; city zmanim as a
collapsible card below), `src/views/Schedule.tsx` (P22), i18n, fixtures.

- [ ] Per §14.3–14.4; pure helpers test-first (card mode Thu→Shabbat vs weekday, countdown only within
      6 hours). Visual check 390 he/en, dark/light. Commit.

### Task 4: the sheet component and print/share

**Files:** `src/schedule/Sheet.tsx` ("Classic two columns", P23: A4 and WhatsApp-square, with/without
mazal tov), print page route (web: opens the print page + `window.print()`), PNG/PDF share (web: from the
editor; phone: PDF via the platform share — use what Expo already provides, e.g. `expo-print` /
`expo-sharing` if present; justify any new dependency), fitting rules §14.5.

- [ ] Visual check at A4 (print to PDF in the headless browser) and square. Commit.

### Task 5: the PC editor with live preview

**Files:** `src/views/admin/ScheduleEditor.tsx` and parts (P20): sections/rows CRUD, drag reorder,
formula builder (sentence form), live computed time + summary + Sun–Thu breakdown, week picker,
"this week only" editing, preview toggle phone ↔ sheet (reusing Home card/Schedule/Sheet), explicit Save,
warnings (rounding direction), narrow fallback; gabbai entry points.

- [ ] Pure editor state logic test-first (reducer: add/move/edit/override/save-diff). Visual check at
      1280 and 390. Commit.

### Task 6: deploy (controller) — after the user applies/approves the backend deploy.
