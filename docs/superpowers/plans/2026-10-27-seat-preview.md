# Seat release preview — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** a clickable preview of seat release on the dev web app — the Home reminder card, the member
seat page with his part of the block, and the gabbai print map — on fixture data, buttons not wired.

**Architecture:** client only. A typed hall-layout module (the Kehila's real hall shape, no names), a
pure "block frame" function, fixture allocations, three views behind `EXPO_PUBLIC_SEATS_PREVIEW=1`.
No server, no push sending.

**Spec:** `docs/superpowers/specs/2026-10-27-seat-release-preview-design.md`. Design: `docs/UX-DESIGN.md`
§15, frames P24 (card + push), P25 (seat page), P26 (gabbai print), P27 (on-behalf + upload — design only,
not built in this plan).

## Global Constraints

- Hall layout from `~/work/gabay/design/mockups/phase2-seat-map.html` (the `BLOCKS` object around line
  319): 5 blocks, rows 0–13, bimah in the middle block, 205 seats — shape only. Encode it as data in
  `src/seats/hall.ts`; a test asserts 205 seats and the block names. Ark side and seat-numbering direction
  are provisional (designer's choice, flagged open) — keep them as two constants.
- Invented names only; the preview label "תצוגה מקדימה" (P24/§15) on every preview surface; unwired
  buttons show the "בקרוב" toast.
- Colour never alone: needed / freed / others by shape + label (P25).
- `npm test`, `npm run typecheck` clean; visual check at 390 (he dark/light) and 1280 for the print.

## Review Focus

1. Split seats: same block within 4 rows → one frame; otherwise one frame per group (§15).
2. Seats on the hall edge (row 0 / 13, first/last column): the ±2 frame clips to the hall, never out of range.
3. A person with no allocation: "פנו לגבאי" state, no card on Home.
4. Print fits one A4 landscape page in black and white; names off by default.
5. The card's time window (Thu 12:00 → Fri 12:00 by default) computed in Israel time, incl. DST weeks.

---

### Task 1: hall model, block frame, preview views

**Files:** create `src/seats/hall.ts`, `src/seats/frame.ts` (pure: `blockFrames(hall, mySeats) →
frames`), `src/seats/window.ts` (pure: is the card shown at `now` for the Shabbat), `src/views/SeatCard.tsx`
(P24), `src/views/SeatPage.tsx` (P25), `src/views/admin/SeatPrint.tsx` (P26, web print + phone PDF via the
same approach the schedule print will use — for now `window.print()` on web and the existing share/print
path on native if one exists, else "בקרוב"), fixtures in `src/client/fixtures.ts`, i18n he/en, the Home
slot order from §15, a route to the seat page (deep-link `screen: 'seats'`), a gabbai entry to the print;
tests `tests/seats.test.ts`.

- [ ] Tests first: hall has 205 seats and 5 named blocks; frame for a mid-hall seat = rows r−2..r+2 of
      that block; edge clipping; split seats rule; window open/closed around Thu 12:00/Fri 12:00
      Asia/Jerusalem incl. a DST-change week; deep-link `screen:'seats'` routes to the seat page.
- [ ] Views per P24/P25/P26, behind the flag; dev web build sets the flag. Visual check; commit.
