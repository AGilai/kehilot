# The seat form all week, the Thursday card and the two reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Members reach the seat form from Home all week through a quiet bottom row. The family's men (or, in a family
with no man, its adults) get the full card on top from Thursday 08:00 and up to two scheduled reminder pushes. The
default deadline moves to Friday 14:00, and management sets the reminders and the deadline on one screen.

**Architecture:** The pure time rules (`server/cloud/seat_times.py`, mirrored in `src/seats/times.ts` and
`src/seats/window.ts`, with a parity test) define opening < reminder 1 < reminder 2 < deadline. Recipients
(`server/cloud/seat_reminders.py`) are computed in the push worker at send time. A new `seat_reminders` job runs every
5 minutes on Thursday and Friday (EventBridge Scheduler, Asia/Jerusalem). It claims a conditional marker
`SEATREM#<friday>#<n>` per Kehila, then queues one `seat_reminder` job on the existing push SQS path. The client decides
between card and row from two new `GET …/seats/me` fields (`remindable`, `hadSeats`) and the server's own `deadline`.

**Tech Stack:** Python 3.12 Lambda (`server/cloud/`, DynamoDB single table, moto + `unittest`), Terraform
(`infra/modules/jobs`), Expo / React Native + web (`src/`, `node --test`, `tsc`), headless Chromium via
`~/tools/qa-browser`.

**Spec:** `docs/UX-DESIGN.md` §21 (commits 198159d, dc4ab57), including the owner answers at the end of §21.9, and the
places §21 updated: §15.2 and §15.10.13 (timing, audience), §16.12.6 (open week counts from 08:00), §18.3 (the
"כל שבוע" row). Frame P47 (`seat-reminders.html`) is **not in the repo**: visual checks compare against the §21 text.

## Global Constraints

- **Times (owner, binding, §21.1):** opening **Thursday 08:00** (fixed, shown, not edited). `תזכורת` **Thursday 20:00,
  on**. `תזכורת עדינה` **Friday 11:00, on**. Deadline **Friday 14:00** (Kehila setting `seatDeadline`; Kehilot that saved
  one keep it). Reminders are on **ה׳ or ו׳ only**, in **15-minute steps**. The chain is **opening < first < second <
  deadline**, with **at least 30 minutes** between neighbours. A reminder that is off drops out of the chain.
- **One deadline:** the client never computes the deadline on its own. It shows the server's `deadline` (ISO) from
  `GET …/seats/me` / `GET …/admin/seats/week/{w}`. The client's `DEFAULT_WINDOW` / `DEFAULT_DEADLINE_HM` exist only for
  fixtures, the editor's open-week rule and the form CSV fallback, and a test keeps them equal to the server's
  `seating_week.DEFAULT_DEADLINE` and `seat_times.OPENS`.
- **Every place 12:00 is hard-coded as the seat deadline** (all change to 14:00 or to the shared constant):
  `server/cloud/seating_week.py:13` `DEFAULT_DEADLINE`; `server/cloud/routes_core.py:42` `or '12:00'`;
  `server/API.md:586` "default `12:00`"; `server/tests/cloud/test_seatweek.py:212-221` (the noon test);
  `src/seats/window.ts:3-5` (`DEFAULT_WINDOW`, comment); `src/seats/wire.ts:125-132` (comment and the
  "deadline − 1 day" opening); `src/seats/effectiveFrom.ts:10,38,47` (comments); `src/seats/formCsv.ts:170,179,187`
  (`hm = '12:00'` defaults, "noon" fallback); `src/views/admin/SeatResponses.tsx:104`; `src/seats/fixtureSeats.ts:109`;
  `tests/seats.test.ts:228-262` and `tests/seatsWire.test.ts:96-103`. **Not changed:** the sheet's Friday 12:00 week rule
  (`server/cloud/sheet_rules.py:18`, API.md:462, §19.3/§19.9). It is a different rule.
- **Who (owner, §21.5 and §21.9 answer 2):** the men of the family, meaning its live adults (`Repo.live_adults`, role in
  `authz.ADULTS`) whose figure in the family tree (`family['people']` entry with that `userId`) has `gender == 'm'`. **If
  that leaves no man, every live adult of the family.** This covers the widow, women-only families and unknown gender.
  The same set gets the Thursday card. Other adults keep the bottom row only. A son's own account is never linked to the
  parent family in today's data model (`family['adults']` holds the partners only), so no son is included. Do not build
  that link here.
- **Answered (§21.5, owner answer 1):** `family:<id>` is a key in `answered` of `SEATWK#<friday>#erev` **or**
  `SEATWK#<friday>#day`. **A responses-file upload does not count.** No `answeredFile`, and no change to
  `apply_responses`.
- **Role sets:** server role checks use `authz.MANAGEMENT` (times screen) and `authz.ADULTS` (member). AST guards forbid
  role literals in `server/cloud`. On the client, use the role helpers in `src/client/roles.ts` (tech-role plan Task
  R3). **Precondition: R3 is committed before Task 6.** If `roles.ts` has no `isAdult`, Task 6 adds it.
- **Privacy:** pushes carry the Kehila name and the fixed generic text only. No names, no seat counts, no rows. Push
  `data` is exactly `{kehila, screen: 'seats', week}`. Logs carry ids and counts only: Kehila id, Friday, reminder number
  and counts. Never names, user ids of recipients, tokens or seat refs.
- **Invented names only** in code, tests, fixtures and docs (משפחת דוגמה, ניסיון, בדיוני; Mia Member, Quinn Quiet).
- **Dates:** any date shown is Hebrew first with the Gregorian date in brackets (`dualDate` / `displayDate` in
  `src/dates.ts`). Times are LTR-isolated and tabular. `{day} {time}` never breaks: join them with U+00A0.
- **i18n:** every new string goes in both `src/i18n/he.json` and `src/i18n/en.json` with the same placeholders. Keys
  and texts are verbatim from §21.7. Every new server error code also gets `errors.<code>` in both
  (`tests/i18n.test.ts` checks this).
- **Shared files (other agents commit now):** before editing `server/cloud/handler.py`, `server/API.md`,
  `src/i18n/*.json`, `src/client/fixtures.ts`, `src/views/Main.tsx`, `src/client/roles.ts` or
  `src/client/adminAreas.ts`, run `git status`. If one has uncommitted changes you did not make, stop and tell the
  controller.
- **Visual check (every UI task):** one headless Chromium at a time, nothing else heavy running.
  1. `EXPO_PUBLIC_SEATS_PREVIEW=1 npm run web:fixtures` with `run_in_background` (port 8081; **never port 3000**).
  2. `cd /home/ubuntu/tools/qa-browser && node act.mjs '<url>' <out>-he-light.png 390 844`, the same with a final
     `dark` step for `<out>-he-dark.png`, then `node shoot.mjs '<url>' <out>-1280.png --width 1280 --height 900`. PNGs
     go to `/tmp/claude-1000/kehilot-shots-seatrem/`.
  3. Read each PNG against the §21 text: no horizontal scroll at 390, nothing clipped, dark mode readable, `{day}
     {time}` never split, status shown by an icon plus words.
  4. Stop the server: `ps -eo pid,args | grep '[e]xpo start --web --port 8081'`, then `kill <that pid>`. Never
     `pkill -f`.
  5. Report what was checked and what was not: devices, screen readers, English LTR unless shot, and real push
     truncation.
- **Commits:** one per task. `git add <paths>` by name only, never `-A` or `.`. The message is as given and ends with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01FRubJBqpXEVMb7vLFxbfwk`. No `git push`.
- **Test commands:** `npm test`, `node --test tests/<file>.test.ts`, `npm run typecheck`, `npm run test:server`, and for
  one module `.venv/bin/python -m unittest server.tests.cloud.<module> -v`. All four are green at the end of every task.
- **Implementers:** Sonnet subagents for Tasks 1–9. The controller runs Task 10. Task 4 gets an Opus review before Task
  5 starts, because the once-only send is the riskiest code here.
- **Out of scope (CTO, not built here):** push actions ("לא מגיעים השבת" / "למלא את הטופס") need notification
  categories that the app does not have yet. The §21.9 "open from the first answer" refinement of the editor's open-week
  rule is also not built: only its 08:00 opening changes.

## Review Focus

1. **Two runs overlap or the scheduler retries.** A Lambda retry or a slow run that overlaps the next 5-minute tick must
   not send a reminder twice. Test: Task 4 `test_concurrent_runs_send_once`.
2. **The push arrives after the deadline.** The SQS backoff (up to 900 s) or a run at 13:58 can deliver late. The worker
   must drop a `seat_reminder` job whose deadline has passed, or whose reminder was switched off after the claim. Test:
   Task 4 `test_worker_drops_after_deadline_or_off`.
3. **Management moves a time after a reminder went out.** A reminder already sent this Shabbat is not sent again. A
   moved reminder that has not been sent goes out at its new time. Test: Task 4 `test_moved_reminder_sent_once`.
4. **Saturday night.** Until Shabbat ends, Home shows that Shabbat's final card or row, then the row for the next
   Shabbat. Midnight is not the switch. Test: Task 6 `shabbatFriday: Saturday before and after Shabbat ends`.
5. **A family without a recorded man.** A widow, a family whose tree has no gender, or one whose husband left must still
   get the card and the reminders (all its adults), and must never get nothing. Test: Task 2 `test_audience_rules`.

---

### Task 1: server — the time rules and the 14:00 default

**Files:**
- Create: `server/cloud/seat_times.py`
- Modify: `server/cloud/seating_week.py:13`, `server/cloud/routes_core.py:42`, `server/cloud/routes_seatweek.py:31-32`
  (`_deadline`), `server/API.md:586`
- Test: `server/tests/cloud/test_seat_times.py` (new), `server/tests/cloud/test_seatweek.py:212-221`

**Interfaces:**
- Produces (all in `seat_times`):
  - `DAYS = ('thu', 'fri')`
  - `OPENS = {'day': 'thu', 'time': '08:00'}`
  - `DEFAULT_REMINDERS = {'1': {'on': True, 'day': 'thu', 'time': '20:00'}, '2': {'on': True, 'day': 'fri', 'time': '11:00'}}`
  - `MIN_GAP = 30`, `STEP = 15`
  - `deadline_hm(settings: dict | None) -> str`: the stored `seatDeadline` when valid, else `seating_week.DEFAULT_DEADLINE`
  - `reminders_of(settings: dict | None) -> dict[str, dict]`: the stored `settings.seatReminders` per number, each field
    falling back to `DEFAULT_REMINDERS`
  - `week_minute(day: str, hhmm: str) -> int`: minutes from Thursday 00:00 (`fri` adds 1440)
  - `instant(friday: str, day: str, hhmm: str) -> datetime`: aware, `Asia/Jerusalem` (`thu` is the day before)
  - `parse_reminders(value, current: dict[str, dict]) -> dict[str, dict]`: a patch `{'1'?: {on?, day?, time?}, '2'?:
    …}` merged over `current`. Anything else raises 400 `invalid_seat_reminders`. `time` must be `HH:MM` with minutes
    in 00/15/30/45.
  - `check(reminders: dict, deadline: str, changed: str) -> None`. `changed` is `'deadline'`, `'reminders.1'` or
    `'reminders.2'`. On a broken chain it raises `ApiError(400, 'seat_reminder_after_deadline', 'reminders.<n>')` when
    `changed == 'deadline'`, else `ApiError(400, 'seat_times_order', changed)`.
  - `due(now: datetime, friday: str, reminders: dict, deadline: str) -> list[str]`: the numbers that are on, with
    `instant <= now < deadline instant`, in order.
- `seating_week.DEFAULT_DEADLINE = '14:00'`.

- [ ] **Step 1: Write the failing tests** in `test_seat_times.py` (pure, no moto):

```python
def test_defaults(self):
    self.assertEqual(seating_week.DEFAULT_DEADLINE, '14:00')
    self.assertEqual(seat_times.deadline_hm({}), '14:00')
    self.assertEqual(seat_times.deadline_hm({'seatDeadline': '12:00'}), '12:00')  # a saved value is kept
    self.assertEqual(seat_times.reminders_of(None), seat_times.DEFAULT_REMINDERS)

def test_chain(self):
    r = seat_times.reminders_of(None)
    seat_times.check(r, '14:00', 'reminders.1')                                   # defaults pass
    for n, day, time in (('1', 'thu', '08:15'), ('2', 'fri', '13:45'), ('1', 'fri', '11:00')):
        bad = {**r, n: {**r[n], 'day': day, 'time': time}}
        with self.assertRaises(ApiError) as e:
            seat_times.check(bad, '14:00', f'reminders.{n}')
        self.assertEqual((e.exception.code, e.exception.field), ('seat_times_order', f'reminders.{n}'))
    seat_times.check({**r, '1': {**r['1'], 'time': '08:30'}}, '14:00', 'reminders.1')  # exactly 30 min after opening
    with self.assertRaises(ApiError) as e:
        seat_times.check(r, '11:15', 'deadline')
    self.assertEqual((e.exception.code, e.exception.field), ('seat_reminder_after_deadline', 'reminders.2'))
    off = {**r, '2': {**r['2'], 'on': False}}
    seat_times.check(off, '11:15', 'deadline')                                  # an off reminder leaves the chain

def test_parse_reminders(self):
    cur = seat_times.DEFAULT_REMINDERS
    self.assertEqual(seat_times.parse_reminders({'2': {'on': False}}, cur)['2'], {'on': False, 'day': 'fri', 'time': '11:00'})
    for bad in ({'3': {}}, {'1': {'day': 'sun'}}, {'1': {'time': '20:10'}}, {'1': {'on': 1}}, {'1': {'x': 1}}, [], {'1': None}):
        with self.assertRaises(ApiError):
            seat_times.parse_reminders(bad, cur)

def test_instants_and_dst(self):
    self.assertEqual(seat_times.instant('2026-10-30', 'thu', '20:00').isoformat(), '2026-10-29T20:00:00+02:00')
    self.assertEqual(seat_times.instant('2027-03-26', 'fri', '11:00').isoformat(), '2027-03-26T11:00:00+03:00')  # DST starts that Friday 02:00

def test_due(self):
    r = seat_times.DEFAULT_REMINDERS
    at = lambda d, hm: seat_times.instant('2026-10-30', d, hm)
    self.assertEqual(seat_times.due(at('thu', '19:59'), '2026-10-30', r, '14:00'), [])
    self.assertEqual(seat_times.due(at('thu', '20:04'), '2026-10-30', r, '14:00'), ['1'])
    self.assertEqual(seat_times.due(at('fri', '11:00'), '2026-10-30', r, '14:00'), ['1', '2'])
    self.assertEqual(seat_times.due(at('fri', '14:00'), '2026-10-30', r, '14:00'), [])   # at the deadline: nothing
```

In `test_seatweek.py`, rename `test_deadline_enforced_and_default_is_friday_noon_in_jerusalem` to
`…_default_is_friday_14_in_jerusalem`: 403 at `at(14, 1)`, `deadline` starts with `f'{WEEK}T14:00:00+0'`, 200 at
`at(14, 0)`.

- [ ] **Step 2: Run them to verify they fail.** Run: `.venv/bin/python -m unittest server.tests.cloud.test_seat_times
  server.tests.cloud.test_seatweek -v`. Expected: FAIL (`No module named server.cloud.seat_times`; the deadline at 12:00).
- [ ] **Step 3: Implement `seat_times.py`** with the signatures above. `deadline_hm` uses `seating_week._HHMM`. Set
  `DEFAULT_DEADLINE = '14:00'`. `routes_core.kehila` returns `extra['seatDeadline'] = seat_times.deadline_hm(settings)`.
  `routes_seatweek._deadline` passes `seat_times.deadline_hm(settings)` to `wk.deadline_of`. In `server/API.md:586`, the
  default becomes `14:00`. Add `errors.invalid_seat_reminders`, `errors.seat_times_order` and
  `errors.seat_reminder_after_deadline` to both JSONs. Copy (he/en):
  - `invalid_seat_reminders`: "הגדרת התזכורות לא תקינה." / "The reminder settings are not valid."
  - `seat_times_order`: "השעה לא בסדר הנכון בין הפתיחה, התזכורות והמועד האחרון." / "That time is out of order between
    the opening, the reminders and the deadline."
  - `seat_reminder_after_deadline`: "תזכורת תהיה אחרי המועד האחרון. שנו קודם את התזכורת." / "A reminder would be after
    the deadline. Change the reminder first."
- [ ] **Step 4: Run the tests to verify they pass.** Run the Step 2 command, then `npm run test:server` and
  `node --test tests/i18n.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add server/cloud/seat_times.py server/cloud/seating_week.py server/cloud/routes_core.py server/cloud/routes_seatweek.py server/API.md server/tests/cloud/test_seat_times.py server/tests/cloud/test_seatweek.py src/i18n/he.json src/i18n/en.json
git commit -m "Seat times: opening Thu 08:00, reminders Thu 20:00 / Fri 11:00, deadline default Fri 14:00; chain rules"
```

---

### Task 2: server — who is reminded, `seats/me` fields and the mute switch

**Files:**
- Create: `server/cloud/seat_reminders.py` (the audience part; Task 4 adds the job)
- Modify: `server/cloud/repo_seating.py` (`held_seats`), `server/cloud/routes_seatweek.py` (`_held` → repo,
  `_out_member`), `server/cloud/routes_changes.py:116-140` (`put_notify`), `server/cloud/routes_core.py:32` (notify
  defaults), `server/API.md` (`seats/me`, `me/notify`, `GET /kehilot/{k}` notify)
- Test: `server/tests/cloud/test_seat_reminders.py` (new), `server/tests/cloud/test_seatweek.py:96`

**Interfaces:**
- Consumes: `seat_times` (Task 1).
- Produces:
  - `Repo.held_seats(k, layout, only_family=None) -> dict[str, str]`: the body of today's `routes_seatweek._held`, moved
    as is. `_held` becomes a one-line call to it.
  - `seat_reminders.audience(family: dict, live: list[dict]) -> list[dict]`: the memberships to remind (rule below).
  - `seat_reminders.unanswered_families(repo, k, friday: str) -> list[str]`: sorted family ids that hold at least one
    seat in that Friday's layout (`layout_for` + `held_seats`) and are in neither prayer's `answered`. Returns `[]` with
    no layout.
  - `seat_reminders.recipients(repo, k, friday: str) -> list[str]`: user ids, sorted. For each unanswered family:
    `audience(family, repo.live_adults(k, family))`, minus memberships with `notify.seatReminders is False`.
  - `seat_reminders.remindable(repo, k, family: dict | None, user_id: str) -> bool`
  - `GET …/seats/me` adds `remindable: bool` (always) and `hadSeats: bool` (only when `seats == 0`: his family held a
    seat in the previous Friday's week).
  - Notify preference `seatReminders: bool`, default `true`. `PUT …/me/notify` accepts it. A non-bool value returns 400
    `invalid_seat_reminders_pref`.

The audience rule (the owner's rule, §21.5. The CTO reading is in Global Constraints):

```python
def audience(family, live):
    gender = {p['userId']: p.get('gender') for p in family.get('people') or () if p.get('userId')}
    men = [m for m in live if gender.get(m['userId']) == 'm']
    return men or list(live)
```

- [ ] **Step 1: Write the failing tests** (`test_seat_reminders.py`, a subclass of `test_seatweek.SeatWeekTest` for the
  fixtures: `mine`, `give`, `now`, `put_me`, `gput`, `respond`). Set gender through `PUT …/family/tree` (a `self`
  figure, plus `spouse` where needed) or by writing `people` on the family item through `self.repo`. Use invented names
  only.

```python
def test_audience_rules(self):
    a = seat_reminders.audience
    m = lambda u: {'userId': u}
    fam = lambda *g: {'people': [{'userId': u, 'gender': x, 'relation': r} for u, x, r in g]}
    self.assertEqual(a(fam(('u1', 'm', 'self'), ('u2', 'f', 'spouse')), [m('u1'), m('u2')]), [m('u1')])
    self.assertEqual(a(fam(('u2', 'f', 'self')), [m('u2')]), [m('u2')])                      # widow
    self.assertEqual(a({}, [m('u1'), m('u2')]), [m('u1'), m('u2')])                          # no tree: everyone
    self.assertEqual(a(fam(('u1', 'm', 'self'), ('u2', 'f', 'spouse')), [m('u2')]), [m('u2')])  # the man left
    self.assertEqual(a({}, []), [])

def test_unanswered_and_recipients(self):
    self.mine((5, 0))
    self.give(f'family:{self.other}', (5, 3))
    self.give(f'holder:{self.holder}', (6, 0))                     # holders never count
    self.assertEqual(seat_reminders.unanswered_families(self.repo, self.k, WEEK), sorted([self.fam, self.other]))
    self.assertEqual(self.put_me([1], 'erev')[0], 200)             # one prayer answered = answered
    self.assertEqual(seat_reminders.unanswered_families(self.repo, self.k, WEEK), [self.other])
    self.respond([{'household': f'family:{self.other}', 'released': 1}])  # an upload is NOT an answer (owner)
    self.assertEqual(seat_reminders.unanswered_families(self.repo, self.k, WEEK), [self.other])
    self.gput({self.at[(5, 3)]: False})                            # a gabbai's on-behalf save is
    self.assertEqual(seat_reminders.unanswered_families(self.repo, self.k, WEEK), [])

def test_muted_is_skipped(self):
    self.mine((5, 0))
    self.assertEqual(self.call('PUT', f'{self.base()}/me/notify', sub='member-sub', body={'seatReminders': False})[0], 200)
    self.assertNotIn(self.member, seat_reminders.recipients(self.repo, self.k, WEEK))
    self.assertEqual(self.call('PUT', f'{self.base()}/me/notify', sub='member-sub', body={'seatReminders': 'no'}),
                     (400, {'error': 'invalid_seat_reminders_pref'}))
    self.assertIs(self.call('GET', self.base(), sub='member-sub')[1]['notify']['seatReminders'], False)

def test_seats_me_remindable_and_had_seats(self):
    self.mine((5, 0))
    self.assertIs(self.me()[1]['remindable'], True)                # no tree: every adult
    self.join_family(self.quiet, self.fam)                         # helper: quiet's membership familyId = fam, fam.adults += quiet
    self.set_people(self.fam, [(self.member, 'f', 'self'), (self.quiet, 'm', 'spouse')])  # helper: writes family.people
    self.assertIs(self.me()[1]['remindable'], False)               # a woman in a family with a man: the row only
    self.assertIs(self.me(sub='quiet-sub')[1]['remindable'], True)
    nxt = friday(2)                                                # the week after WEEK (test_seating.friday)
    self.mine()                                                    # no seats any more...
    self.assertIs(self.me(week=nxt)[1]['hadSeats'], False)         # ...and none the week before nxt either
    # with seats in WEEK and a layout version from nxt that drops them: me(week=nxt) → seats 0, hadSeats True
```

`join_family` and `set_people` are test helpers written with `self.repo.table.update_item`. The layout version for the
last assertion is saved with `PUT …/admin/seating/layouts/{nxt}` and no assignments.

In `test_cut_leaks_nothing_about_others` (`test_seatweek.py:96`), the expected key set gains `'remindable'`.

- [ ] **Step 2: Run them to verify they fail.** Run: `.venv/bin/python -m unittest server.tests.cloud.test_seat_reminders
  -v`. Expected: FAIL (no module).
- [ ] **Step 3: Implement.** Move `_held` into `Repo.held_seats`. `_out_member` computes `remindable` from
  `repo.family_of(k, ctx.user_id)` and adds it to `base`. `hadSeats` uses `layout_for(k, friday − 7)` +
  `held_seats(..., only_family)`. `put_notify` adds `'seatReminders'` to `known` and checks it with
  `isinstance(v, bool)`. Default `'seatReminders': True` in the `routes_core.kehila` notify. Document all of it in
  `server/API.md`. Add `errors.invalid_seat_reminders_pref` in he ("ההגדרה לא תקינה.") and en ("That setting is not
  valid.").
- [ ] **Step 4: Run the tests to verify they pass.** Run: the Step 2 command, `npm run test:server` and `npm test`.
  Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add server/cloud/seat_reminders.py server/cloud/repo_seating.py server/cloud/routes_seatweek.py server/cloud/routes_changes.py server/cloud/routes_core.py server/API.md server/tests/cloud/test_seat_reminders.py server/tests/cloud/test_seatweek.py src/i18n/he.json src/i18n/en.json
git commit -m "Seat reminders: audience (men, else every adult), unanswered families, seats/me remindable+hadSeats, mute switch"
```

---

### Task 3: server — the management times API

**Files:**
- Modify: `server/cloud/routes_seatweek.py` (`get_times`, `put_times`), `server/cloud/handler.py` (two routes),
  `server/cloud/routes_admin.py:250-275` (`set_settings` cross-check), `server/cloud/repo_members.py:320-345`
  (`set_settings` gains `seat_reminders`), `server/API.md`
- Test: `server/tests/cloud/test_seat_times_api.py` (new; subclass `SeatWeekTest`)

**Interfaces:**
- Consumes: `seat_times.*` (Task 1), `seat_reminders.unanswered_families` (Task 2).
- Produces:
  - `GET /v1/kehilot/{k}/admin/seats/times` (`authz.MANAGEMENT`) returns 200 `{opens: {day, time}, reminders: {'1':
    {on, day, time}, '2': {…}}, deadline: 'HH:MM', week: <rules.current_shabbat>, layout: bool, pending: int | null,
    sent: {'1': bool, '2': bool}}`. `pending` is `len(unanswered_families)`, or null with no layout. `sent` reads the
    markers through `Repo.seat_reminders_sent`. Task 4 defines that method; until then, add it here as a Query on
    `SEATREM#<friday>#` returning the set of numbers.
  - `PUT` on the same path: body with at least one of `{deadline, reminders}` and nothing else (else 400
    `invalid_body`). The merged result is validated with `seat_times.check(..., changed)`. `changed` is the first
    reminder named in the body, else `'deadline'`. The response is the same as GET. Stored as
    `settings.seatReminders` and `settings.seatDeadline`.
  - `PUT /admin/settings {seatDeadline}` now also runs `check(stored reminders, new, 'deadline')`.
  - `Repo.set_settings(..., seat_reminders=None)`.

- [ ] **Step 1: Write the failing tests.** `test_get_defaults` (body equals the defaults, `pending` 2 after `mine` +
  `give(other)`, `sent` both false). `test_member_forbidden` (403 for `member-sub` on GET and PUT). `test_tech_allowed`
  (a tech membership gets 200; use the tech helper the tech-role tests use). `test_put_reminder_and_order_error`: PUT
  `{'reminders': {'1': {'time': '08:15'}}}` → `(400, {'error': 'seat_times_order', 'field': 'reminders.1'})`, and PUT
  `{'reminders': {'2': {'on': False}}}` → 200 with `reminders['2']['on'] is False`. Use the field key the errors module
  emits. `test_deadline_cannot_pass_reminder`: PUT `{'deadline': '11:15'}` on both routes returns 400
  `seat_reminder_after_deadline` with field `reminders.2`. After turning reminder 2 off, the same PUT returns 200.
  `test_saved_deadline_reaches_member`: after PUT `{'deadline': '16:00'}`, `GET seats/me` `deadline` starts with
  `T16:00`.
- [ ] **Step 2: Run them to verify they fail.** Run: `.venv/bin/python -m unittest
  server.tests.cloud.test_seat_times_api -v`. Expected: FAIL (404 route).
- [ ] **Step 3: Implement** the routes, the repo argument and the cross-check, then document them in `server/API.md`
  under "Seating, weekly release".
- [ ] **Step 4: Run the tests to verify they pass.** Run: the Step 2 command, `npm run test:server` (the authz AST
  guards included) and `npm test`. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add server/cloud/routes_seatweek.py server/cloud/handler.py server/cloud/routes_admin.py server/cloud/repo_members.py server/cloud/repo_seating.py server/API.md server/tests/cloud/test_seat_times_api.py
git commit -m "Seat times API: GET/PUT admin/seats/times for management; deadline change cannot pass an on reminder"
```

---

### Task 4: server — the `seat_reminders` job and the push (Opus review after)

**Files:**
- Modify: `server/cloud/seat_reminders.py` (texts, `parse_ref`, `run`), `server/cloud/repo_seating.py` (registry,
  markers), `server/cloud/routes_seating.py:64` (register the Kehila after a layout save), `server/cloud/push.py`
  (`send`), `server/cloud/push_worker.py` (`seat_reminder` kind), `server/cloud/jobs.py`, `server/API.md` (push kinds,
  the job)
- Test: `server/tests/cloud/test_seat_reminder_job.py` (new), `server/tests/cloud/test_jobs.py`,
  `server/tests/cloud/test_push.py`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - Registry item `pk='SEATING', sk='KEHILOT'`, `ids` (string set) and `complete` (bool).
    - `Repo.add_seat_kehila(k) -> None`: `ADD ids :k`.
    - `Repo.seat_kehila_ids() -> list[str]`, sorted. When `complete` is missing, it first scans once for items with
      `begins_with(sk, 'SEATLAY#')` (projection `pk`), adds them and sets `complete = true`. This is the backfill for
      layouts saved before this deploy.
  - Marker `pk=K#<k>, sk=SEATREM#<friday>#<n>`, `at` (ms), `expiresAt = now + 30 days`.
    - `Repo.claim_seat_reminder(k, friday, n, expires_at) -> bool`: `put_item` with `attribute_not_exists(pk)`; False on
      `ConditionalCheckFailedException`.
    - `Repo.release_seat_reminder(k, friday, n) -> None`.
    - `Repo.seat_reminders_sent(k, friday) -> set[str]`.
  - `push.send(kind, kehila, ref) -> None` raises on a queue failure, and on a missing `PUSH_QUEUE_URL` it raises
    `RuntimeError`. `enqueue` keeps its behaviour by calling `send` inside its try.
  - `seat_reminders.KIND = 'seat_reminder'`, with ref `f'{friday}#{n}'`.
    - `parse_ref(ref) -> tuple[str, str] | None` (regex `^\d{4}-\d{2}-\d{2}#[12]$`).
    - `texts(n: str, lang: str, kehila_name: str, deadline_at: datetime, reminder_day: str) -> tuple[str, str]`
      returns `(title, body)` from §21.7 `seats.push.*` verbatim. `{day}` is "יום ו׳" / "Fri". Reminder 2 uses `body`
      ("…עד {time} היום…") when `reminder_day == 'fri'` (the deadline's day), else `bodyOtherDay`. `{day} {time}` is
      joined by U+00A0.
    - `run(repo, now: datetime, dry_run: bool = False) -> dict` returns `{'kehilot': int, 'due': [{'kehila', 'n',
      'recipients'?}], 'sent': [{'kehila', 'n'}]}`. `recipients` (a count) appears in a dry run only.
  - `jobs.handler` calls `job(_repo(), event)`. `push_receipts(repo, event=None)`. `JOBS['seat_reminders'] =
    seat_reminders_job`. `seat_reminders_job` reads `event['dryRun'] is True`, and in a dry run only an optional
    `event['now']` (`'YYYY-MM-DDTHH:MM'`, Israel wall clock). It returns `{'ok': True, **run(...)}`.

The run (the decision that matters: claim first, release on a failed send, so a reminder goes out once and a queue
failure retries on the next tick):

```python
def run(repo, now, dry_run=False):
    friday = seating_rules.current_shabbat(now.date()).isoformat()
    out = {'kehilot': 0, 'due': [], 'sent': []}
    for k in repo.seat_kehila_ids():
        meta = repo.get_kehila(k)
        if not meta or not repo.layout_for(k, friday):
            continue
        out['kehilot'] += 1
        settings = meta.get('settings', {})
        for n in seat_times.due(now, friday, seat_times.reminders_of(settings), seat_times.deadline_hm(settings)):
            if dry_run:
                out['due'].append({'kehila': k, 'n': n, 'recipients': len(recipients(repo, k, friday))})
                continue
            if n in repo.seat_reminders_sent(k, friday) or not repo.claim_seat_reminder(k, friday, n, <now + 30 d>):
                continue
            try:
                push.send(KIND, k, f'{friday}#{n}')
            except Exception:
                repo.release_seat_reminder(k, friday, n)
                log.exception('seat_reminders send failed kehila=%s friday=%s n=%s', k, friday, n)
                continue
            out['sent'].append({'kehila': k, 'n': n})
    log.info('seat_reminders dry_run=%s kehilot=%d due=%d sent=%d', dry_run, out['kehilot'], len(out['due']), len(out['sent']))
    return out
```

In the worker (`push_worker._process` / `_build`), kind `seat_reminder` is accepted without being in `PUSH_TEXT` (it is
never editable: `routes_admin._editable` stays false for it). A bad ref is dropped with a warning. The job is also
dropped, logged as `skipped`, when `now >= deadline`, when the Kehila has no layout for that Friday, or when that
reminder is now off. Otherwise recipients are `seat_reminders.recipients(...)`, read **now**. Title and body come from
`texts(...)` in each recipient's language, and `data` is `{'kehila': k, 'screen': 'seats', 'week': friday}`.

- [ ] **Step 1: Write the failing tests** (`test_seat_reminder_job.py`, subclassing `SeatWeekTest`; patch `push.send` or
  set `PUSH_QUEUE_URL` with moto SQS and read the queue):

```python
def test_sends_each_once_at_its_time(self):           # Thu 19:59 nothing; 20:04 r1; 20:09 nothing; Fri 11:00 r2
def test_concurrent_runs_send_once(self):             # claim already taken by "another run" → no send
def test_missed_runs_catch_up_before_deadline_only(self):  # first run Fri 11:05 sends r1 and r2; first run Fri 14:00 sends nothing
def test_moved_reminder_sent_once(self):              # r1 sent Thu 20:00; PUT r1 to Fri 09:00; Fri 09:00 run sends nothing; an unsent r2 moved to Fri 12:00 goes out at 12:00, not 11:00
def test_off_and_no_layout_send_nothing(self):
def test_queue_failure_releases_the_claim(self):      # send raises → marker gone → next run sends
def test_registry_backfill_and_layout_save(self):     # layout saved before the registry existed is found once; a new layout save adds its Kehila
def test_dry_run_writes_and_sends_nothing(self):      # handler({'job': 'seat_reminders', 'dryRun': True, 'now': '<thu>T20:05'}) → due has r1 with a recipient count; no SEATREM item; send not called
def test_now_override_ignored_without_dry_run(self):
```

In `test_push.py`:

```python
def test_seat_reminder_payload_and_text(self):        # title "{kehila} · טופס מקומות לשבת", body from §21.7, data == {'kehila', 'screen': 'seats', 'week'} exactly, no name or count in title/body/data
def test_seat_reminder_recipients_at_send_time(self): # family answers between claim and worker → not pushed
def test_worker_drops_after_deadline_or_off(self):
def test_seat_reminder_gentle_text_today_vs_other_day(self):
def test_seat_reminder_not_in_editable_push_texts(self):
```

In `test_jobs.py`, add `test_handler_passes_event` (push_receipts still works with `{'job': 'push_receipts'}`).

- [ ] **Step 2: Run them to verify they fail.** Run: `.venv/bin/python -m unittest
  server.tests.cloud.test_seat_reminder_job server.tests.cloud.test_push server.tests.cloud.test_jobs -v`. Expected:
  FAIL.
- [ ] **Step 3: Implement** the interfaces above. `routes_seating.put_layout` calls `ctx.repo.add_seat_kehila(k)` after
  a successful save. Update the docstrings of `push.py` and `push_worker.py` (the new kind and ref). In `server/API.md`,
  document the job, the push kind, its payload and the once-per-reminder marker.
- [ ] **Step 4: Run the tests to verify they pass.** Run: the Step 2 command, `npm run test:server` and `npm test`.
  Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add server/cloud/seat_reminders.py server/cloud/repo_seating.py server/cloud/routes_seating.py server/cloud/push.py server/cloud/push_worker.py server/cloud/jobs.py server/API.md server/tests/cloud/test_seat_reminder_job.py server/tests/cloud/test_jobs.py server/tests/cloud/test_push.py
git commit -m "Seat reminders job: once per Kehila/Friday/reminder via a conditional marker, pushes on the SQS path, dry run"
```

- [ ] **Step 6: Opus review** of Tasks 1–4 against §21.4–21.5 and Review Focus 1–3 (controller dispatches it). Fix, then
  re-run Step 4.

---

### Task 5: infra — the schedule, permissions and queue for the jobs Lambda

**Files:**
- Modify: `infra/modules/jobs/main.tf`, `infra/modules/jobs/variables.tf`, `infra/envs/dev/main.tf:67-77`,
  `infra/modules/push/main.tf:51-53` (comment only: the worker reads the seat week too; its actions already suffice)

**Interfaces:**
- Consumes: `module.push.queue_url`, `module.push.queue_arn` (existing outputs).
- Produces:
  - Jobs Lambda env `PUSH_QUEUE_URL`.
  - IAM actions `dynamodb:Query, GetItem, BatchGetItem, PutItem, UpdateItem, DeleteItem, Scan` on the table, with a
    comment for each use (Scan is the one-time registry backfill). `sqs:SendMessage` on the queue ARN.
  - `aws_scheduler_schedule.seat_reminders`, named `"${var.name_prefix}-seat-reminders"`, in the existing group, with
    `schedule_expression = "cron(*/5 * ? * THU-FRI *)"`, `schedule_expression_timezone = "Asia/Jerusalem"`, flexible
    window `OFF`, input `jsonencode({ job = "seat_reminders" })`, `retry_policy { maximum_retry_attempts = 1,
    maximum_event_age_in_seconds = 240 }` (a retry never outlives the next tick), and `state =
    var.seat_reminders_state`.
  - New variables `push_queue_url`, `push_queue_arn`, `seat_reminders_state` (default `"ENABLED"`, validation
    `ENABLED|DISABLED`). Dev passes all three. Whether dev starts `ENABLED` is the owner's answer (see Task 10).

- [ ] **Step 1: Write the change**, then format: `terraform -chdir=infra/modules/jobs fmt` and `terraform -chdir=infra/envs/dev fmt`.
- [ ] **Step 2: Validate.** Run: `cd infra/envs/dev && terraform init -backend=false -input=false >/dev/null &&
  terraform validate`. Expected: `Success! The configuration is valid.` (no plan here: the controller plans in Task 10).
- [ ] **Step 3: Commit**

```bash
git add infra/modules/jobs/main.tf infra/modules/jobs/variables.tf infra/envs/dev/main.tf infra/modules/push/main.tf
git commit -m "Infra: seat_reminders schedule (every 5 min Thu-Fri, Asia/Jerusalem), jobs Lambda may queue pushes"
```

---

### Task 6: client — the pure model (window, times, wire, roles)

**Files:**
- Modify: `src/seats/window.ts`, `src/seats/wire.ts:15-136`, `src/seats/useMemberSeats.ts`, `src/seats/effectiveFrom.ts`
  (comments, `opens`), `src/seats/formCsv.ts:170-187`, `src/views/admin/SeatResponses.tsx:104`,
  `src/seats/fixtureSeats.ts:109`, `src/client/endpoints.ts` (times calls), `src/client/types.ts` (`NotifyPrefs`),
  `src/client/roles.ts` (only if `isAdult` is missing)
- Create: `src/seats/times.ts`
- Test: `tests/seats.test.ts:228-262`, `tests/seatsWire.test.ts:90-115`, `tests/seatTimes.test.ts` (new)

**Interfaces:**
- Consumes: the server shapes from Tasks 1–3.
- Produces:
  - `window.ts`:
    - `type WindowConfig = { opens: { daysBefore: number; time: string }; deadline: { daysBefore: number; time: string } }`
    - `DEFAULT_WINDOW = { opens: { daysBefore: 1, time: '08:00' }, deadline: { daysBefore: 0, time: '14:00' } }`
    - `DEFAULT_DEADLINE_HM = '14:00'`
    - `cardWindow(friday, cfg?) -> { opensAt; closesAt }`, unchanged.
    - `shabbatFriday(now: Date, shabbatEndsAt?: Date | null): string`. On Saturday it returns the day before until
      `shabbatEndsAt` (no end means all Saturday), then the next Friday. Other days are as today.
    - `dayTime(at: Date, lang: 'he' | 'en'): string`: "יום ו׳ 14:00" / "Fri 14:00".
    - `seatCardState` is removed (no app use).
  - `times.ts`:
    - `type Day = 'thu' | 'fri'`, `type Slot = { day: Day; time: string }`
    - `type ReminderSetting = Slot & { on: boolean }`
    - `type SeatTimes = { opens: Slot; reminders: Record<'1' | '2', ReminderSetting>; deadline: string; week: string;
      layout: boolean; pending: number | null; sent: Record<'1' | '2', boolean> }`
    - `OPENS`, `DEFAULT_REMINDERS`, `MIN_GAP = 30`
    - `weekMinute(s: Slot): number`
    - `allowedRange(t: SeatTimes, which: '1' | '2' | 'deadline'): { from: Slot; to: Slot } | null`
    - `fits(t: SeatTimes, which, slot: Slot): boolean` (also the quarter-hour step)
    - `slotLabel(s: Slot, lang): string` ("ה׳ 08:30" / "Thu 08:30")
    - `onCount(t): 0 | 1 | 2`
  - `wire.ts`:
    - `MemberWire` and `MemberSeats` gain `remindable: boolean` and `hadSeats: boolean`.
    - `type Summary = { kind: 'all' } | { kind: 'none' } | { kind: 'free'; n: number } | { kind: 'kept' }`
    - `answerSummary(m: MemberSeats): Summary`. Not answered gives `kept`. All seats released in both prayers gives
      `none`. Nothing released gives `all`. Otherwise `free` with n = the larger released count of the two prayers.
    - `homeSeatSlot(m: MemberSeats | null, now: Date, always?: boolean): 'card' | 'row' | null`. It is `card` when
      `m.seatCount > 0 && m.remindable && now >= cardWindow(m.week).opensAt`, or when `always` and the seat count is
      positive. It is `row` when `m.seatCount > 0 || m.hadSeats`. Otherwise null.
    - `cardModel(m, now, always?)` keeps its shape and adds the state `'closed'` (when `!m.open`) and `summary:
      Summary`. It returns null unless `homeSeatSlot === 'card'`.
    - `type RowState = 'open' | 'answered' | 'byGabbai' | 'closed' | 'none'`
    - `rowModel(m: MemberSeats): { state: RowState; summary: Summary; deadline: Date; pressable: boolean } | null`.
      `none` (not pressable) when there are no seats this week but `hadSeats`. Then `closed` when `!m.open`, `byGabbai`,
      `answered` when either prayer is answered, and `open` otherwise.
  - `useMemberSeats(enabled = true, week?: string)` passes `week` to `api.seatsMe`.
  - `api.seatTimes(k): Promise<SeatTimes>` and `api.putSeatTimes(k, body: { deadline?: string; reminders?:
    Partial<Record<'1' | '2', Partial<ReminderSetting>>> }): Promise<SeatTimes>`.
  - `NotifyPrefs.seatReminders: boolean`.
  - `isAdult(role)` from `src/client/roles.ts`.

- [ ] **Step 1: Write the failing tests.**

```ts
test('window: Thu 08:00 to Fri 14:00 Israel time, winter, summer and the DST Friday', () => {
  const w = cardWindow('2026-12-18');
  assert.equal(w.opensAt.toISOString(), '2026-12-17T06:00:00.000Z');
  assert.equal(w.closesAt.toISOString(), '2026-12-18T12:00:00.000Z');
  assert.equal(cardWindow('2027-03-26').closesAt.toISOString(), '2027-03-26T11:00:00.000Z');
});
test('shabbatFriday: Saturday before and after Shabbat ends', () => {
  const sat = (hm: string) => israelInstant('2026-10-31', hm);
  assert.equal(shabbatFriday(sat('17:00'), sat('17:40')), '2026-10-30');
  assert.equal(shabbatFriday(sat('17:41'), sat('17:40')), '2026-11-06');
  assert.equal(shabbatFriday(sat('23:00')), '2026-10-30');               // no end known: the server's rule
  assert.equal(shabbatFriday(israelInstant('2026-10-28', '10:00')), '2026-10-30');
});
test('dayTime never breaks between day and time', () => {
  assert.equal(dayTime(israelInstant('2026-10-30', '14:00'), 'he'), 'יום ו׳ 14:00');
  assert.equal(dayTime(israelInstant('2026-10-30', '14:00'), 'en'), 'Fri 14:00');
});
test('times: allowed range and the 30-minute gap', () => {
  const t = { ...defaults };
  assert.deepEqual(allowedRange(t, '1'), { from: { day: 'thu', time: '08:30' }, to: { day: 'fri', time: '10:30' } });
  assert.equal(fits(t, '2', { day: 'fri', time: '13:45' }), false);
  assert.equal(fits(t, '2', { day: 'fri', time: '13:30' }), true);
  assert.equal(fits(t, '1', { day: 'thu', time: '20:10' }), false);       // not a quarter hour
});
test('client defaults equal the server', () => { /* read server/cloud/seating_week.py DEFAULT_DEADLINE and
  server/cloud/seat_times.py OPENS / DEFAULT_REMINDERS with a regex; compare with DEFAULT_WINDOW, OPENS, DEFAULT_REMINDERS */ });
test('homeSeatSlot and rowModel', () => {
  // remindable, Wed → row 'open'; Thu 08:00 → card 'ask'; after the deadline → card 'closed' with summary kept
  // not remindable, Thu 09:00 → row; answered by a gabbai → row 'byGabbai'; seats 0 + hadSeats → row 'none', pressable false
  // seats 0, no hadSeats → null; answerSummary: none/all/free(max of the two prayers)/kept
});
```

Rewrite the old `cardModel` timing tests (`seatsWire.test.ts:96-103`) to the 08:00 opening and the `remindable` gate.
Delete the `seatCardState` test.

- [ ] **Step 2: Run them to verify they fail.** Run: `node --test tests/seats.test.ts tests/seatsWire.test.ts
  tests/seatTimes.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Rename `reminder` to `opens` everywhere it is used (`effectiveFrom.ts` keeps working
  through `cardWindow`, and its comments now say Thursday 08:00). `formCsv` defaults and `SeatResponses` use
  `DEFAULT_DEADLINE_HM`. `fixtureSeats` uses `DEFAULT_WINDOW.deadline.time` and returns `remindable: true, hadSeats:
  false` by default. Fix every `tsc` error.
- [ ] **Step 4: Run the tests to verify they pass.** Run: `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/seats/window.ts src/seats/times.ts src/seats/wire.ts src/seats/useMemberSeats.ts src/seats/effectiveFrom.ts src/seats/formCsv.ts src/seats/fixtureSeats.ts src/views/admin/SeatResponses.tsx src/client/endpoints.ts src/client/types.ts tests/seats.test.ts tests/seatsWire.test.ts tests/seatTimes.test.ts
# plus src/client/roles.ts and its test only if Step 3 added isAdult
git commit -m "Seats client model: opening Thu 08:00, deadline default 14:00, Shabbat-end week rule, row/card slot, times rules"
```

---

### Task 7: client — Home: the bottom row, the Thursday card, the closed card and the push tap

**Files:**
- Create: `src/views/SeatRow.tsx`
- Modify: `src/views/Home.tsx`, `src/views/SeatCard.tsx`, `src/views/SeatPage.tsx` (takes `week`), `src/views/Main.tsx`
  (`nav.tab 'seats'` carries `week?`; role checks use `isAdult`), `src/client/push.ts` (`PushRoute.week`,
  `pushDestination` seats for adults always), `src/client/fixtures.ts`, `src/seats/fixtureSeats.ts`,
  `src/i18n/he.json`, `src/i18n/en.json`
- Test: `tests/push.test.ts`, `tests/homeCard.test.ts`

**Interfaces:**
- Consumes: `homeSeatSlot`, `cardModel`, `rowModel`, `answerSummary`, `shabbatFriday(now, end)` and `dayTime` (Task 6).
- Produces:
  - `SeatRow({ model, shabbat, onOpen }: { model: NonNullable<ReturnType<typeof rowModel>>; shabbat: string; onOpen: () => void })`.
  - `SeatCard` accepts `state: 'ask' | 'done' | 'byGabbai' | 'closed'` and `summary`.
  - `SeatPage({ week, onBack, onToast })`.
  - `routeFromPush` keeps `week` (only a `YYYY-MM-DD` Friday).
  - Fixture screens: `home-row-open`, `home-row-answered`, `home-row-gabbai`, `home-row-closed`, `home-row-none`,
    `home-seat-thu`, `home-seat-closed`, `home-not-reminded` (the `remindable: false` partner on Thursday). The timer
    applies whenever the URL has `now=`. Preview "always" only without it.

Rules (§21.2–21.3):
- Home's week is `shabbatFriday(now, shabbatEnd)`. `shabbatEnd` on Saturday is, with a Kehila schedule,
  `zmanimForLocation(doc.location)(date)?.shabbatEnd`. Without one, it is the loaded zmanim `nightfall`. Without
  either, it is null.
- The slot decides: the card at the §15.2 place, or `SeatRow` as the last item before the sign-out button (after the
  latest messages and the guest's `LockedRows`). Never both.
- Copy is §21.7 verbatim: `seats.row.*`, `seats.card.closedTitle`, `seats.card.closedSent`. The not-sent final line is
  P38's wording, under a new key `seats.card.closedNone`: he "לא שלחתם השבת. כל המקומות נשמרו לכם. לשינוי פנו לגבאי." /
  en "You didn't answer this Shabbat. All your seats were kept. To change it, ask a gabbai."
- Row: `Card`, 64 high, `Icon` (`chair` tekhelet for open, `check` olive for answered and byGabbai, `lock` muted for
  closed, `chair` muted for none), the title bold 16 `seats.row.title` with `{shabbat}` = "שבת {parasha}" from
  `useShabbat(week)`, and the status at 14 muted with `numberOfLines={2}`. A chevron shows unless the state is `none`.
  `accessibilityRole="button"` and the label is title + status. The closed card is a `button` too, opening P37 read-only.
- The push tap opens `{tab: 'seats', week}`, also when `config.seatsPreview` is off. The Kehila switch from
  `data.kehila` works as it does for messages.

- [ ] **Step 1: Write the failing tests.** In `push.test.ts`: `routeFromPush` keeps a valid `week` and drops `'x'`, and
  `pushDestination({screen:'seats'}, 'member', false) === 'seats'` (also for `gabbai`, `tech`), while `listener` gets
  `'home'`. In `homeCard.test.ts`, the Home slot choice through the pure functions for the five row states and the two
  card states, with the exact he status strings from §21.2, for example `'עוד לא עניתם · אפשר עד יום ו׳ 14:00'`
  and `'עניתם: 1 פנוי לאחרים · אפשר לשנות עד יום ו׳ 14:00'`.
- [ ] **Step 2: Run them to verify they fail.** Run: `node --test tests/push.test.ts tests/homeCard.test.ts`. Expected:
  FAIL.
- [ ] **Step 3: Implement** the components, the wiring and the i18n keys (he/en verbatim).
- [ ] **Step 4: Run the tests to verify they pass.** Run: `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Visual check** (Global Constraints). URLs are `http://localhost:8081/?role=member&lang=he&screen=<s>&now=<t>`:
  - `home-row-open`, `home-row-answered`, `home-row-gabbai` and `home-row-none` with `now=2026-10-28T10:00`;
  - `home-row-closed` with `now=2026-10-30T15:00`;
  - `home-seat-thu` with `now=2026-10-29T09:00`;
  - `home-seat-closed` with `now=2026-10-31T12:00`;
  - `home-not-reminded` with `now=2026-10-29T09:00`.

  Shoot `home-row-open` and `home-seat-thu` at 390 light and dark and at 1280, and the rest at 390 light. Check against
  §21.2–21.3: the row is last (scroll with `act.mjs` `key:End`), one way in at a time, and the closed card has an ash
  edge with no buttons.
- [ ] **Step 6: Commit**

```bash
git add src/views/SeatRow.tsx src/views/Home.tsx src/views/SeatCard.tsx src/views/SeatPage.tsx src/views/Main.tsx src/client/push.ts src/client/fixtures.ts src/seats/fixtureSeats.ts src/i18n/he.json src/i18n/en.json tests/push.test.ts tests/homeCard.test.ts
git commit -m "Home: seat form row all week, Thursday card for the family's men, final closed card until Shabbat ends; push opens the week"
```

---

### Task 8: client — management › מקומות ישיבה › "זמני הטופס והתזכורות"

**Files:**
- Create: `src/views/admin/SeatTimes.tsx`
- Modify: `src/client/adminAreas.ts` (row `{ id: 'times', target: 'seatTimes', section: 'every' }` between `week` and
  `hall`; `AreaRow.section` gains `'every'`; `AreaTarget` gains `'seatTimes'`), `src/views/admin/Overview.tsx:166`
  (sections `['week', 'every', 'hall']`; the times row status from `api.seatTimes`), `src/views/Main.tsx`
  (`seatTimes` screen, management only), `src/client/fixtures.ts` (`seat-times`, `seat-times-off`, and the times
  routes in memory), `src/i18n/he.json`, `src/i18n/en.json`
- Test: `tests/adminAreas.test.ts`, `tests/seatTimes.test.ts`

**Interfaces:**
- Consumes: `api.seatTimes` / `api.putSeatTimes`, `allowedRange`, `fits`, `slotLabel`, `onCount` (Task 6), and
  `TimeField` from `src/views/admin/scheduleEditor/controls.tsx`.
- Produces: `SeatTimes({ onBack, onToast })`, and `timesStatus(t: SeatTimes, lang, tr): string` ("נסגר ו׳ 14:00 · 2
  תזכורות" / "· תזכורות כבויות") exported from `src/seats/times.ts`.

Screen (§21.6, copy §21.7 verbatim, `admin.section.every` = `admin.seats.every`):
1. `ktitle` `admin.seats.times`, then a muted line `admin.seats.applies`. Its `{shabbat}` comes from
   `useShabbat(t.week)` and its `{date}` is the Hebrew date with the Gregorian date in brackets (`dualDate`).
2. The week strip: one `View` with `accessibilityRole="image"` and a label listing the four marks in order. The marks
   are placed by `weekMinute` from the right (RTL). An off reminder shows a dotted `bell` and `admin.seats.off`.
3. One `Card` with three rows: `Icon`, label + muted sub, a bold tabular value (its own `button`, a11y "שינוי שעת
   התזכורת"), and a `Toggle` on the two reminders (a `switch` named "תזכורת, ה׳ 20:00"). A toggle saves at once, shows
   `onToast` / `offToast`, and puts the old value back with the error text when refused.
4. A value opens a `Sheet`: `Segmented` ה׳/ו׳ (reminders only), `TimeField`, the muted line `admin.seats.range` from
   `allowedRange`, the field error `admin.seats.errOrder` while `!fits` with "שמירה" disabled, and on save
   `admin.seats.saved`. A server `seat_reminder_after_deadline` shows `admin.seats.errDeadline`.
5. A muted footer `Card` with `admin.seats.who`, `admin.seats.lateNote` and `admin.seats.pending` (`{n}` =
   `t.pending`; hidden when null).
6. A `admin.seats.sample` row opens a `Sheet` with both pushes as lock-screen cards. Add the client copy of
   `seats.push.r1.*` / `r2.*` to i18n. A test compares those he/en strings with `seat_reminders` texts in
   `server/cloud/seat_reminders.py`, read with a regex.

- [ ] **Step 1: Write the failing tests.** `adminAreas.test.ts`: the seats area rows in order `print, behalf, responses,
  times, editor, holders`; `times` is in section `every`; `allowedTargets` includes `seatTimes` for gabbai and tech and
  not for member. `seatTimes.test.ts`: `timesStatus` for both on, one on and both off (he exact strings), and the push
  copy parity.
- [ ] **Step 2: Run them to verify they fail.** Run: `node --test tests/adminAreas.test.ts tests/seatTimes.test.ts`.
  Expected: FAIL.
- [ ] **Step 3: Implement** the screen, the row, the navigation, the fixtures and the i18n.
- [ ] **Step 4: Run the tests to verify they pass.** Run: `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Visual check:** `?role=gabbai&lang=he&screen=seat-times` at 390 light and dark and at 1280, `screen=
  seat-times-off` at 390 light, the time sheet open (an `act.mjs` click on the first value) at 390 light, and
  `screen=area-seats` at 390 light (the new "כל שבוע" section). Repeat once with `role=tech`. Check: the strip order,
  no clipping of "בין ה׳ 08:30 ל־ו׳ 10:30", and the Hebrew-first date.
- [ ] **Step 6: Commit**

```bash
git add src/views/admin/SeatTimes.tsx src/client/adminAreas.ts src/views/admin/Overview.tsx src/views/Main.tsx src/client/fixtures.ts src/seats/times.ts src/i18n/he.json src/i18n/en.json tests/adminAreas.test.ts tests/seatTimes.test.ts
git commit -m "Management: form times and reminders screen (week strip, one settings block, sample push) under מקומות ישיבה"
```

---

### Task 9: client — the mute switch in notification preferences

**Files:**
- Modify: `src/views/NotifyPrefs.tsx`, `src/client/push.ts` (`seatReminderPrefShown`), `src/client/fixtures.ts`
  (`prefs-seats`), `src/i18n/he.json`, `src/i18n/en.json`
- Test: `tests/push.test.ts`

**Interfaces:**
- Consumes: `useMemberSeats` (Task 6), `NotifyPrefs.seatReminders`.
- Produces: `seatReminderPrefShown(m: MemberSeats | null): boolean`, which is `!!m && m.remindable && (m.seatCount > 0
  || m.hadSeats)`.

The group "מקומות בשבת" (`seats.title`) has a `Toggle` labelled `prefs.seatReminders` with offNote
`prefs.seatRemindersOff` (§21.7 verbatim), bound to `n.seatReminders` through `change({ seatReminders: on })`. It is
placed after "סוגי הודעות", and only when `seatReminderPrefShown`.

- [ ] **Step 1: Write the failing test:** `seatReminderPrefShown` is false for null, for `remindable: false`, and for
  seats 0 without `hadSeats`. It is true for a remindable family with seats, or with `hadSeats`.
- [ ] **Step 2: Run it to verify it fails.** Run: `node --test tests/push.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests to verify they pass.** Run: `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Visual check:** `?role=member&lang=he&screen=prefs-seats` at 390 light and dark (the toggle on, then off
  with its note through an `act.mjs` click).
- [ ] **Step 6: Commit**

```bash
git add src/views/NotifyPrefs.tsx src/client/push.ts src/client/fixtures.ts src/i18n/he.json src/i18n/en.json tests/push.test.ts
git commit -m "Prefs: seat form reminders switch (mutes that person in that Kehila; card and row stay)"
```

---

### Task 10: deploy to dev (controller; the owner runs `terraform apply`)

Run by the controller, not a subagent.

- [ ] **Step 1: Run everything:** `npm test`, `npm run typecheck`, `npm run test:server`. Expected: all green. Report the
  counts and that `test_seat_reminder_job`, `test_seat_times` and `seatTimes.test.ts` ran.
- [ ] **Step 2: Opus whole-branch review** against §21 and this plan's Review Focus. Fix, then re-run Step 1.
- [ ] **Step 3: Ask the owner (before planning):** should dev's schedule start `ENABLED`? Dev Kehilot with a hall map
  would then get real reminders on Thursday 20:00 and Friday 11:00. Set `seat_reminders_state` in
  `infra/envs/dev/main.tf` to his answer and commit only that line if it changes.
- [ ] **Step 4: Build and plan:** `python3 tools/build_lambda.py`, then `cd infra/envs/dev && terraform plan -out
  dev.tfplan`. Expected changes only:
  - the Lambda code hashes of api, push-worker and jobs;
  - the jobs IAM policy and env (`PUSH_QUEUE_URL`);
  - one new `aws_scheduler_schedule.seat_reminders`.

  Anything else: stop and report.
- [ ] **Step 5: Hand off:** give the owner `! cd ~/work/kehilot/infra/envs/dev && terraform apply dev.tfplan` and wait.
- [ ] **Step 6: After the apply:**
  1. Run `.venv/bin/python tools/smoke_dev.py` (all PASS).
  2. Run `npm run deploy:web`.
  3. Run the dry run, which sends nothing:
     `AWS_DEFAULT_REGION=il-central-1 aws lambda invoke --function-name kehilot-dev-jobs --cli-binary-format
     raw-in-base64-out --payload '{"job":"seat_reminders","dryRun":true,"now":"2026-10-29T20:05"}'
     /tmp/claude-1000/seat-dry.json && cat /tmp/claude-1000/seat-dry.json`. Expected: `"dryRun"`-style output with
     `kehilot` ≥ 1 if a dev Kehila has a hall map, `due` listing reminder `"1"` with a recipient count, and `sent: []`.
  4. Confirm nothing was written or queued: `aws logs filter-log-events --log-group-name
     /aws/lambda/kehilot-dev-push-worker --filter-pattern seat_reminder --start-time <invoke ms>` returns no events.
     The same dry run repeated gives the same `due`, so no marker was claimed.
- [ ] **Step 7: Report:**
  - what was deployed, the smoke result and the dry-run counts (ids and counts only);
  - what to try on the phone: the bottom row on a weekday, the times screen as gabbai and as tech, the mute switch;
  - when the first real reminder fires, if the schedule is enabled;
  - what was not checked: real devices, 360-wide Android, English LTR, screen readers, real lock-screen truncation of
    the gentle text, and a real Thursday-night run.

  No `git push` without the owner.
