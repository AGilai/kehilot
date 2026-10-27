# Message types in one main channel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** mazal tov / condolences become message types inside the one main channel, with per-Kehila
post and guest-visibility rules.

**Architecture:** all rules live in `server/cloud/visibility.py` (the only place that decides who may see
or post). Routes, the change feed and the push worker pass the Kehila's `typeRules` in. The client gets
`postableTypes` per channel and a gabbai settings section.

**Tech Stack:** Python 3.12 Lambda + DynamoDB (moto in tests), Expo/React Native + react-native-web.

**Spec:** `docs/superpowers/specs/2026-10-27-message-types-design.md` (binding). Design: `docs/UX-DESIGN.md`
§12 and the frames it names.

## Global Constraints

- Types: `weekly`, `event`, `general`, `celebration`, `condolence` (+ `chat` in conversation channels only).
- `typeRules` defaults: `celebration` and `condolence` → `{post: 'broadcasters', listeners: false}`.
  `weekly`/`event` → gabbaim only, guests see. `general` → broadcasters, guests see. Only the two are configurable.
- A missing / malformed stored rule is read as the default (never as "allow").
- Hidden and missing messages both answer 404 `message_not_found`.
- No PII in logs; push `data` stays `{kehila, messageId}`. Invented names only in tests/fixtures/smoke.
- Server tests: `.venv/bin/python -m unittest discover -s server/tests`. Client: `npm test`, `npm run typecheck`.

## Review Focus

1. A listener reading a hidden-type message by every path: GET message, change feed (message, join,
   reply_count kinds), push fan-out. Expect: never visible, 404 on GET.
2. Gabbai flips `listeners` on, then off: past messages follow the current setting.
3. Member with `canBroadcast` but rule `management`: `celebration` → 403, `general` → 201; daily limit
   still applies.
4. Stored garbage in `typeRules` (wrong types, unknown keys): treated as defaults, settings PUT rejects it.
5. Existing Kehila with `simchas` channel holding messages: merge command leaves it and reports it.

---

### Task 1: visibility rules for types (server)

**Files:** `server/cloud/visibility.py`, `server/cloud/routes_messages.py`, `server/cloud/routes_changes.py`,
`server/cloud/push_worker.py`, `server/cloud/push.py` (MESSAGE_TYPES + `general`), a new
`server/cloud/type_rules.py`, tests under `server/tests/cloud/`.

**Interfaces — Produces:**
- `type_rules.rules(settings: dict) -> dict` — normalized `{celebration: {post, listeners}, condolence: {…}}`
  with defaults for anything missing or malformed.
- `type_rules.postable_types(membership, channel, rules) -> list[str]` (in the TYPES order; `[]` for a
  conversation channel or when nothing is allowed).
- `visibility.can_post(membership, channel, type_=None, rules=None)` — `type_=None` keeps today's channel-level
  meaning (used by chat and by `canPost` in the channel list).
- `visibility.message_visible(membership, channel, message, rules=None)` — `rules=None` means defaults.
- `routes_messages.TYPES = ('weekly', 'event', 'general', 'celebration', 'condolence')`.
- Channel list items gain `postableTypes`.

- [ ] Tests first: `type_rules` (defaults, malformed → default, configured), `postable_types` (gabbai all five;
      member with canBroadcast on a broadcasters channel → `general` + allowed of the two; member without
      canBroadcast → `[]`; listener → `[]`; `management` channel → `[]` for members; conversation → `[]`).
- [ ] Tests: `message_visible` hides `celebration`/`condolence` from a listener unless `listeners: true`;
      members/gabbaim always; other types unchanged.
- [ ] Route tests: POST message enforces the type rule (403 `forbidden`); GET message 404 for a hidden type;
      change feed omits it for a listener (all kinds that carry the message); push worker skips listeners
      for hidden types. Settings come from `ctx.repo.get_kehila(k)['settings']`.
- [ ] Existing tests that rely on the seeded `simchas` channel: give the test base an explicit extra
      channel (`put_channel(k, 'simchas', False, 'broadcasters')`) so those tests keep testing replies, not
      seeding. Do not weaken any assertion.
- [ ] Implement; full server suite green; commit.

### Task 2: settings, seeding, merge command (server + tool)

**Files:** `server/cloud/routes_admin.py` (`set_settings`), `server/cloud/repo_members.py`
(`set_settings`, `DEFAULT_CHANNELS`), `server/cloud/routes_core.py` (settings shown to the gabbai),
`tools/kehila_admin.py` (new `merge-channels` subcommand), `server/API.md`, tests.

**Interfaces — Consumes:** `type_rules.rules`. **Produces:** `PUT …/settings` accepts
`typeRules: {celebration?: {post, listeners}, condolence?: {…}}` (strict: unknown type/key/value → 400
`invalid_type_rules`); the gabbai's kehila view returns normalized `typeRules`.

- [ ] Tests first: PUT valid / partial / invalid bodies; GET returns normalized rules; a non-gabbai gets 403.
- [ ] `DEFAULT_CHANNELS = (('announcements', True, 'broadcasters'),)`; test a new Kehila has exactly one channel.
- [ ] `merge-channels [--apply] [--kehila ID]`: for each Kehila, `simchas`/`condolences` channels with no
      messages are deleted (with --apply); with messages → printed and kept; main channel postPolicy →
      `broadcasters`. Dry run prints the plan only. Prints ids and counts, never names. Tests with moto.
- [ ] API.md: types, typeRules, postableTypes. Commit.

### Task 3: client (types, Compose, gabbai settings, chips)

**Files:** `src/client/types.ts`, `src/client/endpoints.ts`, `src/views/Compose.tsx`, the gabbai settings
screen (GD3), Messages chip row, `src/i18n/he.json` / `en.json`, `src/client/fixtures.ts`, tests.

**Interfaces — Consumes:** channel `postableTypes`; settings `typeRules`; PUT settings.
- [ ] Per §12: Compose lists only `postableTypes` (no picker for one); 403 shows §12's toast. GD3 "Message
      types" section saves via PUT settings. Chip row per §12. `general` labels he/en.
- [ ] Messages filter (spec 8a): free text + multi-select types, combined; pure filter function
      test-first (AND text×types, OR within types, empty selection = all, Hebrew/English text, niqqud-insensitive
      if the existing search is).
- [ ] Fixtures: one main channel + a group, `postableTypes` per role.
- [ ] Pure logic test-first (type list for compose, settings form → body). `npm test`, typecheck. Commit.

### Task 4: role tags (server)

**Files:** `server/cloud/repo_members.py` (or a new `repo_tags.py` mixin, following the repo's mixin
pattern), `server/cloud/routes_admin.py`, `server/cloud/handler.py`, `server/cloud/export.py`,
`server/API.md`, tests.

**Produces:** gabbai routes `GET/POST /v1/kehilot/{k}/admin/tags`, `PUT/DELETE …/admin/tags/{tagId}`
(`{name}`; 400 `invalid_tag_name`, 409 `tag_exists` / `too_many_tags`, 404 `tag_not_found`), and
`PUT …/admin/members/{userId}/tags` (`{tagIds: [...]}`, unknown id → 400 `invalid_tag_ids`). Member
JSON (admin list, and wherever §12 shows chips: e.g. phone list, `me`) gains `tags: [{tagId, name}]`.
Deleting a tag removes it from every membership. Tags grant nothing: a test proves `can_post` /
`message_visible` ignore them. Export includes the person's own tag names.

- [ ] Tests first (limits, uniqueness case-insensitive after trim, non-gabbai 403, delete cascades,
      listener can hold tags or not — follow §12). Implement; suite green; commit.

### Task 5: role tags (client)

Per §12 "Role tags": tag management, assignment from the member sheet, chips where §12 says, starter
set, he/en copy, fixtures. Pure logic test-first; `npm test`, typecheck; commit.

### Task 6: smoke, deploy, migrate dev (controller)

- [ ] `tools/smoke_dev.py`: stop using the `simchas` channel; add the spec's three smoke checks, and a
      tag create → assign → appears → delete cycle (cleaned up).
- [ ] Build, plan (expect only Lambda code changes), apply, `merge-channels` dry run then `--apply` on dev,
      web deploy, smoke.
