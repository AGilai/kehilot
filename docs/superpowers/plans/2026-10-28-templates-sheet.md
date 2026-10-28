# Message templates, message updates, weekly sheet items and gabbai logo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compose builds event, mazal tov and condolence messages from templates; a posted condolence or event can be
updated in place (same id, quiet push, one move to the top); mazal tov, condolences and events reach the weekly sheet
and Home through one server-side list that gabbaim approve, edit and order; gabbaim upload and remove the Kehila logo.

**Architecture:** Messages gain `templateId` and `fields` (validated on the server against the same field keys the client
schema uses), and a `PUT` update route that keeps the id, keeps history for gabbaim and, with `notify`, writes a bump
pointer, makes earlier reads stale and queues a quiet push. Sheet items are their own DynamoDB items per sheet week
(`SHI#<friday>#<itemId>`), created when a message is posted, synced when it is updated or removed, and served by one
`GET /sheet/{week}` that the print, the PDF, Home and the management screen all read. The sheet line is built on the
client from `fields` by pure functions (`src/client/templates.ts`), unless a gabbai stored an override line. The logo
gets gabbai `PUT`/`DELETE` routes on the existing `K#<k>/LOGO` item.

**Tech Stack:** Expo / React Native + web (`src/`, Node 22 `node --test`, `tsc`), Python 3 Lambda (`server/cloud/`,
DynamoDB single table, moto tests), Expo push via SQS worker, `expo-image-manipulator` for the logo crop.

**Spec:** `docs/UX-DESIGN.md` §19 in full (19.1–19.10), frames `design/mockups/frames/P43.html`, `P44.html`,
`P45.html`; owner decisions §19.9 rounds 1 and 2 (commit 76aabcb) are binding. Also §14.1 (schedule week), §14.4
(guest rule), §14.5 (sheet and fitting), §17.14 (upcoming simchas), §18.3 (management, "לטיפול עכשיו").

## Global Constraints

- **Invented names only** in code, tests, fixtures, seeds and docs (families such as ניסיון, דוגמה, בדיוני, לדוגמה; first
  names such as יוסף, מרים). Never a real congregant's name; never copy from `BeforeShabat.jpeg` or Neria data.
- **No PII in logs.** Never log titles, bodies, `fields`, sheet lines, family names, addresses, logo bytes or base64.
  Log ids and counts only (as `push_worker` does today).
- **Push privacy (existing rule):** `server/API.md` "Push notifications" says the title is the Kehila's name and the text
  is generic; the push-text editor says "the lock screen shows it: no names or private details".
- **Ruling (push):** §19.2a, adopted by the owner in §19.9 item 2 and item 3, conflicts with that rule for exactly two
  pushes, and the owner's later decision wins for them only: the shiva update push has title "עודכנו פרטי השבעה ·
  משפחת {surname}" and body "{address} · עד {day}"; the event change push has title "שינוי ב{event}: {what}" and body
  the Kehila name. Reasoning: the owner chose this text knowingly (it is drawn in P43 phone 6), the content is exactly
  what the message itself already shows to the same audience, and recipients go through the same visibility and mute
  filter as the message push. Guard rails: nothing beyond those fields (no deceased's name, relation, hours, prayer
  times, organisers or details); texts are built in the worker from DynamoDB, never put in the SQS job; each is cut
  to 80 code points; no Kehila custom push text applies; every other push stays generic.
- **i18n:** every new UI string exists in both `src/i18n/he.json` and `src/i18n/en.json` with the same placeholders
  (`tests/i18n.test.ts` enforces it). Keys and texts from §19.7 are used verbatim. Text that is built into a stored
  message or a sheet line is filled with a raw `fill()` (no FSI/PDI isolates; `translate()` adds them).
- **The printed sheet stays fixed Hebrew** (as `SHEET_TEXT` in `src/schedule/sheetModel.ts` says): sheet lines are always
  built with the Hebrew dictionary, and "ועוד {n} ברכות באפליקציה" goes into `SHEET_TEXT`, not i18n.
- **Times:** API times are Unix seconds. Week and cut-off maths use `Asia/Jerusalem` (`zoneinfo`; tzdata is vendored in
  the Lambda zip).
- **Visual check (every UI task):** one headless Chromium at a time, nothing else heavy running.
  1. `npm run web:fixtures` with `run_in_background` (port 8081; never port 3000, which is the live Flow-Mapper).
  2. `cd /home/ubuntu/tools/qa-browser && node act.mjs '<url>' <out>-he-light.png 390 844`, then the same with a final
     `dark` step for `<out>-he-dark.png`, then `node shoot.mjs '<url>' <out>-1280.png --width 1280 --height 900`.
     URLs are `http://localhost:8081/?role=<role>&lang=he&screen=<fixture screen>`; PNGs go to
     `/tmp/claude-1000/kehilot-shots-templates/`.
  3. Read each PNG; compare with the named P43/P44/P45 frame; no horizontal scroll at 390, nothing clipped, dark mode
     readable, the logo tile white in dark mode.
  4. Stop the server: `ps -eo pid,args | grep '[e]xpo start --web --port 8081'`, then `kill <that pid>`. Never
     `pkill -f`.
  5. Report what was checked and what was not (devices, screen readers, English LTR unless shot).
- **Shared files, other agents:** seat work is running in parallel. Do not touch `src/seats/*`,
  `server/cloud/*seat*`, `server/cloud/repo_seating.py`, `server/cloud/seating_*.py` or their tests. `handler.py`,
  `server/API.md`, `src/i18n/*.json` and `src/client/fixtures.ts` are shared: before editing one, run `git status`; if
  it has uncommitted changes you did not make, stop and tell the controller. Stage files by name only
  (`git add <path>`), never `-A` or `.`.
- **Roles (tech-role plan, 2026-10-28):** from now on "gabbai", "gabbai-only" and "gabbaim only" in Tasks 4–18 mean the management role set (`authz.MANAGEMENT` on the server, `isManagement` from `src/client/roles.ts` on the client, gabbai and tech) and "members and gabbaim" means `authz.ADULTS`, except what `docs/UX-DESIGN.md` §20.1 marks ✗ for tech, which stays `authz.GABBAI_ONLY`: message `history` and updating someone else's message as staff (Task 4 `_may_update`), simchas to the sheet (Task 15); use the named sets once `docs/superpowers/plans/2026-10-28-tech-role.md` Task 1 has landed, and give every new route a row in `server/tests/cloud/test_tech_inventory.py` once it exists.
- **Commits:** one per task, message as in the task, ending with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01FRubJBqpXEVMb7vLFxbfwk`. The repo identity is Asaf Gilai
  (checked). No `git push`.
- **Test commands:** `npm test` (all client tests), `node --test tests/<file>.test.ts` (one file), `npm run typecheck`,
  `npm run test:server` (`.venv/bin/python -m unittest discover -s server/tests -v`), one server module:
  `.venv/bin/python -m unittest server.tests.cloud.<module> -v`. All four must be green at the end of every task.
- **Rulings made here (spec silent or contradictory), binding for the tasks:**
  - Sheet week: Friday-to-Thursday (§14.1), named by its Friday `YYYY-MM-DD`. Mazal tov, condolences and free-text
    events posted Sunday through Friday 11:59 Israel time belong to that Friday's week; Friday from 12:00 and Saturday
    go to the next Friday's week. A templated event goes to the week its `fields.date` falls in.
  - "End of Shabbat" for dropping pending items is Sunday 00:00 Israel time after the week's Shabbat.
  - Condolences on the sheet (§19.9 item 1) have no drawn place. They print in the weekday column after the mazal tov,
    with no icon, and count with the mazal tov toward the 6-line cap and the "מזל טוב" meter. Management lists them
    in their own group "השתתפות בצער בגיליון · {n}". Home shows them after the mazal tov.
  - The "השתתפות בצער: רק בהוספה" rule row of §19.3 item 7 is superseded by round 2 and is not built.
  - A free "הודעה" item (Segmented option 3) goes in the events group.
  - The update routes accept only `event` and `condolence` messages. A free-text one opens the template form with what
    is known (family from the message) and becomes templated when saved.
  - Notify gating: with `notify: true` and no notify in the last 12 hours, the update moves the message up, makes it
    unread and queues one push. Inside the 12 hours the text is saved silently and the answer says `notified: false`.
    The client then shows `msg.update.savedQuiet` (new copy).
  - The default for "להודיע לחברים על העדכון" is on when the variant goes to "עם פרטי השבעה" from another variant, and
    on when an event's date, time or place changes or it is cancelled. It is off otherwise.
  - An event update with a changed `date`, `time` or `place` keeps the value as first posted (`firstFields`). The card
    shows that value struck next to the current one. A cancelled event uses `fields.cancelled = true` (form `Toggle`
    "האירוע בוטל", new key `msg.update.cancelEvent`).
  - A message update clears the gabbai's override line on its sheet item (the line "updates by itself"), and an event
    whose new date is in another week moves its item there with the same state and source.
  - Recipients of the update push are the message-push recipients (`push_worker.recipients(..., 'message', ...)`) minus
    the person who made the update.
  - Template date fields use a select of the next 60 days (event) or 14 days (shiva until), labelled "ג׳, 3.11"
    (`DayPicker`). No new native date dependency.
  - Not built in v1, because nothing exists to extend: Compose draft saving (§19.2 item 6), the `more` menu entry in
    Messages and the management message list (§19.2a item 2; the update is reached from the message view), the
    pinned-image picker (the "תמונה נעוצה" row is a reserved row and its meter reads the model), and "מהקבצים" on phones
    (it needs `expo-document-picker`, a native dependency; phones offer "מהתמונות", web offers the file chooser and drop
    zone).
  - Logo colour quantising (§19.4 step 3) runs on web only (canvas posterise). Native goes straight from 256 px to the
    "too detailed" error.

## Review Focus

1. **A bereaved-family adult who is no longer in that family** (unlinked, left the Kehila, or the family merged) tries to
   update the shiva details. The answer must be 403, computed from the family's live adults at request time and not from
   a stored list. Test: Task 4 `test_family_adult_who_left_cannot_update`.
2. **A second "notify" update within 12 hours** (a correction right after adding the details). It must save silently: no
   second jump to the top, no unread again, no second push, and `notified: false`. Test: Task 5
   `test_second_notify_within_12h_is_silent`.
3. **An event moved to a date in another week** after a gabbai edited its sheet line or approved it. It must leave the
   old week, appear in the new week with the same state and source, and show the rebuilt line. Test: Task 4
   `test_event_date_change_moves_sheet_item`.
4. **A guest in a Kehila whose guests may not see mazal tov.** The sheet list, the print and Home must all omit mazal tov
   (message and free items) and still show events. Test: Task 3 `test_listener_without_celebrations_sees_events_only`.
5. **The Friday-noon boundary** (11:59 vs 12:00 Israel time, a Saturday-night post, and a post in DST-switch weeks). Each
   must land in the right sheet week. Test: Task 2 `test_week_for_post_friday_noon_and_saturday`.

---

## File map

| File | Responsibility | Tasks |
|---|---|---|
| `server/cloud/message_fields.py` (new) | template field schemas, `validate_fields`, event change tracking | 1, 4 |
| `server/cloud/sheet_rules.py` (new) | pure: sheet week, group, initial state, order keys, pending expiry | 2 |
| `server/cloud/repo_sheet.py` (new) | `SheetRepo` mixin: `SHI#` items | 2 |
| `server/cloud/sheet_items.py` (new) | on post / update / remove orchestration | 2, 4 |
| `server/cloud/routes_sheet.py` (new) | sheet routes | 3 |
| `server/cloud/routes_messages.py` | post with fields, update route, list with bumps | 1, 4, 5 |
| `server/cloud/repo_messages.py` | fields, update, bumps, read times, scrub | 1, 4, 5 |
| `server/cloud/push.py`, `push_worker.py` | quiet update push | 5 |
| `server/cloud/logo.py`, `repo.py`, `routes_core.py` | logo codes, write/delete, `logoInfo`, `familyId`, `sheetMembers` | 2, 4, 6 |
| `server/cloud/routes_admin.py`, `repo_members.py` | `sheetMembers` setting | 2 |
| `server/cloud/handler.py` | route lines | 3, 4, 6 |
| `server/cloud/posts.py`, `export.py` | scrub and export new attributes | 1, 2 |
| `tools/seed_dev_messages.py`, `tools/smoke_dev.py` | dev seed and smoke | 3, 6 |
| `src/client/templates.ts` (new) | schemas, `buildMessage`, `buildSheetLine`, `missingFields`, day labels | 7 |
| `src/client/sheetItems.ts` (new) | pure: sheet item → line, groups, Home rows, fit meters | 11, 14, 15 |
| `src/views/compose/TemplateForm.tsx`, `TemplatePreview.tsx`, `DayPicker.tsx` (new) | template UI | 8 |
| `src/views/Compose.tsx` | template mode, update mode | 8, 10 |
| `src/client/feed.ts`, `messageView.ts`, `types.ts`, `endpoints.ts`, `store.ts`, `SessionProvider.tsx` | update data flow | 9, 11, 13, 16 |
| `src/views/MessageRow.tsx`, `MessageDetail.tsx` | updated/changed display, update card | 9, 10 |
| `src/schedule/sheetModel.ts`, `sheetSource.ts`, `Sheet.tsx`, `sheetHtml.ts` | items on the sheet, fitting | 11, 12 |
| `src/client/useSheetItems.ts` (new) | fetch hook shared by print, editor, Home, management | 11 |
| `src/client/waitingStore.ts`, `src/views/useWaiting.ts`, `src/client/adminAreas.ts` | pending count, todo, row target | 13 |
| `src/views/admin/SheetItems.tsx` (new), `src/views/admin/sheetItems/*.tsx` (new) | management screen | 14 |
| `src/views/HomeCards.tsx` / `src/views/Home.tsx`, `src/views/admin/Simchas.tsx` | WeekCard, simchas to sheet | 15 |
| `src/kit/LogoTile.tsx` (new), `src/media/logo.ts` (new), `src/views/admin/logo/*.tsx` (new) | logo | 16, 17 |

---

### Task 1: server — template `fields` on messages

**Files:**
- Create: `server/cloud/message_fields.py`
- Modify: `server/cloud/routes_messages.py` (`post_message`, `_message_json`), `server/cloud/repo_messages.py`
  (`put_message`, `scrub_message`), `server/cloud/export.py`, `server/API.md`
- Test: `server/tests/cloud/test_message_fields.py`

**Interfaces:**
- Produces: `message_fields.TEMPLATE_OF_TYPE = {'event': 'event', 'celebration': 'mazal', 'condolence': 'condolence'}`;
  `message_fields.validate_fields(template_id: str, value) -> dict` (raises `ApiError(400, 'invalid_fields', <path>)`);
  message item attributes `templateId`, `fields`; message JSON keys `templateId?`, `fields?`.
- `repo.put_message(..., template_id=None, fields=None)` (new keyword arguments).

Field schema (the contract with `src/client/templates.ts`, Task 7). Kinds: `text(max)`, `date` (`YYYY-MM-DD`, a real
date), `clock` (`HH:MM`), `enum(...)`, `bool`. **R** = required.

| templateId | key: kind |
|---|---|
| `event` | `name` text 120 R · `date` date R · `time` clock R · `place` text 120 R · `for` enum(all, men, women, youth, kids) R · `organisers` text 200 · `more` text 1000 · `cancelled` bool |
| `mazal` | `occasion` enum(birthSon, birthDaughter, barMitzvah, batMitzvah, engagement, wedding, other) R · `occasionOther` text 60 (R when `other`) · `whose` enum(parents, grandparents, other) R · `whoseOther` text 60 (R when `other`) · `surname` text 60 R · `firstNames` text 120 · `name` text 60 · `parents` text 120 · `blessing` text 200 |
| `condolence` | `variant` enum(only, later, full) R · `surname` text 60 R · `deceased` text 80 R · `relation` text 80 R · `address` text 200 · `hours` text 120 · `until` date · `prayers` text 200 (`address`, `hours`, `until` R when `full`; shiva fields are kept, not cleared, for other variants) |

Text values are stripped, refused when they contain control or bidi-override characters (reuse
`routes_admin._UNSAFE_TEXT`), and an empty optional text is dropped. Unknown keys fail as `<unknown>` (never echo the key).

- [ ] **Step 1: Write the failing tests** in `server/tests/cloud/test_message_fields.py` (copy the `MessagesTest.setUp`, `add`,
  `call`, `post` pattern from `test_messages.py`):

```python
EVENT = {'name': 'ערב לימוד', 'date': '2026-11-03', 'time': '20:30', 'place': 'בית הכנסת', 'for': 'all'}

def test_validate_event_ok_and_strips(self):
    self.assertEqual(validate_fields('event', {**EVENT, 'place': '  בית הכנסת ', 'organisers': ''}), EVENT)

def test_validate_rejects_unknown_key_without_echo(self):
    with self.assertRaises(ApiError) as e:
        validate_fields('event', {**EVENT, 'secret': 'x'})
    self.assertEqual((e.exception.code, e.exception.field), ('invalid_fields', '<unknown>'))

def test_validate_required_by_variant(self):
    base = {'variant': 'full', 'surname': 'ניסיון', 'deceased': 'יוסף', 'relation': 'אביו של משה'}
    with self.assertRaises(ApiError) as e:
        validate_fields('condolence', base)
    self.assertEqual(e.exception.field, 'address')
    self.assertEqual(validate_fields('condolence', {**base, 'variant': 'later'})['variant'], 'later')

def test_validate_bad_date_and_clock(self):
    for bad in ({**EVENT, 'date': '2026-02-30'}, {**EVENT, 'time': '25:00'}):
        with self.assertRaises(ApiError):
            validate_fields('event', bad)

def test_post_with_template_stores_and_returns_fields(self):
    status, body = self.post('announcements', type='event', templateId='event', fields=EVENT)
    self.assertEqual(status, 201)
    self.assertEqual((body['templateId'], body['fields']), ('event', EVENT))
    status, got = self.call('GET', f"{self.base()}/messages/{body['messageId']}")
    self.assertEqual(got['fields'], EVENT)

def test_post_template_must_match_type(self):
    self.assertEqual(self.post('announcements', type='general', templateId='event', fields=EVENT),
                     (400, {'error': 'invalid_template_id'}))
    self.assertEqual(self.post('announcements', type='event', fields=EVENT),
                     (400, {'error': 'invalid_template_id'}))   # fields without templateId

def test_scrub_removes_fields(self):
    _, body = self.post('announcements', type='event', templateId='event', fields=EVENT)
    self.repo.scrub_message(self.k, body['messageId'])
    self.assertNotIn('fields', self.repo.get_message(self.k, body['messageId']))
```

- [ ] **Step 2: Run** `.venv/bin/python -m unittest server.tests.cloud.test_message_fields -v`. Expected: FAIL, `ModuleNotFoundError: server.cloud.message_fields`.
- [ ] **Step 3: Implement** `validate_fields(template_id, value) -> dict` in `message_fields.py` on `schedule_rules.Checker('invalid_fields')`.
  In `post_message`: read optional `templateId` (`inputs.choice` over `('event', 'mazal', 'condolence')`). It must equal
  `TEMPLATE_OF_TYPE.get(type_)`, and `fields` must be present exactly when `templateId` is; otherwise 400
  `invalid_template_id`. Pass both to `put_message`. Add both keys to `_message_json` when present (plain JSON:
  `schedule_rules.plain`). In `scrub_message`, add `REMOVE fields, templateId` to the update. In `export.py`, add
  `templateId` and `fields` to each exported message entry.
- [ ] **Step 4: Run** the module, then `npm run test:server`. Expected: PASS.
- [ ] **Step 5: Document** in `server/API.md` → Channels and messages: the POST body gains `templateId?` and `fields?`, add the
  schema table above, the error codes `invalid_template_id` and `invalid_fields` (with a `field` path), and the message
  object gains `templateId?` and `fields?`.
- [ ] **Step 6: Commit** `git add server/cloud/message_fields.py server/cloud/routes_messages.py server/cloud/repo_messages.py server/cloud/export.py server/API.md server/tests/cloud/test_message_fields.py && git commit -m "Messages: template fields (event, mazal tov, condolence), validated and stored"`

---

### Task 2: server — sheet item storage, rules, and items created with messages

**Files:**
- Create: `server/cloud/sheet_rules.py`, `server/cloud/repo_sheet.py`, `server/cloud/sheet_items.py`
- Modify: `server/cloud/repo.py` (add `SheetRepo` to `Repo` bases), `server/cloud/routes_messages.py` (`post_message`,
  `remove_message`), `server/cloud/posts.py` (scrub path), `server/cloud/routes_admin.py` (`set_settings`),
  `server/cloud/repo_members.py` (`set_settings`), `server/cloud/routes_core.py` (`kehila`)
- Test: `server/tests/cloud/test_sheet_items.py`

**Interfaces:**
- Consumes: `validate_fields` and the `fields` attribute (Task 1); `schedule_rules.week_expiry(friday)`.
- Produces (pure, `sheet_rules.py`):
  - `JERUSALEM = ZoneInfo('Asia/Jerusalem')`
  - `week_for_post(now: datetime, type_: str, fields: dict | None) -> date` (the Friday)
  - `GROUP_OF = {'celebration': 'mazal', 'condolence': 'condolence', 'event': 'events', 'notice': 'events'}`
  - `SHEET_TYPES = ('celebration', 'condolence', 'event')`
  - `SHEET_MEMBERS = ('approve', 'auto')`, `sheet_members(settings) -> str` (default `'approve'`)
  - `initial_state(role: str, setting: str) -> tuple[str, str]`, returning `(state, source)`: gabbai → `('in', 'auto')`;
    member under `'auto'` → `('in', 'auto')`; member under `'approve'` → `('pending', 'member')`.
  - `default_order(type_: str, message_id: str, fields: dict | None) -> str`: events
    `'1' + date + time + message_id` (free-text: `'1' + message_id`); others `'1' + message_id`.
  - `appended_order() -> str` = `'2' + new_id()`
  - `pending_expired(friday: date, now: datetime) -> bool` (now ≥ Sunday 00:00 Israel after that Shabbat)
- Produces (`repo_sheet.py`, `class SheetRepo`), item `pk = K#<k>`, `sk = SHI#<friday>#<itemId>`. Attributes: `itemId`,
  `week`, `kind` (`message` or `free`), `type`, `group`, `state` (`in`, `pending`, `removed`), `source` (`auto`,
  `approved`, `byGabbai`, `free`, `member`), `wasPending` (bool), `order` (str), `messageId?`, `line?` `{text, bold}`,
  `approvedBy?` (userId), `createdAt` (s), `expiresAt` (= `week_expiry(friday)`):
  - `put_sheet_item(k, friday: str, item: dict) -> dict` (conditional `attribute_not_exists(sk)`, so a retried post never
    duplicates)
  - `get_sheet_item(k, friday, item_id) -> dict | None`
  - `list_sheet_items(k, friday, now: int) -> list[dict]` (consistent, drops `expiresAt <= now`, sorted by `(group, order)`)
  - `update_sheet_item(k, friday, item_id, sets: dict, removes: tuple = ()) -> dict` (`ALL_NEW`; 404
    `item_not_found` when missing)
  - `swap_sheet_order(k, friday, a: dict, b: dict) -> None` (one transaction, each conditioned on its read `order`;
    409 `try_again`)
  - `delete_sheet_item(k, friday, item_id) -> None`
  - `set_message_sheet_week(k, message_id, friday: str | None) -> None` (sets or removes the `sheetWeek` attribute on
    the message item)
- Produces (`sheet_items.py`):
  - `on_post(repo, k, membership, settings, message: dict, now: datetime) -> dict | None`: for `SHEET_TYPES` only,
    creates the item (`itemId` = messageId) and sets `sheetWeek`.
  - `on_remove(repo, k, message: dict) -> None`: deletes the item when `sheetWeek` is set.
- Settings: `PUT /admin/settings` accepts `sheetMembers: 'approve' | 'auto'` (400 `invalid_sheet_members`), stored as
  `settings.sheetMembers`. `GET /v1/kehilot/{k}` returns `sheetMembers` to members and gabbaim. Members need it for the
  Compose caption.

- [ ] **Step 1: Write the failing tests** in `test_sheet_items.py`:

```python
J = ZoneInfo('Asia/Jerusalem')
def at(y, m, d, hh, mm):
    return datetime(y, m, d, hh, mm, tzinfo=J).astimezone(timezone.utc)

def test_week_for_post_friday_noon_and_saturday(self):          # Review Focus 5
    self.assertEqual(week_for_post(at(2026, 10, 30, 11, 59), 'celebration', None), date(2026, 10, 30))
    self.assertEqual(week_for_post(at(2026, 10, 30, 12, 0), 'celebration', None), date(2026, 11, 6))
    self.assertEqual(week_for_post(at(2026, 10, 31, 21, 0), 'condolence', None), date(2026, 11, 6))
    self.assertEqual(week_for_post(at(2026, 10, 25, 9, 0), 'celebration', None), date(2026, 10, 30))
    self.assertEqual(week_for_post(at(2026, 3, 27, 11, 30), 'celebration', None), date(2026, 3, 27))  # DST Friday
    self.assertEqual(week_for_post(at(2026, 10, 28, 9, 0), 'event', {'date': '2026-11-10'}), date(2026, 11, 6))

def test_pending_expires_after_shabbat(self):
    self.assertFalse(pending_expired(date(2026, 10, 30), at(2026, 10, 31, 23, 59)))
    self.assertTrue(pending_expired(date(2026, 10, 30), at(2026, 11, 1, 0, 0)))

def test_gabbai_post_goes_in_auto(self): ...          # item state 'in', source 'auto', message has sheetWeek
def test_member_post_is_pending_by_default(self): ... # state 'pending', source 'member', wasPending True
def test_member_post_auto_when_setting_auto(self): ...# PUT /admin/settings {'sheetMembers': 'auto'} then post -> 'in'
def test_general_and_weekly_make_no_item(self): ...
def test_removed_message_removes_item(self): ...      # DELETE /messages/{m} -> list_sheet_items empty
def test_scrubbed_message_removes_item(self): ...     # posts.py scrub path
def test_settings_sheet_members_validation(self):
    self.assertEqual(self.call('PUT', f'{self.base()}/admin/settings', body={'sheetMembers': 'x'}),
                     (400, {'error': 'invalid_sheet_members'}))
def test_kehila_returns_sheet_members_to_members(self): ...  # 'approve' by default, listener gets no key
```

  The route-level tests patch `sheet_rules` time through `mock.patch.object(sheet_items, '_now', return_value=...)`. Put
  a module-level `_now()` in `sheet_items.py` and do not read the clock anywhere else.
- [ ] **Step 2: Run** `.venv/bin/python -m unittest server.tests.cloud.test_sheet_items -v`. Expected: FAIL (`ModuleNotFoundError`).
- [ ] **Step 3: Implement** `sheet_rules.py` and `repo_sheet.py`, add `SheetRepo` to `class Repo(...)`, then `sheet_items.on_post`
  and `on_remove`. In `post_message`, after `put_message`, call `sheet_items.on_post(ctx.repo, k, membership,
  settings, item, sheet_items._now())`. In `remove_message`, call `on_remove` after `repo.remove_message`. In
  `posts.py`, call `on_remove` for every scrubbed message. Add `sheet_members` to `repo.set_settings`, to
  `routes_admin.set_settings` (add it to the at-least-one key list) and to `routes_core.kehila`.
- [ ] **Step 4: Run** the module and `npm run test:server`. Expected: PASS.
- [ ] **Step 5: Commit** `git add server/cloud/sheet_rules.py server/cloud/repo_sheet.py server/cloud/sheet_items.py server/cloud/repo.py server/cloud/routes_messages.py server/cloud/posts.py server/cloud/routes_admin.py server/cloud/repo_members.py server/cloud/routes_core.py server/tests/cloud/test_sheet_items.py && git commit -m "Sheet items: per-week items created with mazal tov, condolence and event posts; members' posts pending by setting"`

---

### Task 3: server — sheet routes, free items, dev seed

**Files:**
- Create: `server/cloud/routes_sheet.py`
- Modify: `server/cloud/handler.py` (four route lines), `server/API.md`, `tools/seed_dev_messages.py`
- Test: `server/tests/cloud/test_sheet_routes.py`

**Interfaces:**
- Consumes: Task 2 repo and rules; `visibility.message_visible`; `routes_messages._message_json`, `kehila_rules`.
- Produces routes (all `week` = a Friday checked with `schedule_rules.week_start`, else 400 `invalid_week_start`):
  - `GET /v1/kehilot/{k}/sheet/{week}` → `routes_sheet.get_sheet`, any role. Answers 200
    `{week, items: [item]}` sorted by `(group, order)`. Non-gabbaim get only `state == 'in'` items whose message is
    visible to them (`message_visible` with the Kehila's rules). Free `celebration` items follow the same listener rule
    as celebration messages. Gabbaim get every state, except pending items once `pending_expired`.
  - `POST /v1/kehilot/{k}/admin/sheet/{week}/items` → `add_item`, gabbai. Body
    `{type: 'celebration'|'event'|'notice', text: 1-300 (one '\n' allowed), bold?: 0-60 (celebration only),
    source?: 'free'|'byGabbai'}`, answers 201 item. The week may be at most 63 days ahead and not past its
    `week_expiry`. Limit: 40 items per week → 409 `too_many_items`.
  - `PUT /v1/kehilot/{k}/admin/sheet/{week}/items/{itemId}` → `set_item`, gabbai. Body
    `{state?: 'in'|'pending'|'removed', line?: {text, bold} | null}`, at least one key. `pending` is allowed only when
    `wasPending`. pending → in sets `source: 'approved'`, `approvedBy`, and `order = appended_order()`. `line: null`
    clears the override (400 `invalid_line` on a free item). Answers 200 item.
  - `POST /v1/kehilot/{k}/admin/sheet/{week}/items/{itemId}/move` → `move_item`, gabbai. Body `{direction: 'up'|'down'}`
    swaps `order` with the neighbour among the group's non-removed items. Answers 200 `{week, items}` (as GET);
    409 `cannot_move` at an edge.
- Item JSON: `{itemId, week, group, kind, type, state, source, postedAt, line?, message?}`. Gabbaim also get `wasPending`,
  `postedBy` (author's display name) and `approvedBy` (approver's current display name or `""`). `message` is
  `_message_json(message)` for message items.
- Errors: 400 `invalid_week_start`, `invalid_type`, `invalid_text`, `invalid_bold`, `invalid_source`, `invalid_state`,
  `invalid_line`, `invalid_direction`, `invalid_body`; 403 `forbidden`; 404 `item_not_found`; 409 `cannot_move`,
  `too_many_items`, `try_again`.

- [ ] **Step 1: Write the failing tests** in `test_sheet_routes.py`. Each asserts the status and the listed fields:
  - `test_member_sees_only_in_items`: a pending member post is missing for a member and present for a gabbai.
  - `test_listener_without_celebrations_sees_events_only` (**Review Focus 4**): rules
    `celebration.listeners=False`. A listener gets the event and the free notice, and neither the mazal tov message
    item nor the free celebration item.
  - `test_approve_appends_and_records_approver`: approve two pending items in reverse order; the order of GET is
    the approval order after the auto items, and `source == 'approved'`.
  - `test_undo_approve_back_to_pending_only_if_was_pending`: an auto item set to `pending` → 400 `invalid_state`.
  - `test_pending_dropped_after_shabbat`: patch `routes_sheet._now` past Sunday 00:00 → the pending item is missing for a
    gabbai, while the `in` items stay.
  - `test_move_up_down_and_edges`: three items `a b c`; move `c` up → `a c b`; move `a` up → 409 `cannot_move`.
  - `test_line_override_and_clear`: PUT line → item `line`; PUT `line: null` → no `line`.
  - `test_free_item_validation_and_limit`: `bold` on an event → 400 `invalid_bold`; the 41st item → 409.
  - `test_member_cannot_use_admin_routes`: 403 for a member on POST, PUT and move.
  - `test_other_kehila_404`.
- [ ] **Step 2: Run** `.venv/bin/python -m unittest server.tests.cloud.test_sheet_routes -v`. Expected: FAIL (404 `not_found` from the router).
- [ ] **Step 3: Implement** `routes_sheet.py` (module `_now()` as in Task 2) and add the four `ROUTES` lines in `handler.py`
  next to the schedule routes. Load the item's messages with one `repo.batch_get`, and the channels and rules once per
  request.
- [ ] **Step 4: Run** the module and `npm run test:server`. Expected: PASS.
- [ ] **Step 5: Update `tools/seed_dev_messages.py`:** a `--templates` flag adds, for the current and next sheet week, three
  templated messages per type (invented names from `FAMILIES`/`FIRST`) with valid `fields`, calls
  `sheet_items.on_post` for each (one member post, so one item is pending), and tags them `seed=dev-messages` so
  `--remove` also removes them and their items (`on_remove`). Dry run unless `--apply`.
- [ ] **Step 6: Document** in `server/API.md` a new "#### Weekly sheet items" section: the item key table row
  `K#<k> | SHI#<friday>#<itemId>` and its attributes, the rules (week, cut-off, pending expiry, initial state), the four
  routes and the error codes.
- [ ] **Step 7: Commit** `git add server/cloud/routes_sheet.py server/cloud/handler.py server/API.md tools/seed_dev_messages.py server/tests/cloud/test_sheet_routes.py && git commit -m "Sheet items: list by week per role, approve/remove, line override, reorder, free items; dev seed"`

---

### Task 4: server — message update route (fields, history, authorization, sheet sync)

**Files:**
- Modify: `server/cloud/routes_messages.py` (new `update_message`, `_message_json`), `server/cloud/repo_messages.py`
  (new `update_message`), `server/cloud/message_fields.py` (`event_changes`), `server/cloud/sheet_items.py`
  (`on_update`), `server/cloud/routes_core.py` (`familyId`), `server/cloud/handler.py`, `server/API.md`
- Test: `server/tests/cloud/test_message_update.py`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces:
  - Route `PUT /v1/kehilot/{k}/messages/{m}` → `routes_messages.update_message`, for members and gabbaim. Body
    `{title, body?, fields, notify: bool}`. Answers 200 `{...message, notified: bool}` (`notified` is always false in
    this task; Task 5 sets it).
  - `message_fields.event_changes(first: dict, new: dict) -> dict`: `{key: first[key]}` for `key in ('date', 'time',
    'place')` where `new[key] != first[key]`.
  - `repo.update_message(k, message_id, *, title, body, template_id, fields, first_fields, changed, history_entry,
    updated_by, now, seen_updated_at) -> dict`: one `update_item`, `ALL_NEW`. It sets title, body, templateId, fields,
    `firstFields` (only `if_not_exists`), `changed` (removed when empty), `updatedAt = now`, `updatedBy`, and
    `history = list_append(if_not_exists(history, []), [entry])`, then trims to the last 10 in a second update when
    longer. Condition: `attribute_exists(sk) AND removed = false` plus `updatedAt = :seen` (or
    `attribute_not_exists(updatedAt)` when `seen_updated_at is None`). Failure: 404 `message_not_found` when gone,
    else 409 `try_again`.
  - `sheet_items.on_update(repo, k, before: dict, after: dict, now: datetime) -> None`: clears `line`; for an event
    whose `week_for_post` changed, moves the item (put new with the same `state`, `source`, `wasPending`,
    `approvedBy`, a fresh `default_order`; delete the old one; `set_message_sheet_week`).
  - Message JSON gains `updatedAt?` (s), `changed?`. GET single message adds `history: [{title, body, at}]` for
    gabbaim only (never in the list, the change feed or for others).
  - `GET /v1/kehilot/{k}` gains `familyId` (string or null) for members and gabbaim.
- Authorization (`_may_update(ctx, k, membership, message) -> bool`): gabbai; or `authorId == user`; or, for a
  `condolence` with `targetFamilyId`, the caller is in `repo.live_adults(k, repo.get_family(k, targetFamilyId))` at
  request time. Not `families.target_adults`, whose fallbacks would widen the set.
- Rules: only `event` and `condolence` messages (409 `not_updatable` otherwise, also for chat). `fields` are validated
  with `TEMPLATE_OF_TYPE[type]`, and `templateId` is set from the type. Title and body limits as in POST. The
  history entry is `{title, body, at, by}` from the stored message before the change. A `put_change(k, 'message', m,
  channelId)` goes out after every update.

- [ ] **Step 1: Write the failing tests** in `test_message_update.py` (fixture: a gabbai, an author member with
  `canBroadcast`, a family of two adults as in `test_replies.py`, an unrelated member, a listener):
  - `test_author_updates_shiva_keeps_id_and_history`: update adds `full` fields → 200, same `messageId`, new `body`,
    `updatedAt` set. GET as gabbai has `history[0].body` == the old body; GET as the author has no `history`.
  - `test_family_adult_may_update_condolence`: the second adult (not the author) → 200.
  - `test_family_adult_who_left_cannot_update` (**Review Focus 1**): unlink the adult (`repo` family helpers as
    `test_families.py` does) → 403 `forbidden`.
  - `test_condolence_without_target_family_only_author_and_gabbai`.
  - `test_unrelated_member_and_listener_forbidden`: 403 for the member. The listener gets 403 from `require`.
  - `test_general_message_not_updatable`: 409 `not_updatable`.
  - `test_event_changes_keep_first_values`: post 20:30, update to 21:00, then to 21:15 → `changed == {'time': '20:30'}`;
    back to 20:30 → no `changed`.
  - `test_event_date_change_moves_sheet_item` (**Review Focus 3**): approve and override the line in week A, update the
    date into week B → week A list has no item; week B item has `state 'in'`, `source 'approved'` and no `line`.
  - `test_update_puts_change_and_history_capped_at_10`.
  - `test_stale_update_is_try_again`: patch `repo.update_message` to run against a changed `updatedAt` → 409 `try_again`.
  - `test_kehila_returns_family_id`.
- [ ] **Step 2: Run** `.venv/bin/python -m unittest server.tests.cloud.test_message_update -v`. Expected: FAIL (405 `method_not_allowed` from the router).
- [ ] **Step 3: Implement** in the order of the interfaces above and add the `PUT` line next to the other `/messages/{m}` routes
  in `handler.py`. Also extend `repo.scrub_message` to remove `history`, `firstFields` and `changed`, and extend the
  Task 1 scrub test.
- [ ] **Step 4: Run** the module and `npm run test:server`. Expected: PASS.
- [ ] **Step 5: Document** in `server/API.md`: the PUT route row (body, 200 shape, errors 400 `invalid_title`, `invalid_body`,
  `invalid_fields`, `invalid_notify`; 403; 404 `message_not_found`; 409 `not_updatable`, `try_again`), the new message
  keys, gabbai-only `history`, and `familyId` on the Kehila route.
- [ ] **Step 6: Commit** `git add server/cloud/routes_messages.py server/cloud/repo_messages.py server/cloud/message_fields.py server/cloud/sheet_items.py server/cloud/routes_core.py server/cloud/handler.py server/API.md server/tests/cloud/test_message_update.py server/tests/cloud/test_message_fields.py && git commit -m "Messages: update in place for events and condolences (author, gabbai, bereaved family adults), history for gabbaim, sheet item follows"`

---

### Task 5: server — notify: one move to the top, unread again, quiet push (12 h)

**Files:**
- Modify: `server/cloud/routes_messages.py` (`update_message`, `list_messages`, `get_message`, `read`),
  `server/cloud/repo_messages.py`, `server/cloud/push.py`, `server/cloud/push_worker.py`, `server/API.md`
- Test: `server/tests/cloud/test_message_update.py` (new class `NotifyTest`), `server/tests/cloud/test_push_update.py`

**Interfaces:**
- Consumes: Task 4 route and repo.
- Produces:
  - `NOTIFY_WINDOW = 12 * 3600` in `routes_messages.py`. Message attributes `notifiedAt` (s), `bumpId` (ULID),
    `bumpedAt` (s). JSON adds `bumpId?`.
  - `repo.mark_notified(k, message_id, now, bump_id) -> bool`: conditional
    `attribute_not_exists(notifiedAt) OR notifiedAt <= :cut` (`cut = now - NOTIFY_WINDOW`). False when the window
    blocks.
  - `repo.put_bump(k, bump_id, message_id, expires_at)`: item `pk K#<k>`, `sk BUMP#<bumpId>`, `messageId`,
    `expiresAt = now + 14 days`.
  - `repo.list_bumps_after(k, after_id: str | None) -> list[dict]`: `BUMP#` items with `sk > BUMP#<after_id>`, newest
    first.
  - `repo.read_times(k, user_id, message_ids) -> dict[str, int]` (from `READ#` items' `at`). `read_flags` stays,
    implemented on top of it.
  - Read rule: `read = at is not None and at >= message.get('bumpedAt', 0)`, used by `list_messages` and
    `get_message`. The updater gets `put_read` right after a bump.
  - `list_messages` without `before`: after the page is built, merge visible, not-removed messages from
    `list_bumps_after(oldest id on the page)` (all bumps when the page is shorter than `limit`) that are not already on
    it. Sort by `bumpId or messageId` descending; the page may then exceed `limit` by the merged count. With `before`,
    nothing changes.
  - `push.enqueue('message_update', k, message_id)` only when `mark_notified` returned True.
  - `push.UPDATE_TEXT` (fixed, not editable, not in `PUSH_TEXT`):
    `{'shiva': {'he': 'עודכנו פרטי השבעה · משפחת {surname}', 'en': 'Shiva details updated · {surname} family'},
    'event': {'he': 'שינוי ב{event}: {what}', 'en': 'Change to {event}: {what}'},
    'until': {'he': 'עד {day}', 'en': 'until {day}'}, 'cancelled': {'he': 'בוטל', 'en': 'cancelled'}}`.
  - `push.short_day(iso: str, lang: str) -> str`: he `'יום ב׳ (9.11)'`, en `'Mon 9.11'`.
  - `push.update_texts(message: dict, lang: str, kehila_name: str) -> tuple[str, str]` (title, body) per the Global
    Constraints ruling. `what` is: `cancelled` when `fields.cancelled`; otherwise the current values of the keys in
    `changed`, ordered time, date (`short_day`), place, joined with `' · '`. Both are cut to `PUSH_TEXT_MAX` code points
    with a trailing `…`.
  - `push_worker`: `_process` accepts `kind == 'message_update'`. `recipients` handles it as `'message'` and removes
    `message['updatedBy']`. `_build` uses `update_texts`, and each Expo message has `'priority': 'normal'`,
    `'channelId': 'quiet'` and `'interruptionLevel': 'passive'`, and no `sound` key.

- [ ] **Step 1: Write the failing tests.**
  `NotifyTest` in `test_message_update.py`:
  - `test_notify_bumps_marks_unread_and_enqueues`: the member reads the message; the author updates with `notify: true`
    (patch `push.enqueue`). Then `enqueue` was called once with `('message_update', k, m)`. The member's GET says
    `read: false`. The updater's GET says `read: true`. A `GET /messages?limit=1` returns the bumped old message first
    (merged), and its JSON has `bumpId`.
  - `test_second_notify_within_12h_is_silent` (**Review Focus 2**): a second update with `notify: true` at +1 h (patch
    `routes_messages._now`) → `notified: false`, `enqueue` not called again, `bumpId` unchanged, still read for a member
    who read after the first bump. At +12 h 1 s → `notified: true`.
  - `test_notify_false_never_bumps`.
  - `test_before_cursor_ignores_bumps`.
  `test_push_update.py`:
  - `test_shiva_texts_he_en`: fields `{surname: 'ניסיון', address: 'רחוב הדוגמה 5', until: '2026-11-09'}` → he
    `('עודכנו פרטי השבעה · משפחת ניסיון', 'רחוב הדוגמה 5 · עד יום ב׳ (9.11)')`.
  - `test_event_texts_what_changed_and_cancelled`: changed time → `'שינוי בערב לימוד: 21:00'`; cancelled →
    `'שינוי בערב לימוד: בוטל'`.
  - `test_texts_cut_to_80_code_points`.
  - `test_quiet_message_shape`: build with a moto table and a fake device → `priority == 'normal'`,
    `channelId == 'quiet'`, `interruptionLevel == 'passive'`, `'sound' not in message`, `data == {kehila, messageId}`.
  - `test_updater_and_muted_not_recipients`: the updater, a member who muted `condolence` and a member who muted the
    author are left out.
  - `test_job_carries_ids_only`: the SQS body is exactly `{kind, kehila, ref}`.
- [ ] **Step 2: Run** both modules. Expected: FAIL (`AttributeError: ... mark_notified` / `UPDATE_TEXT`).
- [ ] **Step 3: Implement** the interfaces above; `routes_messages._now()` returns `int(time.time())` and is the only clock
  used by the update route.
- [ ] **Step 4: Run** both modules and `npm run test:server`. Expected: PASS.
- [ ] **Step 5: Document** in `server/API.md`: the `notify` semantics on the PUT row (12 h window, `notified`), `bumpId` and the
  first-page merge on `GET /messages`, the read rule, and the "Push notifications" paragraph with the ruling (the two
  update pushes, their fields, quiet delivery, recipients).
- [ ] **Step 6: Commit** `git add server/cloud/routes_messages.py server/cloud/repo_messages.py server/cloud/push.py server/cloud/push_worker.py server/API.md server/tests/cloud/test_message_update.py server/tests/cloud/test_push_update.py && git commit -m "Message update notify: one move to the top, unread again, one quiet push per 12 hours"`

---

### Task 6: server — gabbai logo upload and removal; smoke checks

**Files:**
- Modify: `server/cloud/logo.py`, `server/cloud/repo.py` (`set_logo`, new `delete_logo`), `server/cloud/routes_core.py`
  (`put_logo`, `delete_logo`, `kehila`), `server/cloud/handler.py`, `tools/kehila_admin.py` (only if the new
  `set_logo` signature needs it), `tools/smoke_dev.py`, `server/API.md`
- Test: `server/tests/cloud/test_logo.py` (new class `LogoRouteTest`)

**Interfaces:**
- Produces:
  - `class LogoError(ValueError)` with `.code` in `('logo_format', 'logo_not_square', 'logo_too_small',
    'logo_too_large')`, raised by `validate_logo`; the messages are unchanged, so the CLI and the existing tests keep
    working. `logo_too_large` covers both bytes > 65,536 and side > 512.
  - `repo.set_logo(k, data, by=None, side=None) -> str` also sets `META.logoInfo = {by, at, bytes, side}` (by omitted
    from the CLI). `repo.delete_logo(k) -> None`: one transaction, deleting `LOGO` and doing `REMOVE logoVersion,
    logoInfo` on META (404 `kehila_not_found` when META is missing).
  - `PUT /v1/kehilot/{k}/admin/logo` → `routes_core.put_logo`, gabbai. Body `{data: <base64 PNG>}` read with
    `inputs.body_object(ctx, LOGO_BODY_MAX)`, where `LOGO_BODY_MAX = 96 * 1024`. Strict base64
    (`base64.b64decode(..., validate=True)`). Answers 200 `{logoVersion}`. Errors: 400 `invalid_logo_format` (bad base64
    or not PNG), `logo_not_square`, `logo_too_small`, `logo_too_large`, `invalid_body`; 403.
  - `DELETE /v1/kehilot/{k}/admin/logo` → `routes_core.delete_logo`, gabbai. Answers 204 (also when there is no logo).
  - `GET /v1/kehilot/{k}` gains `logoInfo` for gabbaim: `{name, at, bytes, side}` (name = the uploader's current
    display name or `""`), or null.

- [ ] **Step 1: Write the failing tests** in `LogoRouteTest` (reuse `make_png` from the same file):
  - `test_gabbai_uploads_and_version_changes`: PUT `make_png(256)` → 200; `GET /logo` returns the same bytes; GET kehila
    `logoVersion` changed, `logoInfo == {'name': <gabbai name>, 'at': ..., 'bytes': len(png), 'side': 256}`.
  - `test_limits_map_to_codes`: `make_png(63)` → `logo_too_small`; `make_png(513)` → `logo_too_large`;
    `make_png(64, pad=65537 - len(make_png(64)))` → `logo_too_large`; `make_png(100, 80)` → `logo_not_square`;
    `'not base64!'` → `invalid_logo_format`; a GIF → `invalid_logo_format`. The 65,536-byte PNG → 200.
  - `test_member_forbidden_listener_forbidden`.
  - `test_delete_removes_logo_and_version`: then `GET /logo` → 404 `not_found`; kehila `logoVersion` null,
    `logoInfo` null; a second DELETE → 204.
  - `test_logo_bytes_never_logged`: `assertLogs` over the PUT with a bad body; no record contains the base64 prefix.
- [ ] **Step 2: Run** `.venv/bin/python -m unittest server.tests.cloud.test_logo -v`. Expected: FAIL (404 `not_found`).
- [ ] **Step 3: Implement** the interfaces and add both route lines after the `GET .../logo` line in `handler.py`.
- [ ] **Step 4: Run** the module and `npm run test:server`. Expected: PASS.
- [ ] **Step 5: Add smoke checks** to `tools/smoke_dev.py` (each prints one PASS/FAIL line, using the throwaway Kehila it already
  creates): post a templated condolence as a member → GET `/sheet/{week}` as gabbai shows it pending; approve → a
  listener allowed celebrations sees it; update with `notify` → `notified: true`, second → false; PUT and DELETE the logo
  with a generated 64 px PNG. Do not run it (Task 18 does).
- [ ] **Step 6: Document** in `server/API.md`: the two logo routes, the codes, `logoInfo`, and that the CLI and the app share
  `validate_logo`.
- [ ] **Step 7: Commit** `git add server/cloud/logo.py server/cloud/repo.py server/cloud/routes_core.py server/cloud/handler.py tools/smoke_dev.py server/API.md server/tests/cloud/test_logo.py && git commit -m "Logo: gabbai upload and removal with the CLI's validation, logoInfo; smoke checks for templates, sheet and logo"`
  (add `tools/kehila_admin.py` only if it changed).

---

### Task 7: client — template core (schemas, built text, sheet lines) and copy

**Files:**
- Create: `src/client/templates.ts`
- Modify: `src/i18n/he.json`, `src/i18n/en.json`, `src/client/types.ts`
- Test: `tests/templates.test.ts`

**Interfaces:**
- Produces (`types.ts`): `export type TemplateId = 'event' | 'mazal' | 'condolence'`;
  `export type TemplateFields = Record<string, string | boolean>`; `Message` gains `templateId?: TemplateId`,
  `fields?: TemplateFields`; `PostMessageBody` gains `templateId?: TemplateId`, `fields?: TemplateFields`.
- Produces (`templates.ts`):
  - `type FieldSpec = { key: string; kind: 'text' | 'long' | 'date' | 'time' | 'chips' | 'family'; required: boolean;
    options?: string[]; labelKey: string; requiredWhen?: (f: TemplateFields) => boolean; showWhen?: (f: TemplateFields) => boolean;
    days?: number }`. The keys and requirements equal the Task 1 server table (`family` is the existing picker, and
    fills `surname` and `firstNames`).
  - `TEMPLATES: Record<TemplateId, FieldSpec[]>`, in the §19.2 field order.
  - `templateOf(type: MessageType): TemplateId | null`
  - `missingFields(id: TemplateId, f: TemplateFields): string[]` (keys, in form order)
  - `buildMessage(id: TemplateId, f: TemplateFields, lang: Lang): { title: string; body: string }`
  - `type SheetLine = { main: MazalPart[]; sub: string; blessing: string; icon: 'heart' | 'star' | null; cancelled: boolean }`
    (`MazalPart` from `src/schedule/sheetModel.ts`)
  - `buildSheetLine(m: Pick<Message, 'type' | 'title' | 'templateId' | 'fields' | 'targetName'>): SheetLine` (always
    Hebrew)
  - `dayLabel(iso: string, lang: Lang, form: 'long' | 'short'): string` (he long `'יום ג׳'`, short `'ג׳'`; en
    `'Tuesday'` / `'Tue'`), `shortDate(iso) → '3.11'`
  - `defaultBlessing(occasion: string, lang: Lang): string`
  - `fill(raw: string, params: Record<string, string>): string` (no isolates)
  - `withMemorial(name: string, lang: Lang): string` (he: appends ` ז״ל` unless the name already ends in ז״ל, ז"ל, ע״ה
    or ע"ה; en: unchanged)
- Built text (he shown; en in the same keys):
  - event title `{name}`; body line `tpl.event.bodyLine` = "{day}, {hdate} ({date}), בשעה {time} · {place} · {for}."
    (`{hdate}` = `hebrewDate(iso, 'he')` from `src/dates.ts`), then `tpl.event.organisersLine` "מארגנים: {names}",
    then `more`, each on its own line when present. Sheet: main = bold `{name}` + " · {dayShort} {time} · {place}";
    `cancelled` from `fields.cancelled`.
  - mazal title `tpl.mazal.title`. Body: `{phrase}` + (grandparents and `parents` ? ", " + `tpl.mazal.childOf.{m|f}`
    "בן ל{parents}" / "בת ל{parents}") + "." + (blessing ? " " + blessing). Here `{phrase}` =
    `tpl.mazal.phrase.<occasion>.<parents|grandparents>.<name|plain>`, and whose `other` uses the `parents` phrases.
    Sheet: main = "מזל טוב ל{firstNames} " + bold `{surname}` (no first names: "מזל טוב למשפחת " + bold surname);
    sub = phrase (+ childOf); blessing = blessing; icon `star` for bar/bat mitzvah, else `heart`.
  - condolence title `tpl.condolence.title` "משפחת {surname}". Body `tpl.condolence.bodyStart` "אנו משתתפים בצער
    משפחת {surname} במות {deceased}, {relation}." + variant: later `tpl.condolence.laterLine`; full
    `tpl.condolence.fullLine` "השבעה ב{address}, עד {until}. ניחום אבלים בשעות {hours}." (+ `tpl.condolence.prayersLine`
    "תפילות: {prayers}.") + always `tpl.condolence.closing`. Sheet: main = "משפחת " + bold `{surname}` + " · במות
    {deceased}"; sub: later `tpl.condolence.sheetLater` "פרטי השבעה בהמשך", full `tpl.condolence.sheetFull` "השבעה
    ב{address} עד {dayShort}"; icon null.
  - No template (free text): main = `mazalParts(title, targetName)`, sub `''`.
- Mazal phrases (he, `name` / `plain`). An English row follows each in en.json:

| occasion | parents | grandparents |
|---|---|---|
| birthSon | להולדת הבן {name} / להולדת הבן | להולדת הנכד {name} / להולדת הנכד |
| birthDaughter | להולדת הבת {name} / להולדת הבת | להולדת הנכדה {name} / להולדת הנכדה |
| barMitzvah | לבר המצווה של {name} / לבר המצווה | לבר המצווה של הנכד {name} / לבר המצווה של הנכד |
| batMitzvah | לבת המצווה של {name} / לבת המצווה | לבת המצווה של הנכדה {name} / לבת המצווה של הנכדה |
| engagement | לאירוסי {name} / לאירוסין | same as parents |
| wedding | לנישואי {name} / לנישואין | same as parents |
| other | ל{other} של {name} / ל{other} | same as parents |

  Name labels (`tpl.mazal.nameLabel.<occasion>`): שם התינוק, שם התינוקת, שם חתן בר המצווה, שם כלת בת המצווה, שם החתן
  או הכלה, שם החתן או הכלה, שם בעל/ת השמחה. These, and the Hebrew grammar of all phrases, need a native editor check
  (§19.10). Say so in the task report.
- Copy: add every §19.7 key (except `sheet.more`, which is `SHEET_TEXT.more` in Task 11) plus `tpl.event.bodyLine`,
  `.organisersLine`, `tpl.mazal.title` (exists in §19.7), `.phrase.*`, `.childOf.m/.f`, `.nameLabel.*`,
  `tpl.mazal.blessingDefault.{birth, barMitzvah, batMitzvah, couple}` (the §19.2 defaults), `tpl.condolence.title`,
  `.bodyStart`, `.fullLine`, `.prayersLine`, `.sheetLater`, `.sheetFull`, `msg.update.cancelEvent` (he "האירוע בוטל",
  en "The event is cancelled"), `msg.update.saved` (he "העדכון נשמר", en "Update saved"), `msg.update.savedQuiet` (he
  "העדכון נשמר. התראה על ההודעה הזו כבר נשלחה ב־12 השעות האחרונות, לכן לא נשלחה שוב.", en "Update saved. A
  notification for this message went out in the last 12 hours, so none was sent again."),
  `sheetItems.groupCondolence` (he "השתתפות בצער בגיליון", en "Condolences on the sheet").

- [ ] **Step 1: Write the failing tests** in `tests/templates.test.ts`:

```ts
test('event builds title, body and sheet line', () => {
  const f = { name: 'ערב לימוד לנשים', date: '2026-11-03', time: '20:30', place: 'בית הכנסת', for: 'women' };
  const m = buildMessage('event', f, 'he');
  assert.equal(m.title, 'ערב לימוד לנשים');
  assert.match(m.body, /^יום ג׳, .+ \(3\.11\), בשעה 20:30 · בית הכנסת · נשים\.$/);
  const line = buildSheetLine({ type: 'event', title: m.title, templateId: 'event', fields: f });
  assert.deepEqual(line.main, [{ text: 'ערב לימוד לנשים', bold: true }, { text: ' · ג׳ 20:30 · בית הכנסת', bold: false }]);
});
test('mazal tov for grandparents with parents', () => { /* sub === 'להולדת הנכדה נועה, בת לדוד ושרה' and main ends with bold surname */ });
test('condolence variants change only the shiva sentence', () => { /* only: no shiva text; later: laterLine; full: fullLine with until 'יום ב׳ (9.11)' -> body; all end with closing */ });
test('deceased gets ז״ל once', () => { assert.equal(withMemorial('יוסף ניסיון', 'he'), 'יוסף ניסיון ז״ל'); assert.equal(withMemorial('יוסף ניסיון ע״ה', 'he'), 'יוסף ניסיון ע״ה'); });
test('missing fields follow variant and occasion', () => {
  assert.deepEqual(missingFields('condolence', { variant: 'full', surname: 'ניסיון', deceased: 'יוסף', relation: 'אביו' }), ['address', 'hours', 'until']);
  assert.deepEqual(missingFields('mazal', { occasion: 'other', whose: 'parents', surname: 'דוגמה' }), ['occasionOther']);
});
test('built text has no bidi isolates', () => { /* no ⁨ or ⁩ in any buildMessage output */ });
test('schema keys match the server contract', () => { /* TEMPLATES keys per id equal the Task 1 table, in order */ });
test('free text line bolds the family name', () => { /* buildSheetLine({type:'celebration', title:'מזל טוב למשפחת דוגמה', targetName:'דוגמה'}) */ });
```

- [ ] **Step 2: Run** `node --test tests/templates.test.ts`. Expected: FAIL (`Cannot find module`).
- [ ] **Step 3: Implement** `templates.ts` (import `he.json` / `en.json` as `src/i18n/I18nProvider.tsx` does) and add the copy.
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`. Expected: PASS (`tests/i18n.test.ts` included).
- [ ] **Step 5: Commit** `git add src/client/templates.ts src/client/types.ts src/i18n/he.json src/i18n/en.json tests/templates.test.ts && git commit -m "Templates: field schemas, built message text and sheet lines, he/en copy"`

---

### Task 8: client — Compose with templates and live preview (P43 phones 1–4)

**Files:**
- Create: `src/views/compose/TemplateForm.tsx`, `src/views/compose/TemplatePreview.tsx`, `src/views/compose/DayPicker.tsx`
- Modify: `src/views/Compose.tsx`, `src/client/messageView.ts` (`postBody`), `src/kit/Icon.tsx` (add `tpl`, `pen`,
  `heart`, `star`, `eye`, `alert`, `upload`, `zoomin`, `zoomout`, `rotate`; copy the paths from the `<symbol>`s in
  `design/mockups/frames/P43.html`), `src/client/fixtures.ts`, `src/views/Main.tsx` (`fixtureNav`)
- Test: `tests/messageView.test.ts` (extend), `tests/composeTemplate.test.ts`

**Interfaces:**
- Consumes: Task 7.
- Produces:
  - `postBody(d: Draft, imageUploadId?, tpl?: { templateId: TemplateId; fields: TemplateFields }): PostMessageBody`
    adds both when given.
  - `src/client/composeState.ts` (new, pure): `copyToFree(state: { title; body; lastCopied: { title; body } | null },
    built: { title; body }): { title; body; lastCopied; copied: boolean }` (copies only when both free fields are empty
    or still equal `lastCopied`); `sheetCaption(role: Role, sheetMembers: 'approve' | 'auto' | undefined, type:
    MessageType): 'sheetAuto' | 'sheetPending' | null` (null for types not on the sheet).
  - `TemplateForm({ id, fields, onChange, errors, families, busy, refs })`: renders `TEMPLATES[id]`. Chips use
    `Chip size="filter"` in a wrapping `radiogroup` labelled by the field. Optional fields end with
    `compose.tpl.optional`. `family` renders the existing `PickList` block from Compose. `date` uses `DayPicker`
    (`Select` from `scheduleEditor/controls.tsx` over the next `days` days, labelled `dayLabel(...,'short') + ', ' +
    shortDate`). `time` uses `TimeField`. Error lines come from `compose.tpl.required` with `{field}` = the field's label.
  - `TemplatePreview({ message, sheetLine, caption })`: a `region` labelled "תצוגה מקדימה" (not a live region), with a
    dashed `k.line` border on `k.stone`, the label `compose.tpl.preview` with `eye`, the real `MessageRow` (`onPress`
    no-op), then for sheet types `compose.tpl.previewSheet` and the line in `PAPER` colours, and the caption. A missing
    required field shows as a gold dashed placeholder chip with the field's name (`ymiss`), never colour alone.
- Behaviour (§19.2): the `Segmented` `compose.tpl.mode` (`tpl` / `pen` icons) shows only when `templateOf(type)`. The
  default is template mode. Switching to free uses `copyToFree` and shows the info `Banner` `compose.tpl.copied`; going
  back keeps the fields. Publish in template mode: `missingFields` non-empty → mark each, focus the first (refs), and
  publish nothing. Otherwise `buildMessage` → `postBody(..., { templateId, fields })` with `surname` and `firstNames`
  taken from the picked `TargetFamily` (`name`, `firstNames.join(' ו')`). Free mode posts no fields. At ≥ 1024 wide the
  form is 560 wide and the preview is a sticky column beside it; on a phone it sits under the fields. The mazal tov
  blessing field starts as `defaultBlessing(occasion)` when the occasion changes and the blessing is untouched.
- Fixture screens (add to `FIXTURE_APP_SCREENS` and `fixtureNav`): `compose-tpl-event`, `compose-tpl-mazal`,
  `compose-tpl-condolence`, `compose-tpl-missing` (publish pressed with two fields empty), `compose-tpl-free` (after the
  switch). The fixture Kehila has `sheetMembers: 'approve'`.

- [ ] **Step 1: Write the failing tests:** `tests/composeTemplate.test.ts` covers `copyToFree` (empty → copies; edited
  → keeps; equal to `lastCopied` → re-copies) and `sheetCaption` (gabbai → `sheetAuto`; member + approve →
  `sheetPending`; member + auto → `sheetAuto`; `general` → null). `tests/messageView.test.ts` adds `postBody` with a
  template (both keys present) and without (neither key).
- [ ] **Step 2: Run** `node --test tests/composeTemplate.test.ts tests/messageView.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `composeState.ts`, `postBody`, the icons, then the three components and the Compose integration.
  Nothing else in Compose moves.
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Visual check** (Global Constraints). Screens: the five `compose-tpl-*` as `role=gabbai`, plus
  `compose-tpl-mazal` as `role=member`, which shows the pending caption. 390 he light and dark, and 1280 for
  `compose-tpl-event`. Compare with P43 phones 1–4 and the 1280 panel.
- [ ] **Step 6: Commit** `git add src/views/compose src/client/composeState.ts src/views/Compose.tsx src/client/messageView.ts src/kit/Icon.tsx src/client/fixtures.ts src/views/Main.tsx tests/composeTemplate.test.ts tests/messageView.test.ts && git commit -m "Compose: fill a template or write freely, live preview with the sheet line"`

---

### Task 9: client — updated messages in the feed and on the card

**Files:**
- Modify: `src/client/types.ts`, `src/client/endpoints.ts`, `src/client/store.ts`, `src/client/SessionProvider.tsx`,
  `src/client/feed.ts`, `src/client/messageView.ts`, `src/client/typesView.ts`, `src/views/MessageRow.tsx`,
  `src/views/MessageDetail.tsx`, `src/views/Messages.tsx` (day grouping), `src/notifications.ts`, `src/client/push.ts`,
  `src/client/fixtures.ts`, `src/views/Main.tsx`
- Test: `tests/feed.test.ts`, `tests/messageView.test.ts`, `tests/push.test.ts`

**Interfaces:**
- Consumes: Tasks 4–5 JSON; Task 7 types.
- Produces:
  - `Message` gains `updatedAt?: number; bumpId?: string; changed?: Partial<Record<'date' | 'time' | 'place', string>>;
    history?: Array<{ title: string; body: string; at: number }>`. `Kehila` gains `familyId?: string | null;
    sheetMembers?: 'approve' | 'auto'; logoInfo?: { name: string; at: number; bytes: number; side: number } | null`.
  - `UpdateMessageBody = { title: string; body?: string; fields: TemplateFields; notify: boolean }`;
    `endpoints.updateMessage(k, m, body) → r<Message & { notified: boolean }>('PUT', `${K(k)}/messages/${e(m)}`, body)`.
  - Store and SessionApi: `updateMessage(messageId: string, body: UpdateMessageBody): Promise<{ message: Message;
    notified: boolean }>`. It applies the answer as a `message` change, as `postMessage` does.
  - `messageView.ts`: `sortId(m: Message): string` (= `m.bumpId ?? m.messageId`); `groupByDay` groups by
    `messageDay(sortId(m))` (the meta time stays the posting time from `messageId`); `canUpdate(m: Message, me: string, k: Pick<Kehila, 'role' | 'familyId'>): boolean` (the Task 4 rule
    with `k.familyId === m.targetFamilyId` for condolences); `updatedMeta(m, t): string | null`. The last returns
    `msg.updated {time}` for a condolence and `msg.changed {time}` for an event; the time is HH:MM today, else `d.m`.
  - `updatedLine(m, t): string | null`: `msg.updatedLine` only for a condolence with `fields.variant === 'full'` and
    `updatedAt`. `{first}` comes from `ulidTime(messageId)`.
  - `eventChangeParts(m): Array<{ text: string; struck: boolean }> | null`, for an event with `changed`: e.g.
    `[{text: 'בשעה '}, {text: '20:30', struck: true}, {text: ' 21:00'}, ...]` for time, date and place in that order.
  - `feed.ts`: `byNewest` sorts by `sortId` (order holds ids; compare `sortId(messages[id])`). In `applyChanges`, a
    `message` change whose `bumpId` differs from the stored one sets `read: false` and re-sorts. `feedFromMessages`
    sorts by `sortId`.
  - Display: the meta line becomes `messageMeta(...) + ' · ' + updatedMeta` with "עודכן"/"שונה" bold (split the
    string, bold run). The card ends with `updatedLine` (`Txt caption muted` above a hairline). An event with `changed`
    shows the `eventChangeParts` line (struck runs `textDecorationLine: 'line-through'`, and an accessibility label
    "{old} ← {new}" because strikes are not read). A cancelled event shows `Tag` `msg.cancelled` on the card, in the
    row and in the detail.
  - Android: a second channel `quiet` (name "עדכונים שקטים", `importance: LOW`, no sound, no vibration) is created next to
    `community` in `src/notifications.ts` and in the push port (`setAndroidChannel`).
- Fixture data: one condolence updated to `full` with `updatedAt` and `bumpId`, and one event with `changed.time`, and one
  cancelled event. Screens `m3-shiva-updated` and `m3-event-changed`.

- [ ] **Step 1: Write the failing tests:**
  - `feed.test.ts` `bump moves an old message to the top and marks it unread`: feed `[M3, M2, M1]`, M1 read; apply
    `message` M1 with `bumpId: 'M9'` → order `[M1, M3, M2]`, `M1.read === false`; apply the same change again → no change
    (idempotent).
  - `feed.test.ts` `a non-bump update keeps order and read`.
  - `messageView.test.ts`: `canUpdate` (author, gabbai, family adult by `familyId`, other member false, event + family
    adult false, listener false); `eventChangeParts` for time+place; `updatedLine` only for a full condolence;
    `groupByDay` puts a bumped message under the bump's day.
  - `push.test.ts`: the port creates both `community` and `quiet` on Android.
- [ ] **Step 2: Run** `node --test tests/feed.test.ts tests/messageView.test.ts tests/push.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the interfaces, then the display changes in `MessageRow.tsx` and `MessageDetail.tsx`, and the
  fixture `updateMessage` (it answers the stored message with `updatedAt` now and `notified: true`).
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Visual check:** `messages` (the bumped message on top, unread dot), `m3-shiva-updated` and `m3-event-changed`,
  as `role=member`, 390 he light and dark, and 1280 for `m3-event-changed`. Compare with P43 phone 6 and the event panel.
- [ ] **Step 6: Commit** `git add src/client/types.ts src/client/endpoints.ts src/client/store.ts src/client/SessionProvider.tsx src/client/feed.ts src/client/messageView.ts src/client/typesView.ts src/views/MessageRow.tsx src/views/MessageDetail.tsx src/views/Messages.tsx src/notifications.ts src/client/push.ts src/client/fixtures.ts src/views/Main.tsx tests/feed.test.ts tests/messageView.test.ts tests/push.test.ts && git commit -m "Messages: updated and changed meta, struck old event values, cancelled tag, bumped messages on top and unread; quiet Android channel"`

---

### Task 10: client — shiva and event update screens (P43 phones 5–7, event panel)

**Files:**
- Modify: `src/views/MessageDetail.tsx` (update card), `src/views/Compose.tsx` (update mode),
  `src/client/composeState.ts`, `src/views/Main.tsx` (nav `update`), `src/client/fixtures.ts`
- Test: `tests/composeTemplate.test.ts` (extend)

**Interfaces:**
- Consumes: Task 9 `canUpdate`, `updateMessage`; Task 8 components.
- Produces:
  - `composeState.ts`: `initialUpdateFields(m: Message): TemplateFields` (the message's `fields`; for a free-text
    condolence `{ variant: 'full', surname: m.targetName ?? '' }`, for a free-text event `{ name: m.title }`; a
    condolence's variant is preset to `full`); `notifyDefault(before: TemplateFields, after: TemplateFields, id:
    TemplateId): boolean` (per the ruling).
  - `ComposeProps` gains `update?: { message: Message }`. In update mode there are no type cards, no channel row and no
    family picker (surname, deceased and relation stay editable text). Back reads `msg.update.back`, the title is
    `msg.update.shiva` or `msg.update.event`, then the template form, the preview, for an event `Toggle`
    `msg.update.cancelEvent` (sets `fields.cancelled`), `Toggle` `msg.update.notify` with `msg.update.notifyHelp`
    (`{surname}`; events show the push text shape `push.eventChanged`), and the primary `msg.update.save`. Save calls
    `updateMessage`. On success the screen goes back to the message and toasts `msg.update.saved`, or
    `msg.update.savedQuiet` when `notify` was on and `notified` is false. Error codes go through `useErrorText`
    (`not_updatable`, `forbidden`, `try_again` need entries in `errors.*` he/en).
  - Main: nav `{ tab: 'update'; id: string }`, full screen like `compose` (no tab bar). MessageDetail's card (only when
    `canUpdate`): a `Card` with `msg.update.only`. It holds a primary Button `msg.update.shiva` when the condolence
    variant is not `full`, a secondary one when it is, and a secondary `msg.update.event` for events.
- Fixture screens: `m3-shiva-card` (variant `later`, viewed by the author), `update-shiva`, `update-event`.

- [ ] **Step 1: Write the failing tests** for `initialUpdateFields` (templated, free-text condolence, free-text event)
  and `notifyDefault` (later → full true; full → full with a changed address false; event time change true; event
  `more` change false; cancel true).
- [ ] **Step 2: Run** `node --test tests/composeTemplate.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Visual check:** `m3-shiva-card`, `update-shiva` and `update-event` as `role=member` (the author), 390 he
  light and dark, and 1280 for `update-shiva`. Compare with P43 phones 5–7 and the event panel.
- [ ] **Step 6: Commit** `git add src/views/MessageDetail.tsx src/views/Compose.tsx src/client/composeState.ts src/views/Main.tsx src/client/fixtures.ts src/i18n/he.json src/i18n/en.json tests/composeTemplate.test.ts && git commit -m "Update shiva and event details in place: card on the message, update form, notify toggle"`

---

### Task 11: client — sheet items on the sheet model, fitting and data hook

**Files:**
- Create: `src/client/sheetItems.ts`, `src/client/useSheetItems.ts`
- Modify: `src/client/types.ts`, `src/client/endpoints.ts`, `src/schedule/sheetModel.ts`, `src/schedule/sheetSource.ts`,
  `src/client/fixtures.ts`
- Test: `tests/sheetItems.test.ts`, `tests/sheet.test.ts` (extend; keep every existing assertion passing or update it
  only where §19.3 changes it)

**Interfaces:**
- Consumes: Task 3 JSON; Task 7 `buildSheetLine`, `SheetLine`.
- Produces:
  - `types.ts`: `SheetGroup = 'mazal' | 'condolence' | 'events'`; `SheetItem = { itemId; week; group: SheetGroup; kind:
    'message' | 'free'; type: 'celebration' | 'condolence' | 'event' | 'notice'; state: 'in' | 'pending' | 'removed';
    source: 'auto' | 'approved' | 'byGabbai' | 'free' | 'member'; postedAt: number; line?: { text: string; bold:
    string }; message?: Message; wasPending?: boolean; postedBy?: string; approvedBy?: string }`;
    `SheetPage = { week: string; items: SheetItem[] }`.
  - `endpoints.ts`: `sheetItems(k, week) GET ${K(k)}/sheet/${week}`; `addSheetItem(k, week, body: { type; text; bold?;
    source? }) POST ${A(k)}/sheet/${week}/items`; `setSheetItem(k, week, itemId, body: { state?; line? }) PUT
    ${A(k)}/sheet/${week}/items/${itemId}`; `moveSheetItem(k, week, itemId, direction) POST .../move`.
  - `sheetItems.ts`: `lineOf(item: SheetItem): SheetLine` (override `line` → `{ main: mazalParts(first line, bold), sub:
    second line, blessing: '', icon by type }`, else `buildSheetLine(item.message)`); `inItems(page): SheetItem[]`
    (state `in`, in page order); `homeRows(items, max = 5): { rows: SheetItem[]; more: number }` (mazal, then
    condolence, then events).
  - `sheetModel.ts`: `SheetLineItem = { id: string; group: SheetGroup; main: MazalPart[]; sub: string; blessing:
    string; icon: 'heart' | 'star' | null; cancelled: boolean }`. `SheetModel.mazalTov: SheetLineItem[]` (mazal, then
    condolence) replaces `MazalTovItem[]`; new `SheetModel.events: SheetLineItem[]`; `SheetInput.celebrations` is
    replaced by `items: SheetLineItem[]`. `weekCelebrations` is deleted, along with its "posted Sunday..." rule.
    `SHEET_TEXT.more = 'ועוד {n} ברכות באפליקציה'`. `MAX_MAZAL = 6`, `MAX_EVENTS = 3`. The square variant: the band
    `squareBand(items): string` = "מזל טוב: " + up to 4 "משפחת {bold}" joined " · " + (rest ? " · … ועוד {rest}" : ''),
    and no events.
  - `SheetFit` gains `dropBlessings: boolean`, `droppedEvents: number`, `out: string[]` (ids left off: over max, then
    dropped) and `more: number` (= `out.length`). `fitSheet` order: items beyond `MAX_*` are out from the start →
    base → `dropBlessings` → the existing §14.5 steps → drop the picture → drop mazal (with condolence) from the end →
    drop events from the end → shrink. `neededHeight` accounts for the events lines in the start cell (under the
    picture, or heading the cell without one), the sub and blessing lines, and the `more` line (9.5).
  - `sheetSource.ts`: `buildSheet(doc, computed, source: { kehilaName; logoUri; items: SheetItem[]; pinned? }, variant)`
    maps `inItems` through `lineOf`.
  - `useSheetItems(week: string | null): { page: SheetPage | null; status: 'loading' | 'ready' | 'error'; reload():
    Promise<void>; setPage(p: SheetPage): void }`, with the fixture API answering it.

- [ ] **Step 1: Write the failing tests:**
  - `sheetItems.test.ts`: `lineOf` override keeps the bold surname; `lineOf` without override uses the template; `homeRows`
    orders mazal, condolence, events and caps at 5 with `more`.
  - `sheet.test.ts` `blessings are dropped before anything else`: 6 mazal with blessings that do not fit at base →
    `fit.dropBlessings === true`, `fit.out` empty.
  - `sheet.test.ts` `over the max is out and counted`: 8 mazal, 4 events → `out` holds the last 2 mazal ids and the last
    event id, `more === 3`.
  - `sheet.test.ts` `events head the start cell without a picture; mazal spans both columns without events or picture`
    (model placement flags).
  - `sheet.test.ts` `square band lists four families and the rest`.
  - `sheet.test.ts` `a cancelled event keeps its line and is flagged`.
- [ ] **Step 2: Run** `node --test tests/sheetItems.test.ts tests/sheet.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Keep `fitSheet` pure. Leave renderers on the old fields until Task 12, but they must still
  compile: map them minimally to the new names in this task.
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `git add src/client/sheetItems.ts src/client/useSheetItems.ts src/client/types.ts src/client/endpoints.ts src/schedule/sheetModel.ts src/schedule/sheetSource.ts src/schedule/Sheet.tsx src/schedule/sheetHtml.ts src/client/fixtures.ts tests/sheetItems.test.ts tests/sheet.test.ts && git commit -m "Sheet: items from the server list, events and condolences, max 6/3, blessings dropped first, 'ועוד n' line"`

---

### Task 12: client — sheet renderers, print and PDF from the item list, logo on a white tile

**Files:**
- Modify: `src/schedule/Sheet.tsx`, `src/schedule/sheetHtml.ts`, `src/views/SchedulePrint.tsx`,
  `src/views/admin/ScheduleEditor.tsx` (PDF uses items), `src/client/fixtures.ts`
- Test: `tests/sheet.test.ts` (extend: `sheetHtml` output)

**Interfaces:**
- Consumes: Task 11 model, fit and hook.
- Produces: both renderers draw the bottom cells per §19.3 "How the sheet shows them". The start cell holds the pinned
  picture, then the events as tekhelet-bold lines with `PAPER.tek`; a cancelled event shows the word "בוטל" after the
  line, never a strike alone. The end cell holds mazal tov lines with the `heart`/`star` icon (main with the bold
  surname in 800 `PAPER.pom`, sub on its own line, blessing when `!fit.dropBlessings`), then condolence lines, then
  the `SHEET_TEXT.more` line (9.5, `PAPER.mute`) when `fit.more > 0`. With no events and no picture, mazal tov spans
  both columns. The square shows `squareBand`. The logo tile in the header becomes white with a 2 px inset (`contain`)
  and a `PAPER.line` hairline, in both renderers. `SchedulePrint` and the editor's PDF build from
  `useSheetItems(computed.week.friday)` instead of `session.feed.messages`. The print waits for the items as it waits
  for fonts and logo, and the old "Limit:" comment goes.
- Fixture screen `print-items` (the print page with 4 mazal tov, one condolence, 2 events with one cancelled, a picture,
  and `?logo=1`), plus `print-items-many` (8 mazal, 4 events).

- [ ] **Step 1: Write the failing tests:** `sheetHtml(model)` for `print-items` contains `<b>` around each surname, the
  events in the start cell (before the mazal cell in document order), "בוטל" once, the logo `img` inside an element
  with `background:#fff` and `padding:2px`. For `print-items-many` it contains "ועוד 3 ברכות באפליקציה".
- [ ] **Step 2: Run** `node --test tests/sheet.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** both renderers alike (the PDF and the web print must match).
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Visual check:** `print-items` and `print-items-many` with `noprint=1`. Shoot at 1280 only (the paper never goes
  dark; check one dark-mode shot to confirm the paper stays light), plus the square `variant=square`. Compare with the
  P44 A4 panel: the A4 bottom does not run into the footer, and no line is clipped.
- [ ] **Step 6: Commit** `git add src/schedule/Sheet.tsx src/schedule/sheetHtml.ts src/views/SchedulePrint.tsx src/views/admin/ScheduleEditor.tsx src/client/fixtures.ts tests/sheet.test.ts && git commit -m "Sheet print and PDF: events, condolences and the 'ועוד' line from the item list; logo on a white tile"`

---

### Task 13: client — pending count in the waiting store, management wiring, Toast with undo

**Files:**
- Modify: `src/client/waitingStore.ts`, `src/views/useWaiting.ts`, `src/client/adminAreas.ts`,
  `src/views/admin/Overview.tsx`, `src/views/admin/Sidebar.tsx`, `src/views/Main.tsx`, `src/kit/components.tsx`
  (`Toast`), `src/i18n/he.json`, `src/i18n/en.json`
- Test: `tests/adminAreas.test.ts` (extend), `tests/waitingStore.test.ts` (new)

**Interfaces:**
- Consumes: Task 11 `sheetItems` endpoint; `scheduleWeekOf` and `addDays` from `src/schedule/week.ts`; `israelDate`.
- Produces:
  - `WaitingCounts` gains `sheetPending: number` and `sheetPendingWeek: string | null`. The store's equality check and the
    reset in `refresh` include them. New `setSheetPending(n: number, week: string | null)`.
  - `useWaiting.load` fetches `api.sheetItems` for the current and the next sheet week (`scheduleWeekOf(today).friday`
    and +7). It counts `state === 'pending'`, and `sheetPendingWeek` is the first week that has any. A failed fetch keeps
    the previous numbers (the existing pattern). `useWaiting()` returns `sheetPending` and `setSheetPending`.
  - `adminAreas.ts`: `AreaTarget` gains `'sheetItems'`; `BadgeKind` gains `'sheetPending'`; the prayers row `sheet`
    gets `target: 'sheetItems', badge: 'sheetPending'`; `Waiting` gains `sheetPending`; `TodoId` gains `'sheet'` with
    target `'sheetItems'`, placed after `requests`.
  - Overview: the todo row title `admin.todo.sheet` `{n}`; caption `admin.todo.sheetCaption` with `{types}` (a
    `compose.types.*` list of the pending groups, or "מזל טוב" alone when unknown) and `{parasha}` from
    `parashaOf(shabbat, lang)`. The sidebar's prayers row shows the same badge.
  - Main nav `{ tab: 'sheetItems'; focus?: 'pending'; week?: string }`, which renders the Task 14 screen. The todo row
    opens it with `focus: 'pending'` and `sheetPendingWeek`.
  - `Toast({ text, visible, action? })`: with `action: { title, onPress }`, the bubble is touchable (container
    `pointerEvents="box-none"`, 48-high text button). `Main.showToast(text, action?)` keeps it 6 s when there is an action.

- [ ] **Step 1: Write the failing tests:**
  - `waitingStore.test.ts`: `refresh` resets `sheetPending` on a Kehila switch; `setSheetPending` notifies listeners
    once; equal numbers do not notify.
  - `adminAreas.test.ts`: the prayers row `sheet` targets `sheetItems` with badge `sheetPending`; `todoItems` puts `sheet`
    after `requests` only when `sheetPending > 0`; `allowedTargets('gabbai')` has `sheetItems`; the existing
    reachability test still passes.
- [ ] **Step 2: Run** `node --test tests/waitingStore.test.ts tests/adminAreas.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Until Task 14, the screen placeholder is the existing `ScheduleEditor` target (so this commit
  ships working navigation).
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `git add src/client/waitingStore.ts src/views/useWaiting.ts src/client/adminAreas.ts src/views/admin/Overview.tsx src/views/admin/Sidebar.tsx src/views/Main.tsx src/kit/components.tsx src/i18n/he.json src/i18n/en.json tests/waitingStore.test.ts tests/adminAreas.test.ts && git commit -m "Management: sheet items waiting for approval in the shared waiting store, todo row and badges; Toast with undo"`

---

### Task 14: client — "הגיליון השבועי" management screen (P44 phones 1–3, 1280 panel)

**Files:**
- Create: `src/views/admin/SheetItems.tsx`, `src/views/admin/sheetItems/FitCard.tsx`,
  `src/views/admin/sheetItems/SheetItemRow.tsx`, `src/views/admin/sheetItems/ItemSheet.tsx`,
  `src/views/admin/sheetItems/FreeItemSheet.tsx`, `src/views/admin/sheetItems/RulesSheet.tsx`
- Modify: `src/client/sheetItems.ts` (pure helpers), `src/views/Main.tsx`, `src/views/admin/ScheduleEditor.tsx` (link
  to the screen), `src/client/fixtures.ts`, `src/i18n/he.json`, `src/i18n/en.json`
- Test: `tests/sheetItems.test.ts` (extend)

**Interfaces:**
- Consumes: Tasks 11–13.
- Produces (pure, `sheetItems.ts`):
  - `meters(model: SheetModel, fit: SheetFit): { mazal: { n: number; max: 6 }; events: { n: number; max: 3 }; image:
    boolean; fits: boolean; over: number }`
  - `groupsForScreen(page: SheetPage, fit: SheetFit): { pending: SheetItem[]; mazal: Row[]; condolence: Row[]; events:
    Row[]; removed: Record<SheetGroup, SheetItem[]> }` with `Row = { item: SheetItem; out: boolean; index: number;
    count: number }`
  - `sourceTag(item, t): { label: string; tone: 'olive' | 'tekhelet' | 'gold' | 'plain' }` (`sheetItems.src.*`;
    `approved` adds the approver's name)
  - `editLine(item: SheetItem, text: string): { text: string; bold: string }` (keeps the bold token separate)
- Screen behaviour (§19.3, P44): back `admin.area.prayers`, title `sheetItems.title`, caption `sheetItems.caption`. A
  week toggle (current and next, as the editor's `WeekPicker`) defaults to `nav.week`. Then:
  - `FitCard` is a polite live region: the olive check `sheetItems.fits`, or the gold alert `sheetItems.over`. The link
    `sheetItems.preview` opens `openPrintPage` on web or `sharePdf` on a phone. The three meters carry numbers.
  - The pending group (pomegranate edge, `CountBadge`, only when non-empty): rows with the type icon, the line, Tag
    "ממתין" and `sheetItems.src.postedBy` + relative time, and 40-high buttons `sheetItems.add` (primary) and
    `sheetItems.skip`. Each sets state optimistically, refreshes `waitingStore.setSheetPending`, and toasts
    `sheetItems.added` or `.skipped` with `sheetItems.undo`, which sets `pending` again. The accessibility label is
    "להוסיף לגיליון: {line}".
  - Groups `sheetItems.groupMazal`, `sheetItems.groupCondolence` and `sheetItems.groupEvents` · {n}: one `SheetItemRow`
    per item, holding the line, source Tag, and a 44 `more` inside a 56 row. A row past the max or dropped by the fit
    shows the gold dashed "לא נכנס" Tag with hatching, the word, and its own colour. The row's label is "{line}.
    {source}. פריט {i} מתוך {n}". The collapsed `sheetItems.removed` line at the end of each group puts an item back
    with state `in`.
  - The reserved row `sheetItems.groupImage` shows the model's picture state (no target).
  - The dashed button `+ sheetItems.addFree` opens `FreeItemSheet`: a Segmented of mazal tov, event and notice;
    `sheetItems.freeSurname` (mazal only); `sheetItems.freeText`; the paper-colour preview; `sheetItems.freeNote`;
    `sheetItems.addBtn`.
  - `ItemSheet`: `sheetItems.item.line` (multi-line `Field`, with the surname shown as a bold token next to it),
    `.lineHelp`, the preview, `.up` and `.down` action rows (`moveSheetItem`, then announce "הועבר למקום {i} מתוך {n}"),
    `.open` (hidden for free items; opens the message detail), the danger `.remove` (no confirm; Toast with undo), and
    "שמירה".
  - `RulesSheet`: `sheetItems.rule.members` with two `Choice` rows `.approve` / `.auto` and their notes. Each saves on
    tap through `putSettings({ sheetMembers })` (extend the endpoint type), then `refreshKehila()`.
  - At ≥ 1024: the lists on the start side, and on the end side a live A4 `Sheet` at 80% scale built from the same
    page, redrawn after every action.
  - `nav.focus === 'pending'` scrolls to the pending group. ScheduleEditor gets a link row "הגיליון השבועי ‹" to this
    screen (§19.8).
- Fixture screens: `sheet-items` (2 pending, 4 mazal of which one is out, 1 condolence, 2 events), `sheet-items-sheet`
  (ItemSheet open), `sheet-items-free`, `sheet-items-rules`.

- [ ] **Step 1: Write the failing tests** for `meters`, `groupsForScreen` (out flags from `fit.out`; removed bucketed by
  group; index and count per group), `sourceTag` and `editLine`.
- [ ] **Step 2: Run** `node --test tests/sheetItems.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the helpers, then the screen and its parts. Replace the Task 13 placeholder in `Main.tsx`.
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Visual check:** the four `sheet-items*` screens as `role=gabbai`, 390 he light and dark, and `sheet-items` at
  1280 (sidebar, lists, live A4). Compare with P44 phones 1–3 and panel 5: meters readable in dark mode, and "לא
  נכנס" readable without colour.
- [ ] **Step 6: Commit** `git add src/views/admin/SheetItems.tsx src/views/admin/sheetItems src/client/sheetItems.ts src/client/endpoints.ts src/views/Main.tsx src/views/admin/ScheduleEditor.tsx src/client/fixtures.ts src/i18n/he.json src/i18n/en.json tests/sheetItems.test.ts && git commit -m "Management: the weekly sheet screen (fit meters, approve/reject, edit line, reorder, free items, members' rule)"`

---

### Task 15: client — Home "השבוע בקהילה" and simchas to the sheet

**Files:**
- Create: `src/views/WeekCard.tsx`
- Modify: `src/views/Home.tsx`, `src/views/admin/Simchas.tsx`, `src/client/simchasView.ts`, `src/client/fixtures.ts`
- Test: `tests/sheetItems.test.ts`, `tests/simchasView.test.ts` (extend)

**Interfaces:**
- Consumes: Task 11 `homeRows`, `lineOf`, `useSheetItems`; Task 3 `addSheetItem` with `source: 'byGabbai'`.
- Produces:
  - `WeekCard`: a `Card` under the schedule card and before the zmanim card, with overline `home.week.title`
    `{parasha}`. It shows `homeRows(inItems(page))` (message rows are buttons to the detail; free rows are plain text),
    then `home.week.more` `{n}` and the link `home.week.print` (web `openPrintPage(0)`, phone `sharePdf`). It is hidden
    when empty and when the fetch fails. It uses the current schedule week. Pending items never show (the server already
    filters them for non-gabbaim; filter again with `inItems` for gabbaim).
  - `simchasView.ts`: `sheetItemsFor(week: SimchaWeek): Array<{ type: 'celebration'; text: string; bold: string;
    source: 'byGabbai' }>` with text `tpl.mazal.phrase.<barMitzvah|batMitzvah>.parents.name` filled with the first name,
    and bold = the surname. The sheet week is the Friday before `week.shabbat`.
  - Simchas: a secondary Button `simchas.toSheet` per week with items, which posts each item (no separate confirm,
    §19.8) and toasts the existing `simchas.toSheetNote` or an error.
- Fixture screens: `home-week` (member) and `home-week-guest` (listener, Kehila hiding mazal tov: events only).

- [ ] **Step 1: Write the failing tests:** `homeRows` with 7 items → 5 rows and `more: 2`; `sheetItemsFor` for a week with a
  bar and a bat mitzvah → two items with the right phrases and bold surnames.
- [ ] **Step 2: Run** `node --test tests/sheetItems.test.ts tests/simchasView.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Visual check:** `home-week` and `home-week-guest`, and `simchas` as gabbai, at 390 he light and dark. Shoot
  `home-week` at 1280. Compare with P44 phone 4.
- [ ] **Step 6: Commit** `git add src/views/WeekCard.tsx src/views/Home.tsx src/views/admin/Simchas.tsx src/client/simchasView.ts src/client/fixtures.ts tests/sheetItems.test.ts tests/simchasView.test.ts && git commit -m "Home: this week in the community card; upcoming simchas go to the sheet as gabbai items"`

---

### Task 16: client — LogoTile everywhere, logo encode pipeline, logo API

**Files:**
- Create: `src/kit/LogoTile.tsx`, `src/media/logo.ts`, `src/media/logoDevice.ts`
- Modify: `src/views/TopBar.tsx` (`KehilaLogo` renders `LogoTile`), `src/views/KehilaMenu.tsx` (if it draws its own
  tile), `src/client/endpoints.ts`, `src/client/errors.ts` (if codes are listed there), `src/i18n/he.json`, `src/i18n/en.json`
- Test: `tests/logo.test.ts`

**Interfaces:**
- Consumes: Task 6 routes and codes.
- Produces:
  - `LogoTile({ uri, letter, size, label })`: with `uri`, the image sits on a `#FFFFFF` rounded tile (`size / 4`
    radius, `contain`, 2 px inset, `k.line` 1 px hairline), in dark mode too. Without `uri`, it shows the existing
    tekhelet letter tile. The image's accessibility label is `logo {kehila}` ("לוגו {kehila}"; add `logo.label`).
  - `endpoints.ts`: `putLogo(k, data: string) → r<{ logoVersion: string }>('PUT', `${A(k)}/logo`, { data })`;
    `deleteLogo(k) → r<void>('DELETE', `${A(k)}/logo`)`.
  - `logo.ts` (pure): `type CropView = { scale: number; x: number; y: number; rotation: 0 | 90 | 180 | 270 }`;
    `cropRect(view: CropView, image: { width; height }, frame: number): { originX; originY; width; height }` (a square in
    source pixels after rotation, clamped inside the image); `targetSides(side: number): number[]` (`[512, 384, 256]`
    filtered to `≤ side`, or `[side]` when `side < 256`; never up-scales); `type LogoDeps = { render(uri, rotation, rect,
    side): Promise<{ base64: string; bytes: number }>; posterize?: (base64: string) => Promise<{ base64; bytes }> }`;
    `encodeLogo(uri, view, image, frame, deps): Promise<{ base64: string; side: number; bytes: number }>`, throwing
    `LogoEncodeError('small' | 'big')`. `small` means a crop side under 64. `big` means still over 65,536 bytes after
    every side and, when given, `posterize`. `MAX_INPUT_BYTES = 10 * 1024 * 1024`.
  - `logoErrorKey(e: unknown): 'logo.err.format' | 'logo.err.small' | 'logo.err.big' | 'logo.err.save'`: server
    `invalid_logo_format` → format; `logo_too_small` → small; `logo_too_large` → big; `LogoEncodeError` likewise;
    anything else → save.
  - `logoDevice.ts`: `render` on `ImageManipulator.manipulate(uri).rotate().crop().resize()` → `saveAsync({ format:
    SaveFormat.PNG, base64: true })`; on web only, `posterize` (canvas `getImageData`, each channel rounded to 32
    levels, re-encoded as PNG).

- [ ] **Step 1: Write the failing tests** in `tests/logo.test.ts`: `cropRect` (no zoom centred, zoom 2 with an offset,
  90° rotation swaps axes, clamping); `targetSides(1000)` → `[512, 384, 256]`, `targetSides(300)` → `[256]`,
  `targetSides(200)` → `[200]`; `encodeLogo` returns the first side under the limit, uses `posterize` only after 256,
  throws `big` without it, throws `small` for a 50 px crop; `logoErrorKey` mappings.
- [ ] **Step 2: Run** `node --test tests/logo.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, and switch `KehilaLogo` and every other ad-hoc logo image to `LogoTile` (`grep -rn "logo(" src/views`).
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Visual check:** `home` as gabbai with `logo=1` and without, at 390 he light and dark. The top bar logo sits on
  a white tile in dark mode.
- [ ] **Step 6: Commit** `git add src/kit/LogoTile.tsx src/media/logo.ts src/media/logoDevice.ts src/views/TopBar.tsx src/views/KehilaMenu.tsx src/client/endpoints.ts src/i18n/he.json src/i18n/en.json tests/logo.test.ts && git commit -m "Logo: white tile everywhere, crop and PNG size loop, upload and remove endpoints"`
  (add `src/client/errors.ts` only if changed).

---

### Task 17: client — "לוגו הקהילה" row, sheet and cropper (P45)

**Files:**
- Create: `src/views/admin/logo/LogoSheet.tsx`, `src/views/admin/logo/LogoCropper.tsx`
- Modify: `src/client/adminAreas.ts` (settings row `logo` first, target `'sheet:logo'`), `src/views/admin/Overview.tsx`,
  `src/client/fixtures.ts`, `src/views/Main.tsx` (fixture screens), `src/i18n/he.json`, `src/i18n/en.json`
- Test: `tests/adminAreas.test.ts` (extend)

**Interfaces:**
- Consumes: Task 16.
- Produces:
  - The settings group gets a first row `logo` (72 high) with `LogoTile` at 40 as its icon. Its status is
    `logo.rowSet` `{date}` from `kehila.logoInfo.at`, or gold `logo.rowNone` `{letter}`. It opens a `Sheet` on a phone and
    a side panel at ≥ 1024.
  - `LogoSheet`: the current logo at 112 with "{side}×{side} · {KB}KB" and `logo.meta`. `logo.where` shows four
    true-size previews (top bar light and dark at 32, sheet header at 66 on paper, Kehila menu at 44, invite at 44).
    Then the rules box `logo.rules`, and the footer: primary `logo.replace` (or `logo.upload`), and the danger text
    `logo.remove` with an inline confirm `Banner` `logo.removeConfirm` `{letter}` with "הסרה" / "ביטול". Without a logo
    it shows the letter tile at 96 and `logo.none`. Errors go into an error `Banner` through `logoErrorKey`, and the
    previous logo stays.
  - Source: on a phone, `pickImage('gallery')` (`logo.source.photos`; see the ruling for files). On web, a file input
    (`accept="image/png,image/jpeg"`) and a drop zone (`logo.source.drop`). The type and the 10 MB limit are checked
    before cropping (`logo.err.format`).
  - `LogoCropper`: full screen on a dark backdrop. A 310 square frame with a thirds grid over a checkerboard; drag to
    move, pinch to zoom (`react-native-gesture-handler`); a zoom slider (`accessibilityRole="adjustable"`, `−`/`+` at
    44); `rotate` 90°; live previews at 32, 44 and 66 on white tiles (`aria-hidden`); `logo.crop.note` `{size}`;
    "ביטול" / "שמירה". Web keys: arrows 1 px (Shift 10), `+`/`−`, `R`, Enter, Esc. The crop area label is
    `logo.crop.area`. Save → `encodeLogo` → `putLogo` with the button busy (`logo.saving`) → `refreshKehila()` →
    Toast `logo.saved`. Remove → `deleteLogo` → `refreshKehila()`.
- Fixture screens: `logo` (with a logo), `logo-none`, `logo-crop`, `logo-error`.

- [ ] **Step 1: Write the failing test:** `areas('gabbai')` settings rows start with `{ id: 'logo', target: 'sheet:logo' }`,
  and the reachability test covers it.
- [ ] **Step 2: Run** `node --test tests/adminAreas.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Visual check:** `area-settings`, `logo`, `logo-none`, `logo-crop` and `logo-error` as gabbai, 390 he light
  and dark; `logo` at 1280 (side panel). Compare with P45 phones 1–3 and the 1280 panel.
- [ ] **Step 6: Commit** `git add src/views/admin/logo src/client/adminAreas.ts src/views/admin/Overview.tsx src/client/fixtures.ts src/views/Main.tsx src/i18n/he.json src/i18n/en.json tests/adminAreas.test.ts && git commit -m "Management: Kehila logo row, sheet with previews, crop to square, upload and remove"`

---

### Task 18: deploy to dev (controller; the owner runs `terraform apply`)

Run by the controller, not a subagent. No new infrastructure: the API is `ANY /v1/{proxy+}`, so new routes need only new
Lambda code, and the push worker shares the zip.

- [ ] **Step 1: Run everything:** `npm test`, `npm run typecheck`, `npm run test:server`. Expected: all green, and the counts
  are reported.
- [ ] **Step 2: Run the final whole-branch review** (Opus) against §19 and this plan's Review Focus; fix and re-run Step 1.
- [ ] **Step 3: Build:** `python3 tools/build_lambda.py`, then `cd infra/envs/dev && terraform plan -out dev.tfplan`. Read the
  plan: only the Lambda code hashes of api, push and jobs may change. Anything else, stop and report.
- [ ] **Step 4: Hand off:** give the owner `! cd ~/work/kehilot/infra/envs/dev && terraform apply dev.tfplan` and wait.
- [ ] **Step 5: After the apply:** run `.venv/bin/python tools/smoke_dev.py` and expect all PASS, including the Task 6
  checks. Then run `npm run deploy:web`, and
  `AWS_DEFAULT_REGION=il-central-1 .venv/bin/python tools/seed_dev_messages.py --env dev --kehila <dev Neria id> --templates`
  (dry run, then `--apply`).
- [ ] **Step 6: Report** to the owner: what was deployed, the smoke result, what to try on the phone (template compose, shiva
  update with the quiet push, sheet approval, logo upload), and what was not checked (real devices, iOS `passive`
  delivery, Android `quiet` channel, the Hebrew grammar of built phrases, real logos through the size loop). No
  `git push` without the owner.
