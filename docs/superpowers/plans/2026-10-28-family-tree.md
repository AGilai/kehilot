# Family tree — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** members draw their family tree (parents up to 6 generations, our couple, children, married children,
grandchildren) and fill a short form per figure; the app builds the aliyah, Mi Sheberach and memorial names, suggests
the bar mitzvah Shabbat, and gabbaim read the tree and an "upcoming simchas" list.

**Architecture:** the tree is a `people` list on the existing family item (`F#<familyId>`, version-checked writes,
like `children` today), validated strictly on the server. All name/date logic is pure TypeScript in `src/tree/`
(shared by the tree, the sheet and the gabbai views); the server validates shape and computes only what gabbaim
need (simchas list) with `pyluach`. Figures are parametric SVG strings rendered through `expo-image` (as `kit/Icon.tsx`
does) — no new dependency.

**Tech Stack:** Expo/React Native + web, TypeScript (`node --test` via `npm test`), Python 3 Lambda (`server/cloud/`),
DynamoDB single table, `@hebcal/core` 6.14.2 (client), `pyluach` 2.3.0 (server, already vendored).

**Spec:** `docs/UX-DESIGN.md` §17 (17.1–17.14) and frames P31–P36 (`design/mockups/frames/`); owner decisions §17.11
and the CTO decisions §17.10 are binding. Seat rules elsewhere are not part of this plan.

## Global Constraints

- Tree shows icon + first name only (+ gold dot "missing", candle + "ז״ל" for deceased); every detail is in the sheet.
- Names (§17.5): aliyah = `hebrewFirst + (male ? " בן " : " בת ") + fatherHebrewFirst + (kohen ? " הכהן" : levi ? " הלוי" : "")`;
  Mi Sheberach = `hebrewFirst + בן/בת + motherHebrewFirst`; memorial = aliyah name + " ז״ל". Tribe for men only.
- One source per name: a parent's name lives on the parent's figure; children read it ("מהעץ").
- Tribe defaults from the father's figure when a figure is created; editable afterwards.
- Hebrew dates are stored exactly: months `nisan…elul, tishrei…shevat, adar, adar_i, adar_ii` (the same keys as the aliyot
  engine's `MONTH_NUMBERS`); `adar_i`/`adar_ii` only in leap years, plain `adar` only in regular years. No yahrzeit calculation.
- Bar mitzvah (boys): suggestion = the Shabbat of, or after, the 13th Hebrew birthday, Israeli parasha cycle; a manual
  choice is any date the family picks (Hebrew or Gregorian), snapped to that week's Shabbat after confirmation;
  stored as `{date: 'YYYY-MM-DD', parasha, manual: bool}`. Girls: bat mitzvah date (12th Hebrew birthday), info only.
- Limits: 20 children, 20 grandchildren per married child, 6 generations up; names ≤ 40 chars.
- Visibility: the family's adults read/write; the Kehila's gabbaim read (read-only); listeners and other members nothing.
  Simchas list shows first name, surname, date only — gabbaim only, never in a push or log.
- Invented names only in tests/fixtures (ישראל ישראלי, דוגמה, ניסיון); never real congregants.
- Server: `.venv/bin/python -m unittest discover -s server/tests`; client: `npm test`, `npm run typecheck`.

## Review Focus

1. A leap-year date with plain `adar`, or `adar_ii` in a regular year — rejected server-side, never silently mapped.
2. A father's name edited after 7 children exist — every child's computed name updates; no copy kept on the children.
3. Two adults saving the tree at once — the second gets 409 and the client reloads; nothing is lost silently.
4. A member asking for another family's tree, or a gabbai of another Kehila — 403/404.
5. Bar mitzvah when the 13th birthday falls on Shabbat itself, on 30 Cheshvan/Kislev in a short year, and in Adar of a
   leap year — the suggestion matches `@hebcal/core`; a family's manual choice survives a birth-date change.

---

### Task 1: tree model and name/date logic (client, pure)

**Files:** create `src/tree/types.ts`, `src/tree/names.ts`, `src/tree/dates.ts`, `src/tree/relations.ts`;
test `tests/treeNames.test.ts`, `tests/treeDates.test.ts`, `tests/treeRelations.test.ts`.

**Interfaces — Produces:**
- `type Person = { id: string; relation: Relation; of?: string /* the person id this one is father/mother/child/spouse of */;
  gender: 'm'|'f'; hebrewFirst?: string; surname?: string; fatherName?: string; motherName?: string;
  tribe?: 'kohen'|'levi'|'yisrael'; birth?: HebDate; deceased?: boolean; death?: HebDate;
  barMitzvah?: { date: string; parasha: string; manual: boolean }; figure?: FigureOptions }`
  with `Relation = 'self'|'spouse'|'father'|'mother'|'child'|'childSpouse'|'grandchild'` and
  `HebDate = { day: number; month: MonthKey; year?: number }`.
- `aliyahName(tree, id)`, `prayerName(tree, id)`, `memorialName(tree, id)` → `{ text: string; missing: ('father'|'mother'|'first')[] }`.
- `isComplete(tree, id): boolean`; `fatherOf(tree, id)`, `motherOf(tree, id)`, `childrenOf(tree, id)`, `generationUp(tree, id): Person[]`.
- `monthsOf(year): MonthKey[]`, `toGregorian(d: HebDate): string`, `fromGregorian(iso): HebDate`,
  `barMitzvahSuggestion(birth: HebDate): {date, parasha}`, `batMitzvahDate(birth): string`, `shabbatOfWeek(iso): {date, parasha}`.

- [ ] Tests first: the §17.5 name formula incl. "הלוי"/"הכהן", women "בת", missing father → `missing:['father']`,
  double first names kept whole; a father-name change seen by all children (names are read, never copied);
  `monthsOf(5784)` contains `adar_i`,`adar_ii` and not `adar`, `monthsOf(5785)` the reverse; bar mitzvah for a boy born
  on a Shabbat-anniversary, on 30 Cheshvan in a short year, in Adar of a leap year — each compared to `@hebcal/core`;
  the doc example (birth י״ד כסלו תשע״ו → "וישלח", 2028-12-02); `shabbatOfWeek` for a Wednesday returns that week's
  Shabbat; `generationUp` stops at 6. Run red, implement, green, commit.

### Task 2: server — tree storage, validation, gabbai read

**Files:** create `server/cloud/tree_rules.py`, `server/cloud/routes_tree.py`; modify `server/cloud/repo_families.py`
(`update_people(k, family_id, change)` mirroring `update_children`), `server/cloud/handler.py` (routes),
`server/cloud/export.py` (tree in the member's export), `server/API.md`; test `server/tests/cloud/test_tree.py`.

**Interfaces — Produces:** `GET /v1/kehilot/{k}/family/tree` → `{people, version}` (family adults);
`PUT /v1/kehilot/{k}/family/tree` body `{people, ifVersion}` → 200 `{version}` | 409; `GET /v1/kehilot/{k}/admin/families/{familyId}/tree`
(gabbai, read-only). `tree_rules.validate_people(people, today) -> list` (raises `ApiError(400, code)`).

- [ ] Tests first: shape and enums (relation graph: every `of` exists, one `self`, ≤1 spouse, child limit 20,
  grandchildren 20 per married child, 6 generations, names ≤ 40); Adar rule both ways (`pyluach` leap check);
  death before birth / birth in the future → 400; 409 on a stale `ifVersion`; member of another family 403, other
  Kehila 404, listener 403, gabbai read 200 and gabbai PUT 403; lazy migration: a family with today's `children`
  and no `people` returns them as `child` entries (same ids) and the children routes keep working by editing those
  entries (one source: `people`; `children` is derived on read for old clients); the family's deletion/export
  includes the tree. Run red, implement, green, commit.

### Task 3: figures (client)

**Files:** create `src/tree/figures/parts.ts`, `src/tree/figures/figure.ts`, `src/tree/Figure.tsx`; test `tests/treeFigures.test.ts`.

**Interfaces — Produces:** `figureSvg(opts: { style: 'B'|'A'; stage: AgeStage; gender; options: FigureOptions; deceased: boolean; dark: boolean }): string`;
`stageOf(birth?: HebDate, relation, today): AgeStage` (baby 0–1, toddler 1–3, child 4–8, older 9–12 boys / 9–11 girls,
teen 13–17 boys / 12–17 girls, young adult 18+, adult, older); `<Figure person size style />`.
`FigureOptions = { headCovering?: 'tichel'|'hat'|'wig'|'none'; coverColor?: string; kippah?: 'knitted'|'small'|'velvet'|'none'; beard?: 'none'|'short'|'full'; glasses?: boolean; skin?: 0|1|2; hair?: string }`.

- [ ] Port the parts from `design/mockups/frames/P34.html`/`P35.html` (§17.13): generation defaults (grandmother = large
  beret, our generation = long tichel, grandfather/father = large knitted kippah), children grow by `stageOf`, married
  child = couple in one tile (our child in front, tekhelet marker), deceased = ash + candle. Tests: `stageOf` boundaries
  (bat mitzvah at 12), defaults per generation, deceased variant, every option yields a well-formed SVG string with
  no external references. Visual check of both styles at 390 light/dark against P34. Commit.

### Task 4: tree screen (P31, P33)

**Files:** create `src/views/tree/TreeScreen.tsx`, `src/views/tree/TreeList.tsx`, `src/client/tree.ts` (API calls,
409 reload); modify `src/views/me/*` (P2 entry "עץ המשפחה ושמות לעלייה" + missing count), i18n he/en (`tree.*` keys from §17.9).

- [ ] Per §17.2/§17.6: parents row, couple card, children grid (3 columns, married child one tile, "+ ילד/ה"),
  "▲ ההורים שלהם" re-centring with breadcrumb and back, list view (Segmented remembered per device), empty state,
  privacy line; wide side panel from 900 px. Pure helpers test-first (`treeLayout(tree, centreId)` → rows; missing
  count). Visual check 390 he/en light/dark (7 children; 5 children 4 married; empty) and 1280. Commit.

### Task 5: person sheet and figure picker (P32, P35)

**Files:** create `src/views/tree/PersonSheet.tsx`, `src/views/tree/BarMitzvahPicker.tsx`, `src/views/tree/FigurePicker.tsx`.

- [ ] Short forms per figure (the §17.4 table), computed name card with the incomplete state, "מהעץ" read-only parent
  fields (typing a missing parent name creates/fills the parent figure), tribe chips (men), Hebrew-first date selects
  with exact Adar, alive/deceased; the "זה גם שם האב של n הילדים" banner and toast; married child switch child/spouse
  with grandchildren rows; remove (children/spouses) vs clear (parents). Bar mitzvah card: suggestion Tag "הצעה";
  "שינוי השבת" opens the picker (Hebrew/Gregorian Segmented; weekday → offer that week's Shabbat; Tag "נקבע ידנית";
  back to the suggestion; on birth-date change keep the manual choice and ask). Girls: bat mitzvah date, info only.
  Figure picker (P35): ≤ 5 rows, live preview, children colours/glasses only; any family adult may set it.
  Pure sheet state test-first (`sheetReducer`: create child inherits surname and tribe, edit father updates names,
  manual Shabbat kept on birth change). Visual check. Commit.

### Task 6: gabbai — read-only tree and upcoming simchas (P11 link, P36)

**Files:** create `server/cloud/simchas.py`, route `GET /v1/kehilot/{k}/admin/simchas?weeks=8` in `routes_tree.py`;
`src/views/admin/Simchas.tsx`, Overview card, P11 "עץ המשפחה ›" (read-only TreeScreen); test `server/tests/cloud/test_simchas.py`.

**Interfaces — Produces:** `upcoming_simchas(families, today, weeks=8) -> [{week, shabbat, parasha, items:[{kind:'bar'|'bat', firstName, surname, date, manual}]}]`.

- [ ] Tests first: next 8 weeks from Israel `today`; bar mitzvah from the stored `barMitzvah` (or the suggestion when none
  stored, computed with `pyluach`, matching Task 1 on the same dates); bat mitzvah = 12th Hebrew birthday; quiet weeks;
  only first name, surname, date, kind, manual in the response; gabbai only (member 403). Client per §17.14 with
  filter chips and "הוספה למזל טוב בגיליון השבועי" (marks this week's simchas for the weekly sheet's mazal tov section,
  gabbai confirms there). Commit.

### Task 7: smoke and deploy (controller, after the owner's infra apply)

Extend `tools/smoke_dev.py` (`check_tree`: PUT/GET with a stale-version 409, gabbai read, simchas shape); deploy with the
standard apply sequence once the owner unblocks applies; web deploy.
