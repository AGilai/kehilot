# The graphical member seat form (P37–P39) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The member's seat screen becomes the P37 form. It has the synagogue-chair glyph, a compact map (his rows full
size, ±2 rows as tiny chairs, the aisle lane), number circles kept in sync with the map, one "שליחה" for both prayers,
and no tab bar. After a successful send the screen closes itself and Home shows the Toast "נשמר".

**Architecture:** The server stays the authority for which seats a count frees. `seating_week.free_order` (rear row
first, then far from the aisle; the head's aisle seat last) replaces "highest order first" for the member's circles
and for the gabbai's responses upload. `GET …/seats/me` gains `freeOrder` (orders only), `answeredAt`, `updatedByAt`,
and per frame `lanes` and `gapAbove`. None of these says anything about other families. The client keeps a pure form
model (`src/seats/seatForm.ts`) and a pure chair-SVG builder (`src/seats/chairSvg.ts`). The views are a `SeatChair`
image, a `SeatMap` card, `NumberCircles` and a rewritten `SeatPage`. Home's `homeSeatSlot`, `SeatCard` and `SeatRow`
are unchanged and keep opening `nav.tab === 'seats'`.

**Tech Stack:** Python 3.12 Lambda (`server/cloud/`, moto + `unittest`), Expo / React Native + web (`src/`,
`node --test`, `tsc`), expo-image data-URI SVG (the app's existing icon path), headless Chromium via
`~/tools/qa-browser`.

**Spec:** `docs/UX-DESIGN.md` §15.10.1–15.10.13 (§15.10.5 excluded), including the owner decision at the end of
§15.10.11 (commit 639cafa). Frames: `design/mockups/frames/P37.html`, `P38.html`, `P39.html`. P25's rules (§15.3) still
hold.

## Global Constraints

- **No new native dependencies.** `react-native-svg` is **not** in `package.json` or `node_modules` (checked
  2026-10-29), and there is no `expo-haptics`. So `SeatChair` is built the way `src/kit/Icon.tsx` and the tree figures
  are built: an SVG string drawn by `expo-image` from a `data:image/svg+xml` URI. It keeps the spec's interface
  `SeatChair {state, icon, size}` and draws each part as its own shape. The flip animation is `Animated` scaleX. There is
  **no haptic tick**, because that would need a native module.
- **Privacy (P25, binding):** a member gets only his block(s) and his rows ±2. He never gets the whole hall or a
  mini-map, never another family's name, ids or state (`other` cells stay exactly `{kind: 'other'}`), and never a seat
  number or seat id. New fields carry only his own family's orders and timestamps, and the block's own shape (`lanes`,
  `gapAbove`). Any change to `server/cloud/seating_week.py` or `routes_seatweek.py` gets an **Opus review** before the
  next task starts.
- **Release order (§15.10.4, one rule for the member and for the gabbai's count upload):** rear row first, then the
  rows in front of it. Within a row, the seat with the largest aisle distance goes first. Aisle distance is the number
  of seats (anyone's) between this seat and "the aisle" edge of its block, in that row. A block side is a lane when
  the column just outside the block is inside the hall and belongs to no block. The hall's outer edges are walls. "The
  aisle" is the only lane, or, with lanes on both sides, the lane closer to the bimah's centre column (the mean column
  of all `bimah` cells). **CTO default (no owner decision):** when there is a tie or no bimah, the right lane counts. If
  a block has no lane, every distance is 0, so the order falls back to the family order reversed. Ties go to the
  higher family order first.
- **Copy:** keys and texts are verbatim from §15.10.10. Keys that the spec implies but does not list are fixed in Task 2.
  Every key goes in both `src/i18n/he.json` and `src/i18n/en.json` with the same placeholders.
- **Names:** invented only (משפחת דוגמה, בדיוני; Mia Member, Quinn Quiet).
- **Dates:** the Shabbat line uses `dualDate` from `src/dates.ts` (Hebrew first, Gregorian in brackets). `{day} {time}`
  comes from `whenParts` and is joined with U+00A0.
- **Roles:** use `isAdult` / `isManagement` from `src/client/roles.ts` (management = gabbai or tech). The server uses
  `authz.ADULTS`. There are no role literals.
- **The hall does not mirror:** the map row is `direction: 'ltr'` in both languages, and only the text flips (§15.10.9).
- **Shared files:** before editing `src/i18n/*.json`, `src/views/Main.tsx`, `src/client/fixtures.ts`,
  `server/API.md` or `server/cloud/routes_seatweek.py`, run `git status`. On 2026-10-29 `src/i18n/*.json` already had
  someone else's uncommitted edits. If a file you need has uncommitted changes you did not make, stop and tell the
  controller.
- **Visual check (Tasks 3 and 4):** run one headless Chromium at a time, with nothing else heavy running.
  1. Start `EXPO_PUBLIC_SEATS_PREVIEW=1 npm run web:fixtures` with `run_in_background`. It serves on port 8081. **Never
     use port 3000.**
  2. URLs have the form `http://localhost:8081/?role=member&lang=he&screen=<s>[&card=<c>]`. Take shots with
     `cd /home/ubuntu/tools/qa-browser && node act.mjs '<url>' <out>-he-light.png 390 844 [click:<css>…]`. For dark,
     run the same command with a final `dark` step. For wide, run
     `node shoot.mjs '<url>' <out>-1280.png --width 1280 --height 900`. PNGs go to
     `/tmp/claude-1000/kehilot-shots-seatform/`.
  3. Read each PNG against the spec. Check: no horizontal scroll at 390, nothing clipped, red, green and grey chairs
     readable in light and dark, and every state shown by an icon plus a word.
  4. Stop the server: run `ps -eo pid,args | grep '[e]xpo start --web --port 8081'`, then `kill <pid>`. Never use
     `pkill -f`.
  5. Report what was not checked: devices, 360 width, screen readers, English unless shot, and the flip on native.
- **Test IDs (for the shots):** `seat-fold`, `seat-chair-<k>`, `seat-circle-<n>`, `seat-same`, `seat-send`,
  `seat-seg-arvit`, `seat-seg-shacharit`.
- **Commits:** one per task. Use `git add <paths>` by name only, never `-A` or `.`. The message ends with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01FRubJBqpXEVMb7vLFxbfwk`. Do not `git push`.
- **Tests:** `npm test`, `npm run typecheck` and `npm run test:server` are all green at the end of every task. For one
  module, run `.venv/bin/python -m unittest server.tests.cloud.<module> -v` or `node --test tests/<file>.test.ts`.
- **Implementers:** Sonnet subagents do Tasks 1–4. Opus reviews Task 1 before Task 2 starts. The controller runs Task 5.
- **Out of scope:**
  - §15.10.5 special events (P39 left half).
  - Push notification actions and the Safari "preNotComing" banner. These need notification categories the app does not
    have.
  - The haptic tick.
  - The glyph in the P24 card title and in the P26 print. The spec defers both to their next redraw.
  - The P38 "א · נשלח" screen. The owner's 2026-10-29 decision replaces it: close to Home, with the Toast "נשמר".

## Review Focus

1. **Another family saves while he sends.** The week item is shared, so his PUT can get 409 `week_changed`. When his
   own seats are unchanged, the existing silent retry saves and the screen still closes with "נשמר". When his seats
   changed, the screen stays open with `seats.updatedNow` and shows no Toast. Test: Task 2,
   `afterSend: saved closes, updated stays`.
2. **Half a send.** ליל שבת saves, then שבת בבוקר fails on the network. The screen stays open with the error. Pressing
   Send again sends only שבת בבוקר: ליל שבת is now answered on the server and equal to the draft. Test: Task 2,
   `saveChoices after a partial save sends only the rest`.
3. **Opened from "עריכה" after "לא מגיעים השבת".** All seats are released and both prayers are answered. Both segments
   show "לא מגיעים", circle N is selected, and the button reads "שליחת השינויים", disabled until something changes.
   Test: Task 2, `initDraft: all freed and answered opens as N, sendChanges disabled`.
4. **Web deployed before the Lambda, or an old fixture, with no `freeOrder`, `lanes` or `gapAbove`.** The form still
   works: the fallback order is family order reversed (today's rule), there are no lanes and no gap. Test: Task 2,
   `memberFromWire without the new fields falls back`.
5. **More than 7 seats.** The spec says at most 7, but nothing enforces it. Circles wrap onto a second line instead of
   overflowing at 390. Test: Task 2, `circleLayout`, with the n = 9 case.

---

### Task 1: server — free order, lanes, gap and own timestamps on `seats/me` (Opus review after)

**Files:**
- Modify: `server/cloud/seating_week.py` (new `lanes`, `head_side`, `free_order`; `to_release` takes the free order;
  `frames` adds `lanes`, `gapAbove`)
- Modify: `server/cloud/routes_seatweek.py` (`_out_member` adds `freeOrder`, `answeredAt`, `updatedByAt`; the responses
  apply at about line 352 uses `wk.to_release(wk.free_order(layout, ordered), count)`)
- Modify: `server/API.md:603` (the new fields), `:609` ("frees seats from the highest family order" becomes "frees
  seats in the free order (§15.10.4)")
- Create: `server/tests/cloud/test_seat_aisle.py`
- Modify: `server/tests/cloud/test_seatweek.py`

**Interfaces:**
- Produces (Python):
  - `lanes(layout, block) -> list[str]`, a subset of `['left', 'right']` in that order.
  - `head_side(layout, block) -> str | None`.
  - `free_order(layout, ordered: list[str]) -> list[str]`: seat ids, first to free first.
  - `to_release(free_ordered, count) -> set`: the first `count`, clamped.
- Produces (wire, `GET`/`PUT …/seats/me` with seats):
  - `freeOrder: number[]`, a permutation of the orders `1..n`.
  - `answeredAt: {erev: ms|null, day: ms|null}`: his family's own `answered[ref]`.
  - `updatedByAt: ms|null`: the latest staff `at` among his seats.
  - Each frame gains `lanes: ('left'|'right')[]` and `gapAbove: bool`. `gapAbove` is true when the window's first row
    is below the hall's first row that holds a seat or bimah cell.

- [ ] **Step 1: Write the failing pure tests** in `test_seat_aisle.py` (plain `unittest.TestCase`). The layout is 9
  columns and 4 rows: blocks A `0–1`, B `3–5`, C `7–8`, with `aisle` cells in columns 2 and 6. Row 0 is `ark`, rows
  1–3 are seats.
  - `test_lanes`: `lanes(A) == ['right']`, `lanes(B) == ['left', 'right']`, `lanes(C) == ['left']`. Make B `3–6` and
    C `7–8` (adjacent): then `lanes(B) == ['left']`.
  - `test_head_side_is_the_lane_nearer_the_bimah`: with `bimah` cells at columns 7–8 of row 3, `head_side(B) == 'right'`.
    With them at columns 0–1, `'left'`. With no bimah, `'right'`.
  - `test_free_order_far_side_first`: with the bimah in C, B's row 1 seats `ordered` = ids at (1,5),(1,4),(1,3) (family
    order). Then `free_order == [id(1,3), id(1,4), id(1,5)]`.
  - `test_to_release_takes_the_first`: `to_release(['x','y','z'], 2) == {'x','y'}`, `(…, 0) == set()`,
    `(…, 9) == {'x','y','z'}`.
- [ ] **Step 2: Write the failing route tests** in `test_seatweek.py`. Use the existing 7-column `LAYOUT`: block
  `שמאל בדיוני` covers columns 0–1 with its lane on the right, and block `ימין בדיוני` covers 3–6 with its lane on the
  left.
  - Extend `test_cut_leaks_nothing_about_others`:
    - Top-level keys add `freeOrder`, `answeredAt` and `updatedByAt`.
    - The frame keys are exactly `{blockName, cols, rowFrom, rowTo, rows, lanes, gapAbove}`.
    - `sorted(body['freeOrder']) == [1, 2]`.
    - The existing "no secrets in the raw JSON" loop still passes.
  - `test_free_order_from_the_far_side_of_the_aisle`:
    - `mine((5,3),(5,4),(5,5))` gives `freeOrder == [1, 2, 3]` and `frames[0]['lanes'] == ['left']`.
    - `mine((5,0),(5,1))` gives `freeOrder == [2, 1]` and `lanes == ['right']`.
  - `test_big_family_rear_row_first`: `mine((3,3),(3,4),(3,5),(3,6),(4,5),(4,6))` gives
    `freeOrder == [5, 6, 1, 2, 3, 4]` and one frame whose rows 3 and 4 are both `mine`.
  - `test_free_order_ignores_who_holds_the_other_seats`: `mine((5,4),(5,5))` and read `freeOrder`, `lanes` and
    `gapAbove`. Then `give(f'family:{self.other}', (5,3), (5,6))` and read again: all three are equal.
  - `test_gap_above`: `mine((5,0))` gives `gapAbove is True`. `mine((1,0))` gives `gapAbove is False`, because row 1 is
    the hall's first seat row.
  - `test_answered_at_is_his_own`:
    - Before any answer, `answeredAt == {'erev': None, 'day': None}`.
    - After his erev PUT, `answeredAt['erev']` is an int and `answeredAt['day'] is None`.
    - Give `quiet-sub`'s family a seat and have it PUT erev. His `answeredAt` is unchanged.
  - `test_updated_by_at`: it is None with no staff change. After a gabbai on-behalf PUT on one of his seats, it is an int.
  - `test_apply_frees_far_from_the_aisle_first`: `mine((5,3),(5,4),(5,5))`. Then `respond released 1` gives
    `released() == {at[(5,5)]}`, and `released 2` gives `{at[(5,5)], at[(5,4)]}`. The existing
    `test_apply_frees_highest_order_first_and_clamps` (block L) must still pass unchanged, because its order is the same
    under the new rule.
- [ ] **Step 3: Run the tests and see them fail:**
  `.venv/bin/python -m unittest server.tests.cloud.test_seat_aisle server.tests.cloud.test_seatweek -v`. Expected: FAIL
  on the missing functions and keys.
- [ ] **Step 4: Implement** the four functions and the new fields to the rules in Global Constraints ("Release order").
  - Sort key in `free_order`: `(-row, -distance, -family_index)`.
  - `answeredAt[p]` = `((raw[p] or {}).get('answered') or {}).get(ref)`.
  - Reuse the `staff` list `_out_member` already builds for `updatedByAt`.
  - Update `API.md` lines 603 and 609 in the same words as the Interfaces block.
- [ ] **Step 5: Run the tests and see them pass:** the same command, then `npm run test:server`. Expected: all PASS.
- [ ] **Step 6: Commit**
  ```bash
  git add server/cloud/seating_week.py server/cloud/routes_seatweek.py server/API.md server/tests/cloud/test_seat_aisle.py server/tests/cloud/test_seatweek.py
  git commit -m "Server: seats free from the far side of the aisle; seats/me gains freeOrder, lanes, gapAbove, own timestamps"
  ```
- [ ] **Step 7: Opus review** of the diff against Global Constraints "Privacy" and "Release order". Fix the findings
  before Task 2.

### Task 2: client — wire, fixture, form model, chair SVG and copy (pure)

**Files:**
- Modify: `src/seats/wire.ts`. Add `Side`. Add `freeOrder?`, `answeredAt?` and `updatedByAt?` to `MemberWire`, and
  `lanes?` and `gapAbove?` to `WireFrame`. Add `lanes` and `gapAbove` to `SeatFrame`. Add `freeOrder`, `answeredAt` and
  `updatedByAt` to `MemberSeats`. Fill them in `memberFromWire`.
- Create: `src/seats/aisle.ts`, a TS mirror of Task 1's rule, used only by the fixture.
- Modify: `src/seats/fixtureSeats.ts`, `src/seats/access.ts:10`, `src/client/fixtures.ts:35`. Add the new fields to
  `memberWire()`. Add a `big` variant on screen `seats-big`.
- Create: `src/seats/seatForm.ts`, `src/seats/chairSvg.ts`
- Modify: `src/kit/Icon.tsx`. Export `ICON_PATHS` (today's `PATHS`). Add `ark`, copied from P37 `<symbol id="ark">`:
  `<path d="M5 21V9a7 7 0 0 1 14 0v12zM12 4v17M9 13h.01M15 13h.01"/>`.
- Modify: `src/i18n/he.json`, `src/i18n/en.json` (the `seats.form` object)
- Test: `tests/seatForm.test.ts` (new), `tests/seatAisle.test.ts` (new), `tests/seatsWire.test.ts`

**Interfaces:**
- Consumes: Task 1's wire fields.
- Produces (`wire.ts`):
  - `type Side = 'left' | 'right'`.
  - `SeatFrame.lanes: Side[]` and `SeatFrame.gapAbove: boolean`.
  - `MemberSeats.freeOrder: string[]`: keys `String(k)`, first to free first.
  - `MemberSeats.answeredAt: Record<Prayer, number | null>` and `MemberSeats.updatedByAt: number | null`.
- Produces (`aisle.ts`): `laneSides(layout: WireLayout, blockIndex: number): Side[]`,
  `headSide(layout: WireLayout, blockIndex: number): Side | null`,
  `freeOrderIds(layout: WireLayout, orderedIds: string[]): string[]`.
- Produces (`seatForm.ts`):
  - Seats and order:
    - `autoRelease(m: MemberSeats, count: number): Set<string>`.
    - `isAutoChoice(m: MemberSeats, released: ReadonlySet<string>): boolean`.
    - `headKey(m: MemberSeats): string | null`: the last key of `freeOrder`.
    - `mineRowLabels(f: SeatFrame): string[]`.
  - Draft:
    - `type PrayerDraft = { released: Set<string>; answered: boolean; custom: boolean }` and
      `type FormDraft = Record<Prayer, PrayerDraft>`.
    - `initDraft(m: MemberSeats): FormDraft`.
    - `pickCount(d: FormDraft, m: MemberSeats, p: Prayer, n: number): FormDraft`.
    - `tapChair(d: FormDraft, m: MemberSeats, p: Prayer, key: string): FormDraft`.
    - `copyArvit(d: FormDraft): FormDraft`.
    - `changed(d: FormDraft, m: MemberSeats, p: Prayer): boolean`.
    - `saveChoices(d: FormDraft, m: MemberSeats): Partial<Record<Prayer, ReadonlySet<string>>>`: the prayers that
      changed or are not answered on the server.
  - Screen state:
    - `type FormMode = 'noSeats' | 'notSent' | 'closed' | 'answered' | 'new'` and `formMode(m: MemberSeats): FormMode`.
    - `type Footer = { kind: 'next'; to: Prayer } | { kind: 'send'; enabled: boolean } | { kind: 'sendChanges'; enabled: boolean }`
      and `footerOf(d: FormDraft, m: MemberSeats, selected: Prayer): Footer | null`. It is null when `!m.open`.
    - `type Hint = 'none' | 'zero' | 'some' | 'someRear' | 'all' | 'custom' | 'sent'` and
      `hintOf(pd: PrayerDraft, n: number, multiRow: boolean, locked: boolean): Hint`.
    - `type SegState = { kind: 'unanswered' } | { kind: 'all' } | { kind: 'none' } | { kind: 'free'; n: number }` and
      `segState(pd: PrayerDraft, n: number): SegState`.
    - `circleLayout(n: number, width: number): { size: number; gap: number; wrap: boolean }`.
    - `afterSend(r: SaveResult | null): 'close' | 'stale' | 'none'`.
- Produces (`chairSvg.ts`):
  - `type ChairState = 'kept' | 'free' | 'other'` and `type ChairIcon = 'user' | 'check' | 'lock'`.
  - `CHAIR_COLORS`: the light and dark values from §15.10.3, verbatim.
  - `chairSvg(o: { state: ChairState; icon: ChairIcon | null; dark: boolean; grey: { fill: string; seam: string } }): string`.

- [ ] **Step 1: Write the failing tests.**
  - `tests/seatsWire.test.ts`:
    - `memberFromWire maps the new fields`: `freeOrder [2,1]` becomes `['2','1']`, `lanes ['left']` is kept,
      `gapAbove true` is kept, and `answeredAt.erev` becomes `answeredAt.arvit`.
    - `memberFromWire without the new fields falls back`: with 3 seats and no `freeOrder`, the result is
      `['3','2','1']`. `lanes` is `[]`, `gapAbove` is `false` and `updatedByAt` is `null`.
  - `tests/seatAisle.test.ts`: the same four cases as Task 1 Step 1, on a `WireLayout` built in the test, with the same
    expected sides and orders.
  - `tests/seatForm.test.ts`. Build `m` with `freeOrder ['1','2','3']` and n = 3.
    - `autoRelease`: `(m,1)` gives `{'1'}`. `(m,0)` gives `∅`. `(m,5)` gives all three.
    - `isAutoChoice`: `{'1'}` is auto and `{'3'}` is not.
    - `headKey(m) === '3'`.
    - `tapChair` on `'3'`: `released {'3'}`, `answered true`, `custom true`. A following `pickCount(…, 1)` gives `{'1'}`
      and `custom false`.
    - `copyArvit` copies the set (not the same object) and sets `answered`.
    - `initDraft: all freed and answered opens as N, sendChanges disabled`: with all released and both answered,
      `segState` is `{kind:'none'}` for both. `formMode === 'answered'`, and
      `footerOf(...) === {kind:'sendChanges', enabled:false}`.
    - `footerOf` on a new form:
      - Nothing answered: `{kind:'send', enabled:false}`.
      - Arvit answered while arvit is selected: `{kind:'next', to:'shacharit'}`.
      - Arvit answered while shacharit is selected: `{kind:'send', enabled:false}`.
      - Both answered: `{kind:'send', enabled:true}`.
      - Closed: `null`.
    - `hintOf`: covers `none`, `zero`, `some`, `someRear` (multiRow), `all`, `custom`, and `sent` (locked).
    - `formMode`:
      - Seat count 0 gives `noSeats`.
      - Closed and unanswered gives `notSent`.
      - Closed with one answer gives `closed`.
    - `saveChoices after a partial save sends only the rest`: `m` has arvit answered with `{'1'}`. The draft has arvit
      `{'1'}` and shacharit `{'1','2'}` answered. The result has only the key `shacharit`.
    - `afterSend: saved closes, updated stays`: `{kind:'saved'}` gives `'close'`, `{kind:'updated'}` gives `'stale'`,
      and `null` gives `'none'`.
    - `circleLayout`:
      - `(3, 358)` gives `{size:52, gap:12, wrap:false}`.
      - `(7, 358)` gives `size 44`, `wrap false`, and `8*44 + 7*gap <= 358`.
      - `(9, 358)` gives `wrap: true`.
    - `chairSvg`:
      - `kept` light contains `#B8322E` and `#B87A43`, and no `stroke-dasharray`.
      - `free` dark contains `#6FC283`, and `stroke-dasharray` appears on 3 parts.
      - `other` contains neither `#B87A43` nor `#B8322E`.
      - `icon 'lock'` contains `ICON_PATHS.lock`.
    - Fixture: `fixtureMemberSeats`/`createSeatsFixture` wire.
      - The `default` variant gives `freeOrder [1,2,3]`, the frame `lanes ['left','right']` (block CR) and
        `gapAbove true`.
      - The `big` variant gives 7 seats, R row 3 hall columns 24–28 plus row 4 columns 27–28,
        `freeOrder [6,7,1,2,3,4,5]` and `lanes ['left']`.
- [ ] **Step 2: Run them and see them fail:** `node --test tests/seatForm.test.ts tests/seatAisle.test.ts tests/seatsWire.test.ts`.
- [ ] **Step 3: Implement.**
  - **`aisle.ts`** mirrors the Python exactly.
  - **The `big` fixture** claims its 7 seats by filtering them out of the other allocations inside the variant only.
    `fixtureSeatHall`'s `taken` set stays unchanged, so the other variants' pseudo-random data and their tests don't move.
  - **`chairSvg`** takes its shapes from P37's `svg.ch` (viewBox `0 0 50 62`). The `u bp` / `u bk` / `u cu` parts
    (book-rest, back panel, cushion) are upholstery. The `w` / `w dk` parts are wood: `light` / `shade`.
    - The wood stroke is `line`.
    - `kept` upholstery has a thin solid wood-line stroke.
    - `free` upholstery has a `1.8` dashed stroke (`#256B35` / `#8FD49C`).
    - `other` fills every part with `grey.fill` and gives it `grey.seam` strokes.
    - The icon is centred on the back panel, scaled so that it is 19 px when the chair is 56 high. Its colour comes
      from the §15.10.3 table.
  - **`formMode`:**
    - `noSeats` when `seatCount === 0`.
    - `notSent` when `!open` and neither prayer is answered.
    - `closed` when `!open` and either prayer is answered.
    - `answered` when `open` and both are answered on the server.
    - `new` otherwise.
  - **`footerOf`:**
    - It returns `sendChanges` (enabled = some `changed`) exactly when both prayers are answered on the server.
    - Otherwise it returns `next` when the selected prayer is answered in the draft and the other is not.
    - Otherwise it returns `send`, enabled only when both are answered in the draft.
  - **`initDraft`:** `answered` comes from the server, and `custom = !isAutoChoice(...)`.
  - **`circleLayout`** for 6–7 seats: `gap = Math.floor((width - 44*(n+1)) / n)`, at least 4.
  - **i18n** `seats.form.*`:
    - All of the §15.10.10 table, verbatim. `count` uses `{when}` with `whenArvit` "בליל שבת" / "on Friday night" and
      `whenShacharit` "בשבת בבוקר" / "on Shabbat morning". `next` uses `{prayer}`. `foot` and `answered` use
      `{day} {time}` / `{day2} {time2}`.
    - Keys the spec implies:
      - `bothFirst` "עונים על שתי התפילות ושולחים…" / "Answer both prayers, then send…"
      - `noChanges` "אין שינויים לשלוח" / "No changes to send"
      - `byStaffAt` "הגבאי עדכן את המקומות שלכם ב{day} {time}." / "A gabbai updated your seats on {day} {time}."
      - `stateFree` "{n} פנוי" / "{n} free"
      - `stateNone` "לא מגיעים" / "Not coming"
      - `stateAll` "כולם מגיעים" / "Everyone's coming"
      - `pill` "{prayer}: {need} מגיעים · {free} פנוי" / "{prayer}: {need} coming · {free} free"
      - `cardRow` "{block} · שורה {row} · {n} מקומות" / "{block} · row {row} · {n} seats"
      - `cardRows` "{block} · שורות {from}–{to} · {n} מקומות" / "{block} · rows {from}–{to} · {n} seats"
      - `chair` "{block}, שורה {row}, מקום {k} מתוך {n}{aisle} / {state}" / "{block}, row {row}, seat {k} of {n}{aisle} / {state}"
      - `nearAisle` ", ליד המעבר" / ", by the aisle"
      - `circle0` "אף מקום, כולנו מגיעים" / "No seats, we're all coming"
      - `circleK` "{k} מקומות" / "{k} seats"
      - `circleN` "{n}, לא מגיעים" / "{n}, not coming"
      - `segLabel` "{prayer}, {state}" / "{prayer}, {state}"
      - `answeredWord` "נענה" / "answered"
      - `savedToast` "נשמר" / "Saved"
- [ ] **Step 4: Run the tests and see them pass:** the same command, then `npm test` and `npm run typecheck`. Expected:
  PASS. `tests/i18n.test.ts` stays green.
- [ ] **Step 5: Commit**
  ```bash
  git add src/seats/wire.ts src/seats/aisle.ts src/seats/fixtureSeats.ts src/seats/access.ts src/client/fixtures.ts src/seats/seatForm.ts src/seats/chairSvg.ts src/kit/Icon.tsx src/i18n/he.json src/i18n/en.json tests/seatForm.test.ts tests/seatAisle.test.ts tests/seatsWire.test.ts
  git commit -m "Seats: the form model, chair SVG, aisle mirror, fixture fields and copy for P37"
  ```

### Task 3: client — `SeatChair` and the compact map card

**Files:**
- Create: `src/views/seatForm/SeatChair.tsx`, `src/views/seatForm/SeatMap.tsx`, `src/seats/mapFold.ts`
- Modify: `src/views/SeatPage.tsx`: replace `FrameCard` / `Row` / `Legend` with `SeatMap`. Everything else on the page
  stays until Task 4.
- Test: `tests/seatForm.test.ts` (fold storage)

**Interfaces:**
- Consumes: `chairSvg`, `CHAIR_COLORS`, `headKey`, `mineRowLabels`, `SeatFrame.lanes/gapAbove` (Task 2).
- Produces:
  - `SeatChair({ state, icon, size, flipKey? }: { state: ChairState; icon: ChairIcon | null; size: number; flipKey?: string })`:
    an `Animated.View` around an expo-image. It flips (scaleX 1 → 0 → 1, 150 ms, the new image swapped in at 0) when
    `flipKey` changes. There is no animation when `AccessibilityInfo.isReduceMotionEnabled()` is true.
  - `SeatMap({ frames, released, head, locked, folded, onFold, onTap, wide }: { frames: SeatFrame[]; released: ReadonlySet<string>; head: string | null; locked: boolean; folded: boolean; onFold: (v: boolean) => void; onTap: (key: string) => void; wide?: boolean })`.
  - `readMapFolded(): Promise<boolean>` and `writeMapFolded(v: boolean): Promise<void>`. The key is
    `kehilot.seatMapCollapsed`. On web it uses `localStorage` in try/catch, and on native it uses AsyncStorage. The
    default is open.

- [ ] **Step 1: Write the failing test** `mapFold: default open, round-trips, survives a throwing storage`. Stub
  `globalThis.localStorage`: the first read gives `false`. After `writeMapFolded(true)`, the read gives `true`. A
  storage whose methods throw gives `false` and no throw.
- [ ] **Step 2: Run it and see it fail:** `node --test tests/seatForm.test.ts`.
- [ ] **Step 3: Implement** `mapFold.ts`, `SeatChair` and `SeatMap` to §15.10.2–15.10.3 and §15.10.9.
  - **Card header:**
    - Icon `chair` and `cardRow` / `cardRows`.
    - At the end, a 44-high text button (`seat-fold`) reading `hide` + " ⌃" / `show` + " ⌄". It is not shown when
      `wide` (the map is always open there).
  - **Ark marker:** a small pill with `Icon ark` and `seats.form.ark`, on a 1 px line across the card. Under it, a muted
    "• • •" when `frame.gapAbove`.
  - **Rows, drawn `direction: 'ltr'`:**
    - `row.mine` rows draw his chairs 56 high with the word under them (12 / 800). A row is 74 high.
    - Other rows draw 16-high `other` chairs with no touch, hidden from screen readers.
    - `other` cells in his rows draw `other` chairs at full size, also hidden.
    - Bimah cells keep today's hatched bar.
    - `gap` cells are empty.
  - **Chair cell width:** `min(72, (cardInnerWidth - 34 - 18*lanes.length - gaps) / cols)`. Measure the card width with
    `onLayout`.
  - **Aisle lane** on each side in `frame.lanes`: 18 wide, a dashed centre line, and the vertical word `aisle` in muted
    11.
  - **Row label column:** 34 wide on the reading start side. That is right in Hebrew and left in English, outside the
    lanes. His rows are bold tekhelet 13, the others muted 11.5. Show labels only for rows that hold seats.
  - **His chair** is a `Pressable`:
    - `accessibilityRole="switch"`, `checked` = kept, `disabled` = `locked`.
    - Label `chair`, with `nearAisle` only when `key === head`. `testID` is `seat-chair-<k>`.
    - When not locked: kept gets icon `user` and word `kept` (red), free gets icon `check` and word `free` in a dashed
      6-radius box.
    - When locked: icon `lock`, with the same words.
  - **Folded:** only his seats, as a strip of 38 × 44 chairs (icon only, each with the a11y label), in the same
    left-to-right order. After the strip comes the count (`stateFree` / `stateAll` / `stateNone`).
  - **Web keyboard:** arrow keys move focus between his chairs (`onKeyDown` on the map, web only). Space toggles, which
    RN-web `Pressable` already does.
  - **`SeatPage`:** render one `SeatMap` with all frames. Wire `head = headKey(data)` and `folded` from `readMapFolded`.
    Taps keep today's `toggleRelease`.
- [ ] **Step 4: Run the tests and see them pass:** `npm test` and `npm run typecheck`.
- [ ] **Step 5: Visual check** (Global Constraints):
  - Screens:
    - `seats`, light, dark and 1280.
    - `seats` with `click:[data-testid="seat-chair-1"]`: one green dashed chair.
    - `seats` with `click:[data-testid="seat-fold"]`: the folded strip.
    - `seats-big` (two full rows, 7 chairs at 390).
    - `seats-split`.
    - `seats-closed` (lock icons).
    - `seats&lang=en`: the hall is not mirrored and the labels are on the left.
  - Compare against P37's map panel and P38 ד:
    - the chairs are wood brown in both themes;
    - only the upholstery is red or green;
    - the lanes are on the real side (CR: both; R: left);
    - "• • •" shows under the ark.
- [ ] **Step 6: Commit**
  ```bash
  git add src/views/seatForm/SeatChair.tsx src/views/seatForm/SeatMap.tsx src/seats/mapFold.ts src/views/SeatPage.tsx tests/seatForm.test.ts
  git commit -m "Seat page: the synagogue-chair glyph and the compact map (P37)"
  ```

### Task 4: client — the one-screen form: segments, circles, footer, states, no tab bar, close on send

**Files:**
- Create: `src/views/seatForm/NumberCircles.tsx`, `src/views/seatForm/PrayerSegments.tsx`
- Modify: `src/views/SeatPage.tsx`, a rewrite of `SeatPageReady` on the Task 2 model. Keep `SeatPage`'s export, its
  loading and error branches, and the discard `Sheet`.
- Modify: `src/views/Main.tsx`. Hide the tab bar when `nav.tab === 'seats'`: add it to the condition at the
  `{sidebar || nav.tab === 'compose' || nav.tab === 'update' ? null : …}` line. Pass `onDone`.

**Interfaces:**
- Consumes: everything in Task 2's `seatForm.ts`, and `SeatMap` / `SeatChair` (Task 3).
- Produces:
  - `SeatPage({ week, onBack, onDone, onToast }: { week?: string; onBack: () => void; onDone: () => void; onToast: (text: string) => void })`.
    `Main` passes `onDone={() => setNav({ tab: 'home' })}`.
  - `NumberCircles({ n, value, locked, onPick }: { n: number; value: number | null; locked: boolean; onPick: (k: number) => void })`.
  - `PrayerSegments({ value, states, onChange }: { value: Prayer; states: Record<Prayer, SegState>; onChange: (p: Prayer) => void })`.

- [ ] **Step 1: Implement `PrayerSegments`** to §15.10.2 item 2:
  - Each option is 52 high with two lines: the name (15 bold) and the state (12), with an 8 px dot. An empty ring means
    unanswered; a filled dot means answered.
  - The selected option has a surface fill, a tekhelet border and tekhelet text.
  - `accessibilityRole="tab"`. The name is `segLabel`, built from the prayer and the state words (`answeredWord` plus
    the state).
  - testIDs are `seat-seg-<p>`.
- [ ] **Step 2: Implement `NumberCircles`** to §15.10.4:
  - A `radiogroup` with circles 0 at the start (right in Hebrew). Sizes come from `circleLayout`.
  - Idle: a surface circle with a `line` ring and the number at 19 / 800. Selected: tekhelet fill, on-colour number,
    3 px halo.
  - Circle N: a dashed green ring and a green number. When selected, a solid green fill (`CHAIR_COLORS` green).
  - End captions are `count0` / `countAll`. Names are `circle0` / `circleK` / `circleN`.
  - When `locked`, the circles are dimmed and not pressable, and the selected one stays visible.
  - Web: arrows move between circles and Space picks.
  - testIDs are `seat-circle-<k>`.
- [ ] **Step 3: Rewrite `SeatPageReady`.** It keeps `draft` (`initDraft`), `selected: Prayer` and `busy` / `error` /
  `stale`. Build it as follows.
  - **Header (56):** `BackLink`, `Txt` serif 19 `seats.form.title`, and under it, muted 12.5, `shabbatLine` with
    `dualDate(saturday, lang)`. Keep the preview `Tag`.
  - **`formMode`:**
    - `noSeats`: today's no-seats `Card`, plus the muted `noSeatsLater` line.
    - `notSent`: Banner `notSent` over a folded `SeatMap` (all red, `locked`). No circles, no footer.
    - `closed`: Banner `closed`. The segments still switch. The map shows `locked`. Circles are `locked` with the sent
      count, and the hint is `sent`. No footer.
    - `answered`:
      - Show Banner success `answered`, built from `answeredAt` (the later of the two) and `deadline`.
      - If `updatedByGabbai`, show info `byStaffAt` from `updatedByAt` instead.
      - When `stale`, show `seats.updatedNow`.
    - `new`: the full form.
  - **Body order:** segments, then `SeatMap` (when `frames.length > 0`; with none, the circles alone).
  - **The `same` chip** shows on the shacharit part only, when arvit is answered in the draft. It uses `Chip` with
    `icon="copy"` and the label `same` with arvit's state words. It calls `copyArvit` and is never automatic.
  - **Then:** the question `count` (serif 17), `NumberCircles` (`value` = `released.size` when answered, else null),
    and the hint line `hint.<hintOf(...)>` with `{n}`, in a polite live region (`accessibilityLiveRegion="polite"`).
  - **Taps:** a circle calls `pickCount`. A chair calls `tapChair`, and its `SeatChair` gets `flipKey` = its state.
  - **Fixed footer** (surface, top divider):
    - One `pill` per prayer. The selected one is outlined in tekhelet; an unanswered one shows `unanswered`.
    - The primary `Button` (`seat-send`) comes from `footerOf`:
      - `next` → `next` with the other prayer's name; it switches `selected`.
      - `send` → `send`.
      - `sendChanges` → `sendChanges`.
    - The caption is `bothFirst` when `send` is disabled, `noChanges` when `sendChanges` is disabled, and otherwise
      `foot` with the deadline.
    - Keep `useReportPad()` padding.
  - **Send:** `save(saveChoices(draft, data))`, then act on `afterSend`:
    - `'close'`: `onToast(t('seats.form.savedToast'))`, then `onDone()`.
    - `'stale'`: set `stale` and stay.
    - A throw: set `error` (`useErrorText`) and stay open.
  - **Back:** keeps the discard `Sheet` when `isDirty`.
  - **Wide (≥ 1024 wide, `useWindowDimensions`):** a 1040 column. The title and Shabbat line are at the start. The
    segments (420) are at the end of the title row. Below are two equal columns: the map card first (`wide`, always
    open), and the question, circles, hint, pills and a 200-wide Send beside it.
- [ ] **Step 4: Main.tsx.** Hide the tab bar for `seats`, and wire `onDone` as in Interfaces. Home's `useMemberSeats`
  reloads on remount, so the card or row shows the new state.
- [ ] **Step 5: Run the tests:** `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 6: Visual check** (Global Constraints). Shoot each at 390 he light and dark, and at 1280:
  - `seats`: footer disabled with `bothFirst`.
  - `seats` + `click:[data-testid="seat-circle-1"]`: one green chair far from the CR left lane (k1), the hint `some`,
    and the button "הבא: שבת בבוקר ‹".
  - That, + `click:[data-testid="seat-seg-shacharit"]`: the `same` chip.
  - `seats` + `click:[data-testid="seat-chair-3"]`: the hint `custom`.
  - `seats-big` + circle 2: row 4's two chairs green.
  - `seats&card=seats-done`: the `answered` banner, and `sendChanges` disabled.
  - `seats-gabbai`: the `byStaffAt` banner.
  - `seats-closed`: `notSent`.
  - `seats-closed&card=seats-done`: `closed`, locked chairs, dimmed circles.
  - `seats-none`.
  - `seats&lang=en`: the hall is not mirrored.

  Check against P37/P38: no tab bar, and the fit at 390 × 844 with one row of his (§15.10.2 fit check). The send then
  close-to-Home path cannot be shot in one step: report it as checked by code reading plus the `afterSend` test, unless
  an `act.mjs` click on `seat-send` after both answers lands on Home with the Toast.
- [ ] **Step 7: Commit**
  ```bash
  git add src/views/seatForm/NumberCircles.tsx src/views/seatForm/PrayerSegments.tsx src/views/SeatPage.tsx src/views/Main.tsx
  git commit -m "Seat page: one-screen form with circles, one send for both prayers, no tab bar, close to Home (P37-P39)"
  ```

### Task 5: deploy to dev (controller)

Run by the controller, not a subagent.

- [ ] **Step 1: Run all the tests:** `npm test`, `npm run typecheck` and `npm run test:server`. Expected: all green.
  Report the counts, and that `test_seat_aisle`, `seatForm.test.ts` and `seatAisle.test.ts` ran.
- [ ] **Step 2: Opus whole-branch review** against §15.10, this plan's Global Constraints (privacy and release order
  first) and the Review Focus. Fix the findings, then re-run Step 1.
- [ ] **Step 3: Build and plan:** run `python3 tools/build_lambda.py`, then
  `cd infra/envs/dev && terraform plan -out dev.tfplan`.
  - Expected: only the Lambda code hashes change. If the night run's saved plan (seat_reminders schedule, 1 add and 6
    changes) has not been applied yet, its changes appear too. That is expected.
  - Anything else: stop and report.
- [ ] **Step 4: Hand off:** give the owner `! cd ~/work/kehilot/infra/envs/dev && terraform apply dev.tfplan` and wait.
- [ ] **Step 5: After the apply:**
  1. Run `.venv/bin/python tools/smoke_dev.py`. Expected: all PASS.
  2. Run `npm run deploy:web`. The web goes out **after** the Lambda. The client falls back without the new fields
     anyway (Review Focus 4).
- [ ] **Step 6: Report.**
  - What was deployed.
  - What to try on the phone: Home → "חלק מגיעים" → circles and chairs → Send → back on Home with "נשמר"; the edit state
    from the answered card; dark mode.
  - What was not checked: real devices, 360 width, screen readers, English beyond one shot, the flip on native, and a
    gabbai count upload on real data after the order change.

  Do not `git push` without the owner.
