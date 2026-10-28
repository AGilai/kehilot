# Private replies to Kehila messages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Any member-written Kehila message (הודעה, אירוע), and any mazal tov or condolence, can be answered privately,
once per person. The reply can be edited and deleted. It reaches the author, the named family, or one chosen adult of
that family. Everyone sees the count, and each recipient gets a mailbox under Me with unread markers, a Me-tab badge and
throttled pushes that carry no names.

**Architecture:** The existing blessing storage (`R#` replies and `RP#` distinct-replier markers under
`K#<k>#MSG#<m>`, `replierCount` on the message) becomes the one mechanism. Replies gain a recipient field `to`. A new
module `server/cloud/private_replies.py` decides who may reply and who may read. It also adds the viewer's fields to
every message JSON, builds the mailbox, and drops replies on leave and on account deletion. Two kinds of small items
are added. A thread-index item (`K#<k>#RX` / `MSG#<m>`) per answered message lets the mailbox avoid a table scan.
Per-person read watermarks and push-throttle items (`K#<k>#U#<user>` / `RXSEEN#<m>`, `RXPUSH#<m>`) are purged with the
user. On the client, a pure `src/client/replyView.ts` holds every label and rule. Reply text lives in memory only. New
views are the card's reply row, the long-press actions Sheet, the reply Sheet, the M3 box, and the mailbox under Me.

**Tech Stack:** Expo / React Native + web (`src/`, `node --test`, `tsc`), Python 3 Lambda (`server/cloud/`, DynamoDB
single table, moto tests), Expo push via the SQS worker (`server/cloud/push_worker.py`).

**Spec:** `docs/UX-DESIGN.md` §22 (22.1–22.10; commits 7305572, 1b10927, 9b1a47f), frame P48
(`private-replies.html`), including §22.4a (the whole family or one adult) and the CTO list in §22.9. It replaces the M3
"ברכה אישית למשפחה" of §5 / §6 flow 3. Also read §12.1 (type register), §18.4 (Me), §20 (management = gabbai + tech).

## Global Constraints

- **Roles:** every server decision uses a named set from `server/cloud/authz.py`: `authz.MANAGEMENT` (gabbai + tech),
  `authz.ADULTS`, `authz.ALL`, `authz.LISTENER_ONLY`. No role literal anywhere outside `authz.py`
  (`server/tests/cloud/test_authz_sets.py` AST guards must stay green). On the client, use `isManagement` / `isAdult`
  from `src/client/roles.ts`. If `server/tests/cloud/test_tech_inventory.py` exists when a route is added, add its row.
- **Owner rules, verbatim (§22):** "Messages written by management (gabbai or tech) get no private-reply button and no
  count" for הודעה and אירוע. *CTO ruling, owner to confirm:* "a mazal tov or condolence posted by management still
  takes blessings". Build it that way. Routing: mazal tov and condolence go to the named family or one chosen adult.
  Every other type goes to the author only. "A reply sent to one adult is seen only by that adult: not by the spouse,
  the rest of the family or the gabbaim."
- **Which messages (§22.1), as one server rule** `private_replies.reply_route(message, channel)`:
  - The channel is whole-Kehila: no `groups` and not `conversation`. Ruling: legacy `simchas` / `condolences`
    channels without groups count as whole-Kehila.
  - The message is not `removed`.
  - `general` and `event` return `'author'` when `authorKind == 'member'`.
  - `celebration` and `condolence` return `'family'` when `targetMemberId` is set. Ruling: one without a target has no
    route.
  - `weekly`, `chat` and everything else return `None`.
  - There are no server-side system messages. Welcome and test-build cards exist only on the client and carry no
    `replyTo`.
- **Limits:** one reply per person per message. Body 1–1000 code points (`REPLY_MAX`, after strip). Edit and delete
  are allowed at any time, by the writer only. The recipient is fixed once sent.
- **Who reads a reply** (`visibility.reply_visible`): the writer always. Then, by `to`:
  - `to == 'author'`: the message's author.
  - `to == 'family'`, or `to` missing (legacy): the target family's current live adults (`families.target_adults`).
  - `to == <userId>`: that user only.
  
  Gabbaim and tech get no exception, anywhere: app, management, export, push or feed.
- **Counts:** `replierCount` (distinct repliers, `RP#` markers) is public to everyone who can see the message. It
  counts family and personal replies alike and is never broken down.
- **Privacy in transport:** reply text and names never enter SQS jobs, logs, push bodies or the on-device search cache.
  Logs carry ids and counts only. Push title is the Kehila name, body one of the fixed texts in §22.7, data
  `{kehila, messageId}`.
- **Invented names only** in code, tests, fixtures and docs. Use the spec's (רותם אלמוג, שולמית ברקן, יגאל ברקן, אלון
  שדמי) or the fixtures' (דנה בדיוני, רון לדוגמה). Never a real congregant.
- **Dates:** reply times follow §2: "היום, 09:58", "אתמול, 22:03", otherwise the Hebrew date first with the Gregorian
  in brackets ("יום ב׳, ט״ו בחשוון (26.10)", `displayDate` in `src/dates.ts`). API times are Unix seconds.
- **i18n:** every key of §22.7 goes into both `src/i18n/he.json` and `src/i18n/en.json`, verbatim. `tests/i18n.test.ts`
  enforces parity. Renamed keys move. Removed keys (`chip.celebration`, `chip.condolence`, `detail.notAllowed`,
  `admin.pushTexts.key.reply`) go. "ברכה פרטית" becomes "ברכה אישית" everywhere.
- **Visual check (every UI task):** one headless Chromium at a time, with nothing else heavy running.
  1. Run `npm run web:fixtures` with `run_in_background` (port 8081). Never use port 3000, which is the live
     Flow-Mapper.
  2. `cd /home/ubuntu/tools/qa-browser && node act.mjs '<url>' <out>-he-light.png 390 844`. Then run the same command
     with a final `dark` step for `<out>-he-dark.png`. Then `node shoot.mjs '<url>' <out>-1280.png --width 1280
     --height 900`. URLs are `http://localhost:8081/?role=<role>&lang=he&screen=<fixture screen>`. PNGs go to
     `/tmp/claude-1000/kehilot-shots-replies/`.
  3. Read each PNG and compare it with the named P48 phone (`design/mockups/frames/private-replies.html`). Check: no
     horizontal scroll at 390, nothing clipped, dark mode readable, the condolence count in ash and never in
     pomegranate.
  4. Stop the server: `ps -eo pid,args | grep '[e]xpo start --web --port 8081'`, then `kill <that pid>`. Never use
     `pkill -f`.
  5. Report what was checked and what was not (devices, screen readers, the long-press gesture, English).
- **Coordination with `docs/superpowers/plans/2026-10-28-templates-sheet.md` Tasks 4–5** (not run yet). Both plans edit
  `server/cloud/routes_messages.py`, `repo_messages.py`, `push.py`, `push_worker.py`, `handler.py` and `server/API.md`.
  - The overlaps:
    - Their Task 4 adds `update_message` and `PUT /messages/{m}`.
    - Their Task 5 changes `list_messages` (bump merge), `get_message` and `read` (read rule), and `_process` /
      `recipients` (kind `message_update`).
    - This plan changes `_message_json` (viewer fields), `list_messages` / `get_message` (viewer fields),
      `remove_message` (deletes replies), the reply routes, `PUSH_TEXT` / `SYSTEM_KEYS` and `_process` (kind `reply`).
  - **Whichever runs second adapts:**
    - Viewer fields are added once to the final page, after any bump merge.
    - `update_message` answers through the same `private_replies.viewer_fields`.
    - `_process` accepts both `reply` and `message_update`.
    - An update keeps the replies (same id) and pushes no repliers (§22.6).
  - Before editing a shared file, run `git status`. If it has uncommitted changes you did not make, stop and tell the
    controller. Stage by name only (`git add <path>`), never `-A` or `.`.
  - If `src/views/compose/TemplatePreview.tsx` exists by Task 7, it renders `ReplyRow` with `preview`. Otherwise the
    templates plan's Task 8 adds it.
- **Models:** Sonnet implements every task. Task 2 gets an **Opus** reviewer with the privacy checklist in that task.
  Task 4 ends with an **Opus** review across Tasks 2–4. The checklist covers who can read which reply, the one-adult
  recipient, and leaks through counts, export, push and cache.
- **Commits:** one per task, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01FRubJBqpXEVMb7vLFxbfwk`. Repo identity is Asaf Gilai (checked).
  No `git push`.
- **Test commands:**
  - `npm test`
  - `node --test tests/<file>.test.ts`
  - `npm run typecheck`
  - `npm run test:server`
  - one module: `.venv/bin/python -m unittest server.tests.cloud.<module> -v`
  
  All must be green at the end of every task.
- **Rulings made here (spec silent):**
  - Viewer-dependent fields (`canReply`, `isRecipient`, `replied`) ride on every message JSON, computed per request.
  - The expensive ones (`replyAdults`, `replyBlocked`, which need reachability reads) come only on `GET` of a single
    message. The card opens the reply Sheet, which fetches it.
  - Unread is a per-person watermark per message (the highest `replyId` seen). The mailbox marks a thread read only
    when all its unread replies are among the three it shows. Otherwise M3 marks it. Edits never make a reply unread
    again.
  - Leaving the Kehila (self or removed by management) deletes the personal replies addressed to the leaver (§22.4a).
    Replies to an author who left are kept (§22.6).
  - No haptic tick on long press in v1. `expo-haptics` is a native dependency and needs a new build. The 500 ms long
    press and the web `more` button ship.
  - The dev migration marks every existing blessing as seen for the current adults, so nobody wakes up to "37 חדשות".

## Review Focus

1. **The spouse of a personal-reply recipient** opens M3, the feed, the mailbox, the Me badge, a push and their export.
   They must see nothing of the personal reply except the public count. Tests:
   - Task 2 `test_personal_reply_seen_only_by_chosen_adult`
   - Task 3 `test_personal_reply_pushes_only_chosen_adult`
   - Task 4 `test_export_personal_reply_only_in_chosen_adults_export`
2. **Family changes after replies.** A partner linked later sees the family's replies but never a personal one sent to
   the other adult. A chosen adult who unlinks and stays keeps the personal reply. Tests: Task 2
   `test_partner_linked_later_sees_family_not_personal` and `test_personal_reply_after_unlink_stays_with_adult`.
3. **A busy message** (many replies in minutes) must push each recipient at most once per 15 minutes per message. A
   different message is not throttled. Test: Task 3 `test_throttle_15_minutes_per_message_per_recipient`.
4. **Legacy dev blessings:** several replies by one person, no `to`, no thread item. They stay visible to the family
   only and count the person once, and the box shows the newest as "my reply". After the migration they appear in the
   mailbox without an unread burst. Tests: Task 2 `test_legacy_replies_without_to_are_family`, Task 5
   `test_apply_writes_threads_and_marks_existing_seen`.
5. **Deleted things on a stale phone:** a deleted reply, a deleted message or a deleted author account. The reply must
   vanish from the in-memory feed and the mailbox on the next load, not linger until restart. Tests: Task 2
   `test_message_removal_deletes_replies_and_thread`, Task 6 `setReplies replaces a stale list` and `reply_removed
   removes the reply`.

---

## File map

| File | Responsibility | Tasks |
|---|---|---|
| `server/cloud/private_replies.py` (new) | route rule, viewer fields, inbox, drop on leave / delete | 1, 2, 4 |
| `server/cloud/visibility.py` | `reply_visible` with `to`, `whole_kehila_channel` | 1, 2 |
| `server/cloud/families.py` | `TargetMemo`, `ordered_reachable_adults` | 1 |
| `server/cloud/routes_messages.py` | message JSON, reply routes, remove deletes replies | 1, 2 |
| `server/cloud/repo_messages.py` | reply write/edit/delete, thread index, watermarks, throttle | 2, 3, 4 |
| `server/cloud/routes_changes.py` | `reply` / `reply_removed` items, viewer fields | 2 |
| `server/cloud/push.py`, `push_worker.py`, `routes_admin.py` | fixed reply texts, routing, throttle | 3 |
| `server/cloud/export.py`, `routes_me.py`, `routes_admin.py` (`leave`, `remove_member`) | export, deletion, leave | 4 |
| `server/cloud/handler.py`, `server/API.md` | routes, docs | 1–4 |
| `tools/migrate_private_replies.py` (new), `tools/smoke_dev.py` | dev migration, smoke | 5 |
| `src/client/replyView.ts` (new) | labels, states, times, mailbox maths (pure) | 6 |
| `src/client/types.ts`, `endpoints.ts`, `feed.ts`, `store.ts`, `SessionProvider.tsx`, `fixtures.ts` | data flow | 6 |
| `src/client/messageView.ts` | drop `canReply`, `visibleReplies`, `replierChip` | 6 |
| `src/views/replies/ReplyRow.tsx`, `ReplyBox.tsx`, `ReplySheet.tsx`, `CardActions.tsx` (new) | card, Sheet, box | 7 |
| `src/views/MessageRow.tsx`, `Messages.tsx`, `src/kit/Composer.tsx` | reply row, long press, counter | 7 |
| `src/views/replies/ReceivedList.tsx` (new), `src/views/MessageDetail.tsx` | M3 | 8 |
| `src/views/me/Inbox.tsx` (new), `src/views/Me.tsx`, `src/client/meMap.ts`, `src/views/Main.tsx`, `src/views/NotifyPrefs.tsx` | mailbox, badge | 9 |

---

### Task 1: server — the reply rule and the viewer's fields on every message

**Files:**
- Create: `server/cloud/private_replies.py`
- Modify:
  - `server/cloud/visibility.py`
  - `server/cloud/families.py`
  - `server/cloud/routes_messages.py` (`_message_json`, `list_messages`, `get_message`, `post_message` answer)
  - `server/cloud/routes_changes.py` (message-kind items)
  - `server/API.md`
- Test: `server/tests/cloud/test_private_replies.py` (new, class `ReplyRuleTest(test_messages.MessagesTest)`)

**Interfaces:**
- Produces:
  - `visibility.whole_kehila_channel(channel) -> bool`: `bool(channel) and not channel.get('groups') and not
    channel.get('conversation')`.
  - `private_replies.reply_route(message: dict, channel: dict | None) -> 'author' | 'family' | None` (Global
    Constraints rule).
  - `families.TargetMemo(repo, k)` with `.adults(message) -> frozenset[str]`: `target_adults`, memoised per
    `(targetFamilyId, targetMemberId)` for one request.
  - `families.ordered_reachable_adults(repo, k, message, channel) -> list[dict]`: memberships of the resolved target
    family's live adults, in the family's stored adult order, filtered by `visibility.reply_target_ok`.
  - `private_replies.viewer_fields(repo, k, user_id, membership, items: list[dict], channels: dict[str, dict], memo) ->
    dict[str, dict]`, keyed by messageId. For a message with a route it returns `{replyTo, canReply, isRecipient,
    replied}`:
    - `isRecipient`: author route → `user_id == authorId`; family route → `user_id in memo.adults(m)`.
    - `canReply`: role in `authz.ADULTS` and `not isRecipient` (and not the author).
    - `replied`: the `RP#<user_id>` marker exists. One `batch_get` for the whole page.
    
    Messages without a route get `{}`.
  - `private_replies.detail_fields(repo, k, user_id, message, channel) -> dict` (single GET only). It returns
    `replyAdults: [{userId, name}]` (family route, `canReply` true, from `ordered_reachable_adults`; `name` =
    `displayName`). It returns `replyBlocked: 'author_left' | 'target_left'` when the route exists and the caller could
    reply but nobody can receive. For `author_left`, the author's membership is missing or not `ADULTS`, or the author
    cannot read the channel. In that case `canReply` becomes false.
  - `_message_json(item, read=None, viewer=None)` merges `viewer`. `replierCount` is present whenever `replyTo` is, or
    `targetMemberId` is (a legacy blessing in a group channel keeps its count).

- [ ] **Step 1: Write the failing tests** in `test_private_replies.py`. Fixture: `MessagesTest`. Add a tech
  (`self.add('tech-sub', 'tech', 'Tal Tech')`), a second broadcaster `רותם אלמוג`, and a two-adult family linked as
  in `test_replies.py::test_partner_sees_replies_and_gabbai_still_not`.
  - `test_reply_route_table`: pure, one row per case:
    - (general, member, announcements) → `'author'`
    - (event, member) → `'author'`
    - (general, management) → `None`
    - (event, management) → `None`
    - (celebration with target, management) → `'family'`
    - (condolence without target) → `None`
    - (weekly) → `None`
    - (chat) → `None`
    - (general, member, a channel with `groups`) → `None`
    - (general, member, a conversation) → `None`
    - removed → `None`
  - `test_member_message_answerable_management_not`: the member posts a general message → JSON `replyTo == 'author'`,
    `replierCount == 0`. The gabbai and the tech each post a general message → no `replyTo` and no `replierCount`.
  - `test_management_blessing_takes_blessings`: the gabbai posts a celebration targeting the family → `replyTo ==
    'family'`. For another member, `canReply` is true.
  - `test_viewer_fields_per_person`: on the member's general message:
    - the author gets `canReply False`, `isRecipient True`
    - another member gets `canReply True`, `isRecipient False`, `replied False`
    - the gabbai gets `canReply True`
    - the listener gets `canReply False`, `isRecipient False`
    
    On a blessing, both family adults get `canReply False`, `isRecipient True`.
  - `test_list_and_feed_carry_viewer_fields`: `GET /messages` and a `reply_count` change item both carry the four
    fields for the caller.
  - `test_detail_reply_adults_in_family_order`: a single GET by another member on the two-adult blessing →
    `replyAdults` equals both adults in the family's stored order, each `{userId, name}`. A one-adult family →
    length 1. The list has no `replyAdults`.
  - `test_reply_blocked_author_left`: the author leaves (`DELETE .../membership`) → a single GET by another member
    gives `canReply False`, `replyBlocked 'author_left'`.
  - `test_reply_blocked_target_left`: both adults leave → `replyBlocked 'target_left'`.
  - `test_rule_follows_stored_author_kind`: a member posts, then is made gabbai (`repo.put_membership`) → still
    `replyTo 'author'`.
- [ ] **Step 2: Run** `.venv/bin/python -m unittest server.tests.cloud.test_private_replies -v`. Expected: FAIL
  (`ImportError: private_replies`).
- [ ] **Step 3: Implement** the interfaces above:
  - `list_messages` and `changes()` build one `TargetMemo` per request and pass `viewer_fields(...)[id]` into
    `_message_json`.
  - `get_message` also merges `detail_fields`.
  - `post_message` answers with the poster's viewer fields.
- [ ] **Step 4: Run** the module, `test_replies`, `test_messages`, `test_changes`, and `npm run test:server`. Expected:
  PASS (the old tests still pass: nothing about posting replies changed yet).
- [ ] **Step 5: Document** in `server/API.md`:
  - Message object: `replyTo`, `canReply`, `isRecipient`, `replied`. On single GET only: `replyAdults` and
    `replyBlocked`. `replierCount` now appears with `replyTo`.
  - The rule, in one paragraph, replacing "A reply can be posted only to a message that has a `targetMemberId`".
- [ ] **Step 6: Commit**
  ```bash
  git add server/cloud/private_replies.py server/cloud/visibility.py server/cloud/families.py server/cloud/routes_messages.py server/cloud/routes_changes.py server/API.md server/tests/cloud/test_private_replies.py
  git commit -m "Private replies: one rule for answerable messages, viewer fields on every message"
  ```

---

### Task 2: server — writing, editing, deleting and reading replies; the mailbox (privacy-critical, Opus review)

**Files:**
- Modify:
  - `server/cloud/private_replies.py`
  - `server/cloud/visibility.py` (`reply_visible`, `change_visible`)
  - `server/cloud/routes_messages.py` (`post_reply`, `list_replies`, new `put_reply`, `delete_reply`, `read_replies`,
    `inbox`, `remove_message`, `_reply_json`)
  - `server/cloud/repo_messages.py`
  - `server/cloud/routes_changes.py`
  - `server/cloud/handler.py`
  - `server/API.md`
- Test: `server/tests/cloud/test_private_replies.py` (new class `ReplyFlowTest`), `server/tests/cloud/test_replies.py`
  (adapt)

**Interfaces:**
- Consumes: Task 1 (`reply_route`, `TargetMemo`, `ordered_reachable_adults`, `viewer_fields`).
- Produces: storage. Every new key carries no names.

  | Item | Key | Attributes |
  |---|---|---|
  | Reply | `K#<k>#MSG#<m>` / `R#<replyId>` | as today, plus `to` (`'author'` \| `'family'` \| `<userId>`) and `updatedAt?`. A missing `to` means `'family'` |
  | Thread index | `K#<k>#RX` / `MSG#<m>` | `replyTo`, `msgAuthorId`, `targetMemberId?`, `targetFamilyId?`, `personalTo?` (string set), `lastAt` |
  | Read watermark | `K#<k>#U#<user>` / `RXSEEN#<m>` | `upTo` (replyId) |

- Produces: repo methods.
  - `repo.put_reply(k, m, author_id, author_name, body, to) -> dict`: the transaction as today. When the `RP#` marker
    condition fails, it raises `ApiError(409, 'already_replied')` and no longer puts a second reply.
  - `repo.touch_thread(k, m, message, route, personal_to=None, now)`: `SET` the thread attributes, `ADD personalTo`
    when personal.
  - `repo.update_reply(k, m, reply_id, author_id, body, now) -> dict`: condition `attribute_exists(sk) AND authorId =
    :me`, else 404 `reply_not_found`.
  - `repo.delete_replies` also deletes the thread item.
  - `repo.get_reply(k, m, reply_id)`
  - `repo.list_threads(k) -> list[dict]`
  - `repo.seen_marks(k, user_id, message_ids) -> dict[str, str]`
  - `repo.mark_seen(k, user_id, m, up_to)`: conditional `attribute_not_exists(upTo) OR upTo < :u`, a lost race is not
    an error.
- Produces: `visibility.reply_visible(user_id, message, reply, family_adults)` with the `to` rule (Global
  Constraints). `routes_changes` passes `family_adults` to `change_visible` only for a reply whose `to` is family. It
  loads the reply before the check.
- Produces: routes. Errors are added to the API.md table.

  | Method | Path | Who | Body | Answer | Errors |
  |---|---|---|---|---|---|
  | POST | `/v1/kehilot/{k}/messages/{m}/replies` | `ADULTS` | `{body, to?}` | 201 reply | 400 `invalid_body`, `invalid_to`; 404 `message_not_found`; 409 `replies_not_allowed`, `cannot_reply_to_own`, `author_left`, `target_left`, `already_replied`, `try_again` |
  | GET | same | `ALL` | – | 200 `[reply]` visible to the caller, oldest first | 404 |
  | PUT | `/v1/kehilot/{k}/messages/{m}/replies/{r}` | writer | `{body}` | 200 reply | 400 `invalid_body`, 404 `reply_not_found` (also another's reply) |
  | DELETE | same | writer | – | 204 | 404 `reply_not_found` |
  | POST | `/v1/kehilot/{k}/messages/{m}/replies/read` | `ALL` | `{upTo}` | 204 (writes only when the caller is a recipient of a visible reply) | 400 `invalid_up_to`, 404 |
  | GET | `/v1/kehilot/{k}/replies/inbox` | `ADULTS` | – | 200 `{unread, threads}` | 403 (listener) |

- Produces: request rules.
  - `to`: omitted, or `'family'`, or the `userId` of one of `ordered_reachable_adults`. It is allowed only on the
    family route. On the author route it must be omitted or `'author'`. Anything else is 400 `invalid_to`.
  - Order of checks: route None → `replies_not_allowed`; caller is author or in target adults →
    `cannot_reply_to_own`; nobody reachable → `author_left` / `target_left`; `to` → `invalid_to`; marker →
    `already_replied`.
- Produces: reply JSON `{replyId, authorId, authorName, body, createdAt, updatedAt?, to}`.
  - For the writer, `toName` (the chosen adult's current `displayName`, `''` when gone) when `to` is a userId.
  - For a recipient, `personal: true` when `to == caller`, and `unread: bool` (`replyId > upTo` and `authorId !=
    caller`).
- Produces: `private_replies.inbox_threads(repo, k, user_id, membership, limit: int | None = 3) -> list[dict]`. Each
  item is `{message, total, unread, personal, replies}` (all visible replies when `limit` is None; Task 4's export
  uses that). The route `routes_messages.inbox` wraps it as the inbox JSON
  `{unread: int, threads: [{message, total, unread, personal, replies}]}`.
  - `message` is the message JSON with viewer fields. `total` is the replies visible to me that are not mine.
    `personal` is how many of them have `to == me`. `replies` is the newest 3, newest first, as above.
  - Threads are ordered by newest visible reply first.
  - Candidates come from `list_threads`:
    - `replyTo == 'author'` and `msgAuthorId == me`;
    - or `me in personalTo`;
    - or family threads whose `targetFamilyId == my family id` or whose `targetMemberId` is in my family's adults
      (`repo.family_of` once). These are then confirmed with `memo.adults`.
  - Every candidate is re-checked with `message_visible` and `reply_visible`.
- Produces: changes.
  - `reply` (edit too, same `refId`) and new `reply_removed` with item `{id: replyId, messageId}`.
  - `visibleTo`: `[writer, *recipients]`. Recipients are the author, or the target adults at that time, or the
    chosen adult.
  - `reply_count` on every count change.
  - `remove_message` calls `repo.delete_replies` after the `removed` flag. The `message_removed` change covers the
    client.
- Push: `post_reply` calls `push.enqueue('reply', k, f'{m}/{replyId}')`. Task 3 makes the worker understand it.
  `put_reply` and `delete_reply` never push.

- [ ] **Step 1: Write the failing tests** (`ReplyFlowTest`, same fixture as Task 1, plus the two-adult family
  "ברקן": שולמית ברקן, יגאל ברקן):
  - `test_reply_to_author_seen_by_writer_and_author_only`: another member and the gabbai get `[]`. The author gets
    one reply with `unread True`. After `replies/read`, `unread False`.
  - `test_one_reply_per_person`: a second POST → 409 `already_replied`, and `replierCount` stays 1.
  - `test_edit_by_writer_only`: PUT by the writer → 200, `updatedAt` set, `to` unchanged, and a `reply` change with
    the same `refId`. PUT by someone else → 404 `reply_not_found`. A PUT with `to` in the body ignores it.
  - `test_delete_by_writer_drops_count`: DELETE → 204, `replierCount` 0, and `reply_removed` plus `reply_count`
    changes. A second DELETE → 404. Then a POST by the same person is allowed again.
  - `test_body_limits`: 1000 code points of `'😀'` → 201. 1001 → 400 `invalid_body`. Whitespace only → 400.
  - `test_personal_reply_seen_only_by_chosen_adult` (**Review Focus 1**): a member sends `to = שולמית`. Then:
    - שולמית's GET has it with `personal True`;
    - יגאל's GET has none, and his `changes` page has no `reply` item for it;
    - his inbox `total` excludes it, and his `unread` is 0;
    - the gabbai and tech see none;
    - the card `replierCount == 1` for everyone;
    - the writer's GET has `toName == 'שולמית ברקן'`.
  - `test_family_reply_seen_by_both_adults_with_separate_unread`: one adult marks read; the other's `unread` is still
    1.
  - `test_partner_linked_later_sees_family_not_personal` (**Review Focus 2**): one family reply and one personal reply
    to adult A, sent before B links. After linking, B sees the family one only.
  - `test_personal_reply_after_unlink_stays_with_adult` (**Review Focus 2**): A unlinks and stays. A still sees the
    personal reply. B does not.
  - `test_to_validation`: 400 `invalid_to` for each of:
    - a listener's id;
    - another family's adult;
    - an adult who cannot read the channel;
    - `to` on an author-routed message;
    - a non-string.
  - `test_reply_rules`:
    - 409 `cannot_reply_to_own` for the author and for a family adult;
    - 409 `replies_not_allowed` on a management general message, a weekly, and a group-channel blessing;
    - 403 for a listener;
    - 409 `author_left` after the author leaves.
  - `test_message_removal_deletes_replies_and_thread` (**Review Focus 5**): after `DELETE /messages/{m}`, the
    `K#<k>#MSG#<m>` partition has no `R#` or `RP#` items, and `K#<k>#RX` has no `MSG#<m>`.
  - `test_inbox_counts_family_and_personal`. Spec example, scaled: 3 family replies, 1 to A, 1 to B → the card shows
    5. A sees `total 4, personal 1`, and so does B. `replies` has length 3, newest first. Threads are ordered by
    newest reply.
  - `test_inbox_author_and_listener`: the author of an answered general message sees its thread. A listener gets
    403. The gabbai gets `{unread: 0, threads: []}`.
  - `test_legacy_replies_without_to_are_family` (**Review Focus 4**): write two `R#` items for one user without
    `to`, plus one `RP#` marker, directly with `repo.table.put_item`. Both adults see both. The count is 1. A POST by
    that user → 409 `already_replied`.
  - `test_read_marker_validation`: `upTo` not a ULID → 400 `invalid_up_to`. A non-recipient → 204, and no
    `RXSEEN#` item is written.
  - Adapt `test_replies.py` to one reply per person (`test_replier_count_counts_distinct_users`,
    `test_concurrent_first_replies_by_same_user_count_once` now expects one 201 and one 409 `already_replied`).
- [ ] **Step 2: Run** `.venv/bin/python -m unittest server.tests.cloud.test_private_replies
  server.tests.cloud.test_replies -v`. Expected: FAIL (405 on PUT, `already_replied` missing).
- [ ] **Step 3: Implement** the storage, repo methods, visibility, routes and changes above. Add the four new route
  lines to `handler.py`: PUT and DELETE `.../replies/(?P<r>[^/]+)`, POST `.../replies/read` before the `{r}` lines,
  and GET `/replies/inbox`. `_reply_json(item, caller, message, seen)` builds the JSON above.
- [ ] **Step 4: Run** both modules, `test_changes`, `test_messages`, `test_delete_account`, and `npm run test:server`.
  Expected: PASS.
- [ ] **Step 5: Document** in `server/API.md`, "Private replies":
  - the route table above;
  - the reply and inbox shapes;
  - the `to` rule and who reads what;
  - the new change kind `reply_removed`;
  - the three item kinds;
  - the error rows `already_replied`, `author_left`, `invalid_to`, `reply_not_found`, `invalid_up_to`.
- [ ] **Step 6: Review (Opus).** The reviewer gets this task, §22.1, §22.4a, §22.5 and §22.6, and checks:
  - (a) Every read path enforces the `to` rule: GET replies, changes `reply`, inbox, read marker, `toName`.
  - (b) A personal reply never reaches the spouse, the gabbaim or tech, by text, id, `unread` or `personal` count.
  - (c) The count is the only public trace.
  - (d) Hidden and missing look the same (404, not 403, for another's reply).
  - (e) No reply text or name is logged.
  - (f) `already_replied` cannot be bypassed by a race.
  
  Fix every finding and re-run Step 4.
- [ ] **Step 7: Commit**
  ```bash
  git add server/cloud/private_replies.py server/cloud/visibility.py server/cloud/routes_messages.py server/cloud/repo_messages.py server/cloud/routes_changes.py server/cloud/handler.py server/API.md server/tests/cloud/test_private_replies.py server/tests/cloud/test_replies.py
  git commit -m "Private replies: one per person to the author, the family or one adult; edit, delete, read markers, mailbox"
  ```

---

### Task 3: server — the reply push: fixed texts, recipients, 15-minute throttle

**Files:**
- Modify:
  - `server/cloud/push.py`
  - `server/cloud/push_worker.py`
  - `server/cloud/routes_admin.py` (push-text key check)
  - `server/cloud/repo_messages.py` (`claim_reply_push`)
  - `server/API.md`
- Test: `server/tests/cloud/test_push_replies.py` (new), `server/tests/cloud/test_push_texts.py` (adapt)

**Interfaces:**
- Consumes: Task 2. Job `('reply', k, '<messageId>/<replyId>')`. Reply `to`.
- Produces:
  - `PUSH_TEXT` loses `'reply'` and gains five fixed keys, verbatim from §22.7:

    | Key | he | en |
    |---|---|---|
    | `private_reply` | תשובה פרטית חדשה | New private reply |
    | `family_blessing` | ברכה אישית חדשה למשפחה | New personal blessing for your family |
    | `family_word` | מילה אישית חדשה למשפחה | New personal word for your family |
    | `personal_blessing` | ברכה אישית חדשה | New personal blessing |
    | `personal_word` | מילה אישית חדשה | New personal word |

  - `push.REPLY_KEYS` (those five) and `push.FIXED_TEXT_KEYS = SYSTEM_KEYS + REPLY_KEYS`. `resolve_text` and
    `routes_admin` (the editable-key check, line ~287) use `FIXED_TEXT_KEYS`. `SYSTEM_KEYS` keeps its meaning
    ("ref = recipient userId").
  - `push.reply_text_key(message_type: str, to: str) -> str`:
    - `'author'` → `private_reply`;
    - `'family'` → `family_blessing` (celebration) or `family_word` (condolence);
    - a userId → `personal_blessing` or `personal_word`.
  - `push_worker` accepts job kind `'reply'`. `_process` checks `kind in PUSH_TEXT or kind == 'reply'`.
  - `recipients(repo, 'reply', k, ref)` returns nothing when the message or reply is gone, or the message is removed.
    Otherwise it returns, without the writer:
    - `to == 'author'`: the author, if `authz.role_in(m, authz.ADULTS)` and the author can read the channel;
    - `'family'` or missing: `families.ordered_reachable_adults`;
    - a userId: that user, if `reply_target_ok`.
    
    Then it keeps only those for whom `repo.claim_reply_push(k, messageId, uid, now)` is true. Mutes never apply.
  - `repo.claim_reply_push(k, m, user_id, now) -> bool`: a conditional put of `K#<k>#U#<user>` / `RXPUSH#<m>`
    `{at: now, expiresAt: now + 3600}` under `attribute_not_exists(sk) OR #at <= :cut`, where `cut = now -
    REPLY_PUSH_WINDOW` and `REPLY_PUSH_WINDOW = 15 * 60`.
  - `_data('reply', k, ref)` is `{kehila, messageId}` (the part before `/`). `_build` uses `reply_text_key`.
  - The worker log line stays ids and counts. `ref` is logged as is (ids only).

- [ ] **Step 1: Write the failing tests** in `test_push_replies.py` (moto table, fake devices; patch `expo.send` as
  `test_push.py` does):
  - `test_job_carries_ids_only`: the SQS body is exactly `{"kind": "reply", "kehila": k, "ref": "<m>/<r>"}`.
  - `test_author_route_pushes_author_with_fixed_text`: title = the Kehila name, body `תשובה פרטית חדשה`, data
    `{kehila, messageId}`. A custom `pushTexts.reply` on META is ignored.
  - `test_family_route_pushes_reachable_adults`: a condolence reply → both adults get `מילה אישית חדשה למשפחה`.
  - `test_personal_reply_pushes_only_chosen_adult` (**Review Focus 1**): only שולמית gets the push, with body
    `ברכה אישית חדשה` (`New personal blessing` for an `en` profile). יגאל gets nothing.
  - `test_throttle_15_minutes_per_message_per_recipient` (**Review Focus 3**): with `time.time` patched, two replies
    by different people at t and t+60 s → one push to the author. At t+15 min+1 s → a second push. A reply on
    another message at t+60 s → pushed.
  - `test_muted_replier_still_pushes`: the author muted the replier (`mutedMembers`) → still pushed.
  - `test_deleted_reply_or_removed_message_sends_nothing`.
  - In `test_push_texts.py`: `test_reply_key_not_editable`. GET `admin/push-texts` has none of `reply` or the five
    keys. PUT `{key: 'reply'}` and PUT `{key: 'private_reply'}` → 400 `invalid_key`.
- [ ] **Step 2: Run** `.venv/bin/python -m unittest server.tests.cloud.test_push_replies
  server.tests.cloud.test_push_texts -v`. Expected: FAIL (`AttributeError: REPLY_KEYS`).
- [ ] **Step 3: Implement** the interfaces above.
- [ ] **Step 4: Run** both modules, `test_push`, and `npm run test:server`. Expected: PASS.
- [ ] **Step 5: Document** in `server/API.md` "Push notifications": reply recipients per `to`, the five fixed texts,
  the 15-minute throttle, no push on edit or delete, and that `reply` is gone from `admin/push-texts`.
- [ ] **Step 6: Commit**
  ```bash
  git add server/cloud/push.py server/cloud/push_worker.py server/cloud/routes_admin.py server/cloud/repo_messages.py server/API.md server/tests/cloud/test_push_replies.py server/tests/cloud/test_push_texts.py
  git commit -m "Private replies: fixed nameless pushes to the right recipient, at most one per message per 15 minutes"
  ```

---

### Task 4: server — export, account deletion and leaving; Opus privacy review of Tasks 2–4

**Files:**
- Modify:
  - `server/cloud/export.py`
  - `server/cloud/private_replies.py`
  - `server/cloud/repo_messages.py` (`received_reply_items`, `reset_replier_count`, `drop_personal_to`)
  - `server/cloud/routes_me.py` (`delete_account`)
  - `server/cloud/routes_admin.py` (`leave`, `remove_member`)
  - `server/API.md`
- Test: `server/tests/cloud/test_export.py`, `server/tests/cloud/test_delete_account.py`,
  `server/tests/cloud/test_private_replies.py` (new class `LeaveTest`)

**Interfaces:**
- Consumes: Tasks 2–3.
- Produces:
  - Export `data.json`:
    - `replies` entries gain `title` (the message's current title, `''` if gone) and `to`. `to` is `'author'`,
      `'family'`, or the chosen adult's current `displayName` (`''` if gone).
    - New `repliesReceived: [{kehilaId, messageId, title, authorName, body, createdAt, updatedAt?, personal}]`, built
      from `private_replies.inbox_threads(repo, k, user_id, membership, limit=None)` for each current membership. It holds every
      visible reply not written by the user. A family's blessings go into both adults' exports; personal ones only
      into the chosen adult's.
  - `private_replies.drop_personal(repo, k, user_id) -> int`: for threads whose `personalTo` contains the user, call
    `repo.delete_reply` for each reply with `to == user_id` (this fixes counts and markers, and writes `reply_count`).
    Then `DELETE personalTo :u`. Called by `leave` and `remove_member` after the membership goes, best effort,
    logged as counts like `_drop_from_family`.
  - `private_replies.drop_received(repo, user_id) -> tuple[int, int]` (threads, replies). It uses one scan,
    `repo.received_reply_items(user_id)`, with filter `Attr('to').eq(uid) | (Attr('msgAuthorId').eq(uid) &
    Attr('replyTo').eq('author'))`:
    - a reply with `to == uid` → `delete_reply`;
    - an author-routed thread item → `delete_replies(k, m)` + `reset_replier_count(k, m)` + a `reply_count` change.
    
    It is idempotent. `delete_account` calls it after the posts step and before `drop_adult`, under the same 503
    `try_again` time check as `posts.delete_posts`. The log line adds `received=<n>`.
  - Family replies to a blessing whose poster deletes the account are untouched (§22.6).

- [ ] **Step 1: Write the failing tests:**
  - `test_export.py`:
    - `test_export_own_replies_have_title_and_to`: one reply of each kind (`'author'`, `'family'`, `'שולמית ברקן'`).
    - `test_export_replies_received_for_both_adults`: a family blessing reply appears in both adults' exports.
    - `test_export_personal_reply_only_in_chosen_adults_export` (**Review Focus 1**): it is in שולמית's export and
      absent from יגאל's, the gabbai's and an unrelated member's.
    - `test_export_received_author_replies`.
  - `test_delete_account.py`:
    - `test_author_deletion_drops_replies_addressed_to_author`: no `R#` / `RP#` left, no thread item,
      `replierCount 0`, a `reply_count` change.
    - `test_personal_recipient_deletion_drops_personal_replies`: the count drops by one; the writer's GET is empty.
    - `test_blessing_poster_deletion_keeps_family_replies`.
    - `test_replier_deletion_without_posts_blanks_name`: the reply stays, `authorName == ''`.
    - `test_replier_deletion_with_posts_deletes_reply_and_count`.
    - `test_drop_received_is_idempotent_and_try_again_safe`: patch the remaining time to force 503 once; the retry
      finishes.
  - `LeaveTest`:
    - `test_leave_drops_personal_replies_to_leaver`;
    - `test_removed_member_loses_personal_replies`;
    - `test_author_leave_keeps_replies_until_rejoin`: the replies come back to the author after `put_membership`
      again;
    - `test_family_replies_survive_one_adult_leaving`.
- [ ] **Step 2: Run** `.venv/bin/python -m unittest server.tests.cloud.test_export server.tests.cloud.test_delete_account
  server.tests.cloud.test_private_replies -v`. Expected: FAIL.
- [ ] **Step 3: Implement** the interfaces above.
- [ ] **Step 4: Run** the three modules and `npm run test:server`. Expected: PASS.
- [ ] **Step 5: Document** in `server/API.md`:
  - the export row (`replies` with `title` and `to`, and `repliesReceived`);
  - the deletion paragraph (replies addressed to the person are deleted; family replies stay);
  - leaving drops personal replies to the leaver;
  - the log line.
- [ ] **Step 6: Review (Opus), across Tasks 2–4.** The reviewer gets the three diffs, §22 and this plan's Global
  Constraints and Review Focus. Checklist:
  - who can read which reply on every path (routes, feed, inbox, export);
  - the one-adult recipient against the spouse, gabbai and tech;
  - leaks through counts (inbox `total`/`personal`/`unread` per viewer, card count only public);
  - leaks through the export;
  - leaks through push (recipients, texts, data, SQS body, logs);
  - leaks through cache (the feed's `visibleTo`, the thread index never served raw);
  - deletion and leave leaving no readable orphan.
  
  Fix the findings, re-run Step 4, and note the review result in the commit message body.
- [ ] **Step 7: Commit**
  ```bash
  git add server/cloud/export.py server/cloud/private_replies.py server/cloud/repo_messages.py server/cloud/routes_me.py server/cloud/routes_admin.py server/API.md server/tests/cloud/test_export.py server/tests/cloud/test_delete_account.py server/tests/cloud/test_private_replies.py
  git commit -m "Private replies: export received replies, delete replies addressed to a deleted or departed person"
  ```

---

### Task 5: server — dev migration and smoke checks

**Files:**
- Create: `tools/migrate_private_replies.py`, `server/tests/cloud/test_migrate_replies_tool.py`
- Modify: `tools/smoke_dev.py`

**Interfaces:**
- Consumes: Tasks 1–4 (`reply_route`, `repo.touch_thread`, `repo.mark_seen`, `families.target_adults`).
- Produces: `.venv/bin/python tools/migrate_private_replies.py --env dev [--kehila <id>] [--apply]`. Without
  `--apply` it is a dry run. It uses `kehila_admin.open_repo`. `migrate(repo, k=None, apply=False) -> dict` returns
  counts `{kehilot, threads, repliesTagged, seenMarks, pushTextsRemoved}`.
  - For every message with `R#` items, write the thread item. `replyTo` comes from `reply_route`, falling back to
    `'family'` when `targetMemberId` is set (a legacy blessing in a group channel). `lastAt` is the newest
    `createdAt`.
  - Set `to = 'family'` on `R#` items without `to`.
  - For each current target adult, `mark_seen(..., up_to=newest replyId)`.
  - `REMOVE pushTexts.reply` on META.
  - Idempotent. Prints counts only.

- [ ] **Step 1: Write the failing tests** in `test_migrate_replies_tool.py` (moto, legacy items written directly):
  - `test_dry_run_writes_nothing`: the counts are reported, and the table item count is unchanged.
  - `test_apply_writes_threads_and_marks_existing_seen` (**Review Focus 4**): after `--apply`, each family adult's
    inbox has the thread with `unread 0`. Every `R#` has `to == 'family'`. A second run changes nothing (same counts,
    no new items).
  - `test_removes_custom_reply_push_text`.
- [ ] **Step 2: Run** `.venv/bin/python -m unittest server.tests.cloud.test_migrate_replies_tool -v`. Expected: FAIL
  (module missing).
- [ ] **Step 3: Implement** `tools/migrate_private_replies.py`. In `tools/smoke_dev.py` extend `check_private_reply`:
  - a second POST → 409 `already_replied`;
  - PUT → 200;
  - a member general message → reply to author → the author's inbox has it, and the gabbai's GET replies is empty;
  - DELETE → 204 and the count is back.
  
  Use the smoke's invented users only.
- [ ] **Step 4: Run** the module and `npm run test:server`. Expected: PASS. (The smoke runs only against dev in Task 10.)
- [ ] **Step 5: Commit**
  ```bash
  git add tools/migrate_private_replies.py tools/smoke_dev.py server/tests/cloud/test_migrate_replies_tool.py
  git commit -m "Private replies: dev migration of existing blessings (thread index, recipient, seen) and smoke checks"
  ```

---

### Task 6: client — data layer, reply rules and copy

**Files:**
- Create: `src/client/replyView.ts`, `tests/replyView.test.ts`
- Modify:
  - `src/client/types.ts`, `endpoints.ts`, `feed.ts`, `store.ts`, `SessionProvider.tsx`, `messageView.ts`,
    `fixtures.ts`
  - `src/i18n/he.json`, `src/i18n/en.json`
  - `tests/feed.test.ts`, `tests/store.test.ts`, `tests/messageView.test.ts`
- Test: the files above

**Interfaces:**
- Consumes: the API of Tasks 1–4.
- Produces: types.
  - `Message` gains `replyTo?: 'author' | 'family'`, `canReply?`, `isRecipient?`, `replied?`, `replyAdults?:
    {userId: string; name: string}[]` and `replyBlocked?: 'author_left' | 'target_left'`.
  - `Reply` gains `to: string`, `updatedAt?`, `toName?`, `personal?`, `unread?`.
  - `Change` gains `{kind: 'reply_removed'; id: string; item: {id: string; messageId: string}}`.
  - `InboxThread = {message: Message; total: number; unread: number; personal: number; replies: Reply[]}` and `Inbox
    = {unread: number; threads: InboxThread[]}`.
- Produces: endpoints. `postReply(k, m, body, to?)`, `putReply(k, m, r, body)`, `deleteReply(k, m, r)`,
  `markRepliesRead(k, m, upTo)`, `inbox(k)`.
- Produces: `feed.ts`.
  - `applyChanges`: a `reply` with a known `replyId` replaces it; `reply_removed` removes it.
  - `setReplies(state, m, list)` replaces the message's list (the server list is authoritative). It replaces
    `mergeReplies` for loads.
  - `upsertReply(state, m, reply)` and `removeReplyLocal(state, m, r)`.
- Produces: `store.ts` / `SessionProvider`.
  - `sendReply(m, body, to?)`, `editReply(m, r, body)`, `deleteReply(m, r)`, `loadReplies(m)` (uses `setReplies`),
    `markRepliesSeen(m, upTo)`, `loadInbox()`, and `state.inbox: Inbox | null`.
  - The inbox lives in memory only. It is never written to storage or to the search cache.
  - It reloads, debounced 2 s, after a page with `reply` or `reply_removed`, on focus, and after `markRepliesSeen`.
  - Listeners never call it.
- Produces: `replyView.ts` (pure, `t` passed in):
  - `replyKind(type) -> 'general' | 'celebration' | 'condolence'`.
  - `countText(m, t) -> string | null`: null at 0 or with no count. Otherwise `reply.countOne*` / `reply.count*` per
    kind.
  - `buttonState(m, role) -> 'reply' | 'replied' | 'none'`.
  - `buttonLabel(m, t)`, `headingText(m, to, t)`, `lockText(m, to, t)`, `sentText(reply, m, time, t)`,
    `placeholder(m, t)`, `receivedTitle(m, t)`.
  - `counterText(text) -> string | null`: null below 900 code points, `"{n}/1000"` from 900.
  - `canSendReply(text) -> boolean`: 1–1000 code points after trim.
  - `replyTime(seconds, lang, nowMs) -> string`:
    - today → `reply.time.today` ("היום, {time}");
    - yesterday → `reply.time.yesterday`;
    - otherwise `displayDate(date, lang)` (Hebrew first, Gregorian in brackets).
  - `myReply(replies, me) -> Reply | undefined`: the newest by `replyId` written by me.
  - `readUpTo(thread) -> string | null`: the newest shown `replyId` when `thread.unread <= thread.replies.length`,
    else null.
  - `mailboxStatus(inbox, t) -> string`: `inbox.rowNew` / `inbox.rowNone` / `inbox.rowEmpty`.
  - `threadLine(thread, t) -> string`: "הודעה שלכם · {n} תשובות · {m} חדשות", or "ברכות למשפחה שלכם · {n} ברכות ·
    {p} אישיות · {m} חדשות"; zero parts left out.
- Produces: i18n. All §22.7 keys, verbatim. Renamed keys move (`detail.replyTitle`, `detail.replyPlaceholder`,
  `detail.lock`, `detail.sent`, `detail.received`, `chip.formerMember`). Removed: `chip.celebration`,
  `chip.condolence`, `detail.notAllowed`, `admin.pushTexts.key.reply`. `prefs.locked` changes. New keys this plan adds
  (spec silent):

  | Key | he | en |
  |---|---|---|
  | `reply.time.today` | היום, {time} | Today, {time} |
  | `reply.time.yesterday` | אתמול, {time} | Yesterday, {time} |
  | `reply.unreadA11y` | חדשה | New |
  | `errors.already_replied` | כבר עניתם על ההודעה הזאת. אפשר לערוך את התשובה. | You already replied to this. You can edit your reply. |
  | `errors.author_left` | (= `reply.authorGone`) | (= `reply.authorGone`) |
  | `errors.invalid_to` | אי אפשר לשלוח למי שנבחר. בחרו שוב. | That person can't receive it. Choose again. |
  | `errors.reply_not_found` | התשובה כבר לא קיימת. | That reply no longer exists. |
  | `errors.cannot_reply_to_own` (changed) | אי אפשר לענות להודעה שלכם או לברכה על המשפחה שלכם | You can't reply to your own message or a blessing for your family |

- Produces: fixtures. `fixtures.ts` serves:
  - the new routes (in-memory replies with `to`, inbox built from them, one reply per person);
  - P48 screens added to `FIXTURE_APP_SCREENS`: `p48-messages`, `p48-actions`, `p48-sheet`, `p48-m3`,
    `p48-condolence`, `p48-picker`, `p48-inbox`, `p48-inbox-a`, `p48-inbox-b`, `p48-author`;
  - and `fixtureNav` cases in `src/views/Main.tsx` for them.
  
  The fixture people: author רותם אלמוג, family ברקן (שולמית, יגאל), condolence family שדמי (אלון).
- Removes: `canReply`, `visibleReplies` and `replierChip` from `messageView.ts`, and their tests.

- [ ] **Step 1: Write the failing tests:**
  - `tests/replyView.test.ts`:
    - `countText`: 0 → null; 1 → `תשובה פרטית אחת`; 12 celebration → `12 ברכות אישיות`; 9 condolence → `9 חברים
      כתבו למשפחה`.
    - `buttonState`: `canReply` → `'reply'`; `replied` → `'replied'`; a listener → `'none'`; no `replyTo` → `'none'`.
    - `headingText`: family → `ברכה אישית למשפחת ברקן`; a person → `ברכה אישית לשולמית ברקן`; condolence person →
      `מילה אישית לאלון שדמי`.
    - `lockText` for author, family and person: the exact §22.4 / §22.4a strings.
    - `counterText`: 899 → null; 900 → `900/1000`.
    - `canSendReply`: 1001 emoji → false.
    - `replyTime`: today 09:58 → `היום, 09:58`; yesterday → `אתמול, 22:03`; 2026-10-26 → `יום ב׳, ט״ו בחשוון
      (26.10)`.
    - `readUpTo`: unread 2 of 3 shown → the newest id; unread 5 with 3 shown → null.
    - `threadLine` matches the spec example (`ברכות למשפחה שלכם · 11 ברכות · 2 אישיות · 1 חדשות` for 11/2/1).
  - `tests/feed.test.ts`:
    - `a reply change with a known replyId replaces it`;
    - `reply_removed removes the reply` (**Review Focus 5**);
    - `setReplies replaces a stale list` (**Review Focus 5**).
  - `tests/store.test.ts`:
    - `editReply and deleteReply update the feed`;
    - `inbox is never persisted` (the storage spy sees no inbox or reply text);
    - `a reply change reloads the inbox once` (fake timers, two pages → one `inbox` call);
    - `a listener never loads the inbox`.
  - `tests/i18n.test.ts`: still green (parity).
- [ ] **Step 2: Run** `node --test tests/replyView.test.ts tests/feed.test.ts tests/store.test.ts`. Expected: FAIL
  (module missing).
- [ ] **Step 3: Implement** the interfaces above. Fix every caller of the removed helpers so that `npm run typecheck`
  passes. `MessageDetail` keeps compiling on the new helpers. Its full rework is Task 8.
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit**
  ```bash
  git add src/client/replyView.ts src/client/types.ts src/client/endpoints.ts src/client/feed.ts src/client/store.ts src/client/SessionProvider.tsx src/client/messageView.ts src/client/fixtures.ts src/views/Main.tsx src/views/MessageDetail.tsx src/views/MessageRow.tsx src/i18n/he.json src/i18n/en.json tests/replyView.test.ts tests/feed.test.ts tests/store.test.ts tests/messageView.test.ts
  git commit -m "Client: private reply data, rules, copy and fixtures"
  ```

---

### Task 7: client — the card's reply row, the actions Sheet and the reply Sheet (P48 phones 1, 1a, 1b)

**Files:**
- Create: `src/views/replies/ReplyRow.tsx`, `src/views/replies/ReplyBox.tsx`, `src/views/replies/ReplySheet.tsx`,
  `src/views/replies/CardActions.tsx`
- Modify: `src/views/MessageRow.tsx`, `src/views/Messages.tsx`, `src/kit/Composer.tsx`
- Test: `tests/replyView.test.ts` (logic). Visual check.

**Interfaces:**
- Consumes: Task 6 (`replyView.ts`, store actions, `Message` fields).
- Produces:
  - `Composer` gains `counterFrom?: number` (default 80% as today; replies pass 900) and `sendLabel?: string`.
  - `ReplyRow({message, unreadNew, onReply, onOpenReplies, preview?})`. It renders nothing when `countText` and
    `buttonState` are both empty.
    - Start: the count (`lock` 16, `heart` for blessings), followed by " · {m} חדשות" in bold pomegranate when
      `unreadNew > 0`. `unreadNew` comes from `state.inbox` by messageId.
    - End: a 40-high pill with a 48 hit area, 1.5 border in the type colour (tekhelet / pomegranate / ash), icon +
      label. Or "עניתם" with `check` in olive.
    - The count is in the card's accessibility label. The pill is a separate button named `reply.buttonA11y`.
    - The condolence count is ash and never animates.
  - `ReplyBox({message, onSent})`, shared by the Sheet and M3:
    - the heading;
    - the "אל מי" picker of `Chip size="filter"` (radio semantics). It shows only when `replyAdults.length >= 2`.
      "כל המשפחה" is preselected every time the box opens, then one chip per adult in the given order;
    - `Composer` with `lockLine` = `lockText` (the lock line is in the accessible description), `counterFrom={900}`,
      `maxCodePoints={1000}`;
    - send disabled while empty or over the limit, or offline (the existing offline line);
    - send calls `sendReply(m, body, to)` (`to` omitted for author or family).
    - On `already_replied`, `author_left`, `target_left` or `cannot_reply_to_own`, it hides itself and shows the
      Banner (`reply.authorGone` / `detail.familyGone`).
  - `ReplySheet({messageId, visible, onClose})`:
    - it fetches the single message for `replyAdults` / `replyBlocked`;
    - it shows "על: {title}" muted, then `ReplyBox`;
    - on send it closes and shows Toast `reply.toast` ("נשלחה");
    - focus is trapped and returns to the pill.
  - `CardActions({message, visible, onClose, onReply, onOpen})`:
    - a Sheet titled `actions.title`;
    - the first row is the type's reply label in tekhelet (only when `buttonState == 'reply'`), then "פתיחת ההודעה",
      then the existing actions (mute member, delete for the author or management);
    - it opens on `onLongPress` (`delayLongPress={500}`) and on web from a `more` button on the card;
    - an `accessibilityActions` entry `actions.title`.
  - Tapping the pill: `reply` → `ReplySheet`; `replied` → M3 at my reply. Tapping the count (author or family) → M3
    at "תשובות שהגיעו".

- [ ] **Step 1: Copy the frame.** If `design/mockups/frames/private-replies.html` is missing, the controller copies
  it from `/tmp/claude-1000/-home-ubuntu-work-kehilot/ac12f0a9-110e-49de-9fa1-025cbc22f86e/scratchpad/pub/private-replies.html`
  and commits it alone (`git add design/mockups/frames/private-replies.html`).
- [ ] **Step 2: Write the failing tests** in `tests/replyView.test.ts`:
  - `pill colour per kind` (`pillTone(type) -> 'tekhelet' | 'pomegranate' | 'ash'`);
  - `toChoices(m, t)`: `[]` for fewer than 2 adults; otherwise `[{key: 'family', label: 'כל המשפחה'}, ...adults]`.
- [ ] **Step 3: Run** `node --test tests/replyView.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** the components and wire `MessageRow` and `Messages`. If
  `src/views/compose/TemplatePreview.tsx` exists, render `<ReplyRow preview>` (a static count of 0 and a disabled
  pill) for a member author. Home rows and the weekly sheet stay without the count (§22.6).
- [ ] **Step 5: Run** `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 6: Visual check** (Global Constraints) of `p48-messages` (member), `p48-actions`, and `p48-sheet` with
  the picker and with a long text past 900. Use `role=member`, plus `role=listener` on `p48-messages` (count only) and
  `role=gabbai` (management הודעה with no row). Compare with P48 phones 1, 1a and 1b.
- [ ] **Step 7: Commit**
  ```bash
  git add src/views/replies/ReplyRow.tsx src/views/replies/ReplyBox.tsx src/views/replies/ReplySheet.tsx src/views/replies/CardActions.tsx src/views/MessageRow.tsx src/views/Messages.tsx src/kit/Composer.tsx src/client/replyView.ts tests/replyView.test.ts
  git commit -m "Client: reply row on the card, long-press actions and the reply Sheet (P48 1, 1a, 1b)"
  ```

---

### Task 8: client — M3: the box, my reply, received replies, can't-reply banners (P48 phones 2, 2a, 2b, 4)

**Files:**
- Create: `src/views/replies/ReceivedList.tsx`, `src/views/replies/MyReply.tsx`
- Modify: `src/views/MessageDetail.tsx`
- Test: `tests/replyView.test.ts`. Visual check.

**Interfaces:**
- Consumes: Tasks 6–7 (`ReplyBox`, `replyView`, store actions).
- Produces: `MessageDetail`, under the card and the join button:
  - The count line.
  - Then, for a recipient (`isRecipient`, or any visible reply with `personal`), `ReceivedList`:
    - heading `receivedTitle`, line `reply.onlyYou`;
    - replies newest first, each with the name in bold (or `reply.formerMember` when empty), `replyTime`, "· נערכה"
      when `updatedAt`, the text (`Txt content`), and an 8 px pomegranate dot plus an a11y label starting
      `reply.unreadA11y` when `unread`;
    - personal ones carry a pomegranate Tag `reply.personalTag` with `lock` after the name.
    
    After render it calls `markRepliesSeen(m, newest replyId)`. A push tap scrolls here.
  - Then, for a replier:
    - `MyReply`: an olive-edged Card with caption `sentText` (to the person, using `toName`, or to the family). It
      shows the text, then the text buttons "עריכה" and "מחיקה".
    - Edit reuses `Composer` prefilled with `sendLabel` "שמירה" and a "ביטול" button. There is no picker while
      editing.
    - Delete opens a confirm, `reply.deleteTitle` / `reply.deleteBody.general|family`.
    - A legacy multi-reply writer sees all their replies, and `MyReply` acts on `myReply` (the newest).
  - Otherwise, when `canReply`: `ReplyBox`.
  - When `replyBlocked`: the info Banner (`reply.authorGone` / `detail.familyGone`).
  - The message delete confirm uses `detail.deleteBodyReplies` with `{n} = replierCount` when n > 0, else
    `detail.deleteBody`.
  - `loadReplies` now runs for every message with `replyTo` or a target, for adults only.
- [ ] **Step 1: Write the failing tests** in `tests/replyView.test.ts`:
  - `deleteMessageBody` (n 0 → `detail.deleteBody`, n 3 → the replies text);
  - `receivedOrder` (newest first, personal tag flag);
  - `sentText` for a person with `toName` `שולמית ברקן` → `נשלחה אל שולמית ברקן בלבד · היום, 09:58`.
- [ ] **Step 2: Run** `node --test tests/replyView.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the M3 changes above.
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Visual check** of `p48-m3` (reply box to an author), `p48-condolence` (ash, "מילה למשפחה"),
  `p48-picker` (with a person chosen: heading and lock line change), `p48-author` (the author's own message with
  received replies and "· 2 חדשות"), and an edit state. Compare with P48 phones 2, 2a, 2b and 4.
- [ ] **Step 6: Commit**
  ```bash
  git add src/views/replies/ReceivedList.tsx src/views/replies/MyReply.tsx src/views/MessageDetail.tsx src/client/replyView.ts tests/replyView.test.ts
  git commit -m "Client: M3 private replies — box with recipient picker, my reply with edit and delete, received list (P48 2, 2a, 2b, 4)"
  ```

---

### Task 9: client — the mailbox under Me, the Me-tab badge, prefs line (P48 phones 3, 3a, 3b)

**Files:**
- Create: `src/views/me/Inbox.tsx`
- Modify: `src/client/meMap.ts`, `src/views/Me.tsx`, `src/views/Main.tsx`, `src/views/NotifyPrefs.tsx`
- Test: `tests/meInventory.test.ts`, `tests/replyView.test.ts`. Visual check.

**Interfaces:**
- Consumes: Task 6 (`state.inbox`, `loadInbox`, `markRepliesSeen`, `threadLine`, `readUpTo`, `mailboxStatus`), Task 8
  (`ReceivedList` row rendering for up to three replies).
- Produces:
  - `meLayout(role)`: section `mine` starts with `{id: 'replies', kind: 'nav'}` for `isAdult(role)` only.
  - Me renders it as `NavRow icon="lock" title={t('inbox.row')} status={mailboxStatus} badge={unread}`.
  - Main:
    - nav tab `'inbox'` (from `'me'`, active tab `me`, back label "אני");
    - the Me tab's `badge` = `state.inbox?.unread ?? 0` for adults (no Me badge in management tabs);
    - `loadInbox()` on Kehila start and on app focus.
  - `Inbox({onBack, onOpen})`:
    - back "› אני", title `inbox.title`, line `inbox.privacy`;
    - one card per thread (newest activity first) with the type's stripe, the title, `threadLine`, up to three
      replies (as `ReceivedList` rows, personal Tag included), and "עוד {n} תשובות" → M3 when `total > 3`;
    - it calls `markRepliesSeen(m, readUpTo(thread))` when non-null;
    - empty: `inbox.rowEmpty`;
    - a replier's name links to the phone list entry when the phone list (already loaded by `PhoneList` data, §18.2a)
      has that user. Otherwise it is plain text.
  - `NotifyPrefs`: the locked line uses the new `prefs.locked`.
- [ ] **Step 1: Write the failing tests:**
  - `tests/meInventory.test.ts`: `replies row for member, gabbai and tech, not for listener`.
  - `tests/replyView.test.ts`: `mailboxStatus` for unread 3 → `3 חדשות`, unread 0 with threads → `אין חדשות`, no
    threads → `עוד לא הגיעו תשובות`; the spouse example (A sees 11 with 2 personal, B sees 10 with 1).
- [ ] **Step 2: Run** `node --test tests/meInventory.test.ts tests/replyView.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the interfaces above.
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Visual check** of `me` (the row with its badge, and the Me tab badge), `p48-inbox`, `p48-inbox-a`
  (שולמית: 11, 2 personal), `p48-inbox-b` (יגאל: 10, 1 personal), and the empty mailbox. Include the 1280 width
  (680 column). Compare with P48 phones 3, 3a and 3b.
- [ ] **Step 6: Commit**
  ```bash
  git add src/views/me/Inbox.tsx src/client/meMap.ts src/views/Me.tsx src/views/Main.tsx src/views/NotifyPrefs.tsx src/client/replyView.ts tests/meInventory.test.ts tests/replyView.test.ts
  git commit -m "Client: private replies mailbox under Me with unread badge (P48 3, 3a, 3b)"
  ```

---

### Task 10: deploy to dev (controller; the owner runs `terraform apply`)

The controller runs this, not a subagent. No new infrastructure: the API is `ANY /v1/{proxy+}`, the table and its TTL
(`expiresAt`) exist, and the push worker shares the zip.

- [ ] **Step 1: Run everything:** `npm test`, `npm run typecheck`, `npm run test:server`. Expected: all green. Report
  the counts.
- [ ] **Step 2: Final whole-branch review (Opus)** against §22, this plan's Review Focus and the Task 4 checklist.
  Also check the templates-sheet overlap if its Tasks 4–5 have landed:
  - `update_message` answers with viewer fields;
  - `_process` accepts `reply` and `message_update`;
  - list merge, then viewer fields.
  
  Fix the findings and re-run Step 1.
- [ ] **Step 3: Build:** `python3 tools/build_lambda.py`, then `cd infra/envs/dev && terraform plan -out dev.tfplan`.
  Read the plan: only the Lambda code hashes of api, push and jobs may change. If anything else changes, stop and
  report.
- [ ] **Step 4: Hand off:** give the owner `! cd ~/work/kehilot/infra/envs/dev && terraform apply dev.tfplan` and
  wait.
- [ ] **Step 5: After the apply:**
  1. Run `AWS_DEFAULT_REGION=il-central-1 .venv/bin/python tools/migrate_private_replies.py --env dev` (dry run).
     Read the counts.
  2. Run it again with `--apply`.
  3. Run `.venv/bin/python tools/smoke_dev.py` and expect all PASS.
  4. Run `npm run deploy:web`.
- [ ] **Step 6: Report** to the owner:
  - what was deployed, the migration counts and the smoke result;
  - what to try on the phone: reply to a member's הודעה, a mazal tov to one spouse, the mailbox and badge on both
    spouses' phones, and the 15-minute push;
  - the CTO ruling (management mazal tov and condolence keep blessings) awaiting confirmation;
  - what was not checked: real devices, the long-press gesture, screen readers, English, and the iOS/Android push
    display.
  
  No `git push` without the owner.
