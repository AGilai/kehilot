# Kehilot Plan 2a: Kehila core and messaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dev API a working multi-tenant community backend: create a Kehila, join it through invite
links, approve and classify members, set roles and broadcast rights, post messages to channels, send private
replies to a family, poll cheaply for changes, and deliver generic push notifications in each user's language.

**Architecture:** Builds on plan 1's `server/cloud/` package (router, `require()`, `Repo`). New route modules
per concern, one visibility module that every read path calls, a change feed in DynamoDB, an SQS queue and a
`push-worker` Lambda, and a `jobs` Lambda run by EventBridge Scheduler. API errors become codes (spec §3b).

**Tech Stack:** Python 3.12 Lambdas, boto3, moto, `unittest`; Terraform 6.70.0 provider; Expo Push HTTP API.

**Spec:** `docs/superpowers/specs/2026-10-26-aws-architecture-design.md` (§3a product rules, §3b languages,
§4.3 API, §4.4 data, §4.5 notifications, §4.5b account deletion, §4.6 jobs). Plan 1:
`docs/superpowers/plans/2026-10-26-foundation-dev-environment.md` (its Interfaces are the starting point).

**Not in this plan:** family profiles, roster, aliyah, healing prayers, seating and the seat map (plan 2b,
after the seat-map design); CORS and the app (plan 3); Cognito localized emails, SES, prod (plans 3–4).

## Global Constraints

Everything in plan 1's Global Constraints still applies (region, `kehilot-<env>-` names, `/kehilot/` role
path plus boundary, no PII in logs, ULID IDs, `K#<k>` key prefix). In addition:
- **Error responses are codes**: `{"error": "<snake_case_code>"}`. The app translates them. No Hebrew or
  English sentences in API errors.
- **Visibility is decided only in `server/cloud/visibility.py`.** Every route and the change feed that returns
  messages, replies or channels calls it. The route modules never decide visibility themselves.
- **Private replies** are visible only to their author and the message's `targetMemberId`. Gabbaim never see
  them unless they are one of those two (spec §3a, user decision).
- **Listeners** see only channels with `listenersCanRead = true`. They cannot post, reply, create invites or
  see the member list.
- **Push payloads** carry `{kehila, messageId}` or `{kehila, screen}` only. `title` is the Kehila's name. The
  body is generic, in the recipient's language, and chosen by message type (he / en): weekly "עדכון שבועי מהקהילה" /
  "Weekly update from your community"; celebration "מזל טוב חדש בקהילה" / "New mazal tov in your community";
  condolence "הודעת אבל בקהילה" / "Condolence notice in your community"; event "אירוע חדש בקהילה" / "New event in
  your community"; unknown type "הודעה חדשה בקהילה" / "New message in your community"; reply "ברכה חדשה" / "New
  blessing"; request "בקשת הצטרפות חדשה" / "New membership request".
- **Kehila settings defaults:** `pollSeconds` 30 (dev 5), `memberBroadcastDefault` false,
  `broadcastDailyLimit` 3, `defaultLang` "he". Supported `lang` values: `he`, `en`.
- **Default channels** made by the admin CLI: `announcements` (listeners can read, management posts),
  `simchas` and `condolences` (members only; members with `canBroadcast` may post). Message types: `weekly`,
  `celebration`, `condolence`, `event` (Noam's categories).
- Request bodies: JSON objects only, max 16 KB; `isBase64Encoded` bodies are decoded. Text limits: title
  120, body 4000, reply 1000, names 60 characters.

## Review Focus

1. **A listener or non-member pulls a members-only message** through `/changes`, `GET .../messages`, or
   `GET .../messages/{id}` → it never appears. Tests in Task 4 (`test_listener_cannot_read_members_channel`)
   and Task 6 (`test_changes_hide_members_channel_from_listener`).
2. **A private reply leaks** to another member, a gabbai, or through the change feed → only the author and the
   target see it. Tests in Task 5 (`test_gabbai_cannot_see_private_reply`) and Task 6
   (`test_changes_hide_private_reply_from_others`).
3. **Two people accept the last use of an invite at once** → exactly one succeeds. Task 2
   (`test_last_invite_use_is_consumed_once`).
4. **An invite past `expiresAt` that DynamoDB TTL has not deleted yet** → `410 invite_expired`. Task 2
   (`test_expired_invite_rejected_before_ttl_deletes_it`).
5. **A client polls with a cursor older than the 30-day change retention** → `{"resync": true}`, not a silent
   gap. Task 6 (`test_old_cursor_requests_resync`).

---

## File Structure

| Path | Responsibility |
|---|---|
| `server/cloud/errors.py` | `ApiError(status, code)`; replaces `server.validation.APIError` inside `server/cloud` |
| `server/cloud/inputs.py` | `body_object`, `text`, `choice`, `boolean`, `integer`; raise `ApiError(400, "invalid_<field>")` |
| `server/cloud/visibility.py` | `can_read_channel`, `can_post`, `message_visible`, `reply_visible`, `change_visible` |
| `server/cloud/repo.py` | keeps plan 1 methods; gains generic helpers (`query_prefix`, `transact`) |
| `server/cloud/repo_members.py` | `MembersRepo` mixin: profile, devices, invites, memberships, requests |
| `server/cloud/repo_messages.py` | `MessagesRepo` mixin: channels, messages, replies, joins, reads, changes, broadcast counters |
| `server/cloud/routes_me.py` | `/v1/me`, profile, language, devices, account deletion |
| `server/cloud/routes_invites.py` | create, preview (public), accept |
| `server/cloud/routes_admin.py` | requests, approve/reject, members, roles, broadcast permissions, channels |
| `server/cloud/routes_messages.py` | channels list, messages, joins, replies, reads, preferences |
| `server/cloud/routes_changes.py` | `/changes?since=` |
| `server/cloud/push.py` | `enqueue(kind, kehila, ref)` → SQS; `PUSH_TEXT` per language |
| `server/cloud/push_worker.py` | SQS Lambda handler: recipients, Expo send, tickets |
| `server/cloud/expo.py` | `send(messages) -> list[ticket]`, `receipts(ids) -> dict` (urllib) |
| `server/cloud/jobs.py` | Scheduler Lambda handler: push receipts and token pruning |
| `tools/kehila_admin.py` | platform-admin CLI: create Kehila + default channels + first gabbai invite |
| `infra/modules/push/`, `infra/modules/jobs/` | SQS + DLQ + worker; Scheduler + jobs Lambda |
| `server/API.md` | v2 contract section for every route in this plan |

Data items added (all keys per spec §4.4, IDs are ULIDs):

| Item | PK | SK | Main attributes |
|---|---|---|---|
| Profile | `U#<userId>` | `PROFILE` | `firstName`, `lastName`, `lang` |
| Device | `U#<userId>` | `D#<token>` | `platform`, `lastSeen`; GSI1 `TOK#<token>` / `U#<userId>` (find the owner when a token moves) |
| Kehila | `K#<k>` | `META` | plan 1 + `settings` map |
| Channel | `K#<k>` | `C#<channelId>` | `name`, `listenersCanRead`, `postPolicy` (`management` \| `broadcasters`) |
| Membership | `K#<k>` | `M#<userId>` | plan 1 + `canBroadcast`, `notify` map, `displayName`, `rejectedAt` |
| Request | `K#<k>` | `REQ#<userId>` | `displayName`, `createdAt` |
| Invite | `INV#<code>` | `META` | `kehilaId`, `inviterId`, `role` (`listener` \| `gabbai`), `usesLeft`, `expiresAt` |
| Message | `K#<k>` | `MSG#<msgId>` | `channelId`, `type`, `title`, `body`, `authorId`, `authorName`, `authorKind`, `targetMemberId`, `joinCount`, `removed` |
| Reply | `K#<k>#MSG#<msgId>` | `R#<replyId>` | `authorId`, `authorName`, `body` |
| Join | `K#<k>#MSG#<msgId>` | `J#<userId>` | (existence = joined) |
| Read | `K#<k>#U#<userId>` | `READ#<msgId>` | `at` |
| Change | `K#<k>` | `CHG#<changeId>` | `kind`, `refId`, `channelId`, `visibleTo` (list or absent), `expiresAt` = +30 days |
| Broadcast counter | `K#<k>` | `BC#<userId>#<yyyy-mm-dd>` | `count`, `expiresAt` = +2 days |
| Push ticket | `PUSHTKT` | `T#<ticketId>` | `token`, `userId`, `expiresAt` = +1 day |

---

### Task 1: Error codes, input parsing, profile, language and devices

**Files:**
- Create: `server/cloud/errors.py`, `server/cloud/inputs.py`, `server/cloud/repo_members.py`,
  `server/cloud/routes_me.py`, `server/tests/cloud/test_me.py`
- Modify: `server/cloud/authz.py`, `server/cloud/handler.py`, `server/cloud/routes_core.py`,
  `server/cloud/repo.py`, `server/tests/cloud/test_handler.py` (expect codes)

**Interfaces:**
- Produces:
  - `class ApiError(Exception)` with `status: int`, `code: str`. Plan 1 codes become: `invalid_kehila_id`
    (400), `kehila_not_found` (404), `forbidden` (403), `not_found` (404), `method_not_allowed` (405),
    `invalid_json` (400), `internal` (500).
  - `inputs.body_object(ctx) -> dict` (400 `invalid_body` if the body is not a JSON object or is over 16 KB);
    `text(d, field, maximum, required=False) -> str`; `choice(d, field, options) -> str`;
    `boolean(d, field) -> bool`; `integer(d, field, lo, hi) -> int`.
  - `handler` decodes `isBase64Encoded` bodies; `Ctx` keeps `body` as the raw str (parsed by `body_object`).
  - `Repo` now inherits `MembersRepo`. Methods: `get_profile(user_id) -> dict | None`,
    `put_profile(user_id, first, last, lang)`, `put_device(user_id, token, platform)` (deletes the token from
    any other user first, found through GSI1 `TOK#<token>`), `delete_device(user_id, token)`,
    `list_devices(user_id) -> list[dict]`.
  - Routes:
    - `GET /v1/me` adds `profile` (`{firstName, lastName, lang}` or null).
    - `PUT /v1/me/profile {firstName, lastName, lang}` → 200 profile.
    - `PUT /v1/me/devices {token, platform: ios|android|web}` → 204. The token must match
      `^ExponentPushToken\[[A-Za-z0-9_-]{10,}\]$`.
    - `DELETE /v1/me/devices/{token}` → 204.
- [ ] **Step 1: Update `test_handler.py`** to expect codes (`kehila_not_found`, `invalid_kehila_id`, …). Write
  `test_me.py`:
  - `test_profile_roundtrip_with_lang`
  - `test_profile_rejects_unknown_lang` (`fr` → 400 `invalid_lang`)
  - `test_device_moves_between_users` (user B registers A's token → A's list empty, B's has it)
  - `test_bad_token_format_is_400`
  - `test_base64_body_decoded`
  - `test_body_over_16kb_is_400`
- [ ] **Step 2: Run** `.venv/bin/python -m unittest discover -s server/tests` → the new and updated tests fail.
- [ ] **Step 3: Implement.** In `test_handler.py`, keep plan 1's injection by patching `handler._repo`.
- [ ] **Step 4: Run** → all pass (plan 1's 103 tests included).
- [ ] **Step 5: Commit.**

### Task 2: Admin CLI, invites and joining

**Files:**
- Create: `tools/kehila_admin.py`, `server/cloud/routes_invites.py`, `server/tests/cloud/test_invites.py`
- Modify: `server/cloud/repo_members.py`, `server/cloud/handler.py` (public route), `infra/modules/api/main.tf`
  (public route `GET /v1/invites/{code}`)

**Interfaces:**
- Consumes: `ApiError`, `inputs`, `require`, `new_id`.
- Produces:
  - `MembersRepo.create_kehila(name, settings) -> k`, which also writes the three default channels. Then
    `create_invite(k, inviter_id, role, uses, days) -> code`, where the code is 10 Crockford characters from
    `secrets`. `get_invite(code)`. `accept_invite(code, user_id, display_name, now) -> membership`: one
    `TransactWriteItems` that updates the invite with `usesLeft > :0 AND expiresAt > :now` (decrementing it)
    and puts the membership with `attribute_not_exists(sk)`.
  - CLI: `.venv/bin/python tools/kehila_admin.py create --env dev --name "<name>" [--lang he]` prints the
    Kehila ID and a one-use, 7-day `gabbai` invite code. It reads the table name from `terraform output`.
  - Routes:
    - `POST /v1/kehilot/{k}/invites {uses: 1..50 = 10, days: 1..30 = 7}`: members and gabbaim only, role
      `listener`. Returns 201 `{code, expiresAt}`.
    - `GET /v1/invites/{code}`: public. 200 `{kehilaName}`. Returns 404 `invite_not_found` and 410
      `invite_expired` (also when no uses are left).
    - `POST /v1/invites/{code}/accept`: requires a profile (409 `profile_required`). Returns 200
      `{kehilaId, role}`, or 409 `already_member`.
- [ ] **Step 1: Write `test_invites.py`:**
  - `test_member_creates_listener_invite`
  - `test_listener_cannot_create_invite` (403)
  - `test_preview_is_public_and_shows_only_name` (body keys == `{"kehilaName"}`)
  - `test_accept_makes_listener`
  - `test_gabbai_invite_makes_gabbai`
  - `test_last_invite_use_is_consumed_once`: `usesLeft=1`, two users accept, one gets 200 and the other 410
  - `test_expired_invite_rejected_before_ttl_deletes_it`
  - `test_accept_twice_is_409`
  - `test_accept_without_profile_is_409`
- [ ] **Step 2: Run** → fail. **Step 3: Implement** (the CLI too). **Step 4: Run** → pass.
- [ ] **Step 5: Commit.**

### Task 3: Membership requests, approval, members and broadcast rights

**Files:**
- Create: `server/cloud/routes_admin.py`, `server/tests/cloud/test_admin.py`
- Modify: `server/cloud/repo_members.py`

**Interfaces:**
- Produces routes (all `require(..., ('gabbai',))` except the first):
  - `POST /v1/kehilot/{k}/membership-request`: listener only. Returns 202, or 409 `already_requested`.
    Enqueues push kind `request` to the gabbaim (Task 7's `push.enqueue`; until Task 7 exists it is a no-op
    stub with the same signature).
  - `GET /v1/kehilot/{k}/admin/requests` → `[{userId, displayName, createdAt, previouslyRejected}]`.
  - `POST /v1/kehilot/{k}/admin/requests/{userId}/approve {classification: "" | "א" | "קבוע"}`: one
    transaction sets role `member`, the classification and `canBroadcast` = `settings.memberBroadcastDefault`,
    and deletes the request.
  - `POST /v1/kehilot/{k}/admin/requests/{userId}/reject`: deletes the request and sets `rejectedAt`. The
    listener stays a listener and may request again.
  - `GET /v1/kehilot/{k}/admin/members` → `[{userId, displayName, role, classification, canBroadcast}]`.
  - `PUT /v1/kehilot/{k}/admin/members/{userId} {role?, classification?, canBroadcast?}`. A gabbai cannot
    demote the Kehila's last gabbai (409 `last_gabbai`).
  - `PUT /v1/kehilot/{k}/admin/broadcast {allow: bool}`: sets `canBroadcast` on every member and
    `settings.memberBroadcastDefault`.
  - `DELETE /v1/kehilot/{k}/admin/members/{userId}`: removes the membership (the person leaves the Kehila).
  - `DELETE /v1/kehilot/{k}/membership`: a member leaves on their own. The last gabbai gets 409.
- [ ] **Step 1: Write `test_admin.py`:**
  - `test_listener_requests_and_gabbai_approves_with_classification`
  - `test_member_cannot_see_requests` (403)
  - `test_approve_uses_kehila_broadcast_default`
  - `test_reject_then_rerequest_flags_previously_rejected`
  - `test_bulk_broadcast_block_all_then_allow_one`
  - `test_last_gabbai_cannot_be_demoted_or_leave`
  - `test_gabbai_of_other_kehila_cannot_approve` (404)
- [ ] **Step 2: Run** → fail. **Step 3: Implement.** **Step 4: Run** → pass. **Step 5: Commit.**

### Task 4: Channels, visibility and messages

**Files:**
- Create: `server/cloud/visibility.py`, `server/cloud/repo_messages.py`, `server/cloud/routes_messages.py`,
  `server/tests/cloud/test_visibility.py`, `server/tests/cloud/test_messages.py`
- Modify: `server/cloud/routes_admin.py` (channel admin)

**Interfaces:**
- Produces:
  - `visibility.can_read_channel(membership, channel) -> bool`: listeners need `listenersCanRead`.
  - `visibility.can_post(membership, channel) -> bool`: a gabbai always can. A member needs
    `postPolicy == "broadcasters"` and `canBroadcast`. A listener never can.
  - `visibility.message_visible(membership, channel, message) -> bool`: `can_read_channel`, and the message
    is not `removed`.
  - Routes:
    - `GET /v1/kehilot/{k}/channels` returns only the readable ones.
    - `POST|PUT /v1/kehilot/{k}/admin/channels[/{c}] {name, listenersCanRead, postPolicy}` (gabbai).
    - `POST /v1/kehilot/{k}/messages {channelId, type, title, body, targetMemberId?}` → 201 message.
      `targetMemberId` is allowed only for `celebration`/`condolence` and must be a member of the same Kehila.
      A member's daily broadcasts are counted with a conditional `ADD` on the `BC#` item, so going over
      `broadcastDailyLimit` gets 429 `broadcast_limit`. `authorKind` is `management` for a gabbai and
      `member` otherwise. The route writes a change item and enqueues push kind `message`.
    - `GET /v1/kehilot/{k}/messages?before=<msgId>&limit=1..50` returns visible messages, newest first.
    - `GET /v1/kehilot/{k}/messages/{id}` returns 404 `message_not_found` when the message is not visible.
    - `DELETE /v1/kehilot/{k}/messages/{id}`: the author or a gabbai. It sets `removed`, writes a change, and
      returns 204.
    - `POST /v1/kehilot/{k}/messages/{id}/join` (blessing count; idempotent through `J#<userId>`
      `attribute_not_exists`, with `joinCount` incremented in the same transaction) → `{joinCount, joined: true}`.
    - `POST /v1/kehilot/{k}/messages/{id}/read` → 204; writes a change with `visibleTo=[userId]`.
- [ ] **Step 1: Write the tests.** `test_visibility.py` is a truth table over role × `listenersCanRead` ×
  `postPolicy` × `canBroadcast`. `test_messages.py`:
  - `test_gabbai_posts_to_announcements`
  - `test_member_without_broadcast_right_gets_403`
  - `test_listener_cannot_read_members_channel` (list, by id, and by direct id guess)
  - `test_broadcast_daily_limit_429`
  - `test_target_member_must_be_in_same_kehila`
  - `test_author_and_gabbai_can_remove_others_cannot`
  - `test_join_is_idempotent`
  - `test_pagination_before_cursor`
- [ ] **Step 2: Run** → fail. **Step 3: Implement.** **Step 4: Run** → pass. **Step 5: Commit.**

### Task 5: Private replies

**Files:**
- Create: `server/tests/cloud/test_replies.py`
- Modify: `server/cloud/visibility.py`, `server/cloud/repo_messages.py`, `server/cloud/routes_messages.py`

**Interfaces:**
- Produces:
  - `visibility.reply_visible(user_id, message, reply) -> bool`: true when `user_id` is `reply.authorId` or
    `message.targetMemberId`.
  - Routes:
    - `POST /v1/kehilot/{k}/messages/{id}/replies {body}`: members and gabbaim. Only on messages that have a
      `targetMemberId`; otherwise 409 `replies_not_allowed`. The target cannot reply to their own message
      (409). Writes a change with `visibleTo=[authorId, targetMemberId]` and enqueues push kind `reply` (to
      the target only).
    - `GET /v1/kehilot/{k}/messages/{id}/replies` returns only the replies visible to the caller.
- [ ] **Step 1: Write `test_replies.py`:**
  - `test_target_sees_all_replies`
  - `test_author_sees_only_own_reply`
  - `test_other_member_sees_none`
  - `test_gabbai_cannot_see_private_reply`
  - `test_reply_on_untargeted_message_409`
  - `test_listener_cannot_reply`
- [ ] **Step 2: Run** → fail. **Step 3: Implement.** **Step 4: Run** → pass. **Step 5: Commit.**

### Task 6: Change feed and notification preferences

**Files:**
- Create: `server/cloud/routes_changes.py`, `server/tests/cloud/test_changes.py`
- Modify: `server/cloud/visibility.py`, `server/cloud/repo_messages.py`, `server/cloud/routes_messages.py`

**Interfaces:**
- Produces:
  - `visibility.change_visible(user_id, membership, channels_by_id, change) -> bool`: when `visibleTo` is set,
    the user must be in it; otherwise the change's channel must be readable.
  - `GET /v1/kehilot/{k}/changes?since=<changeId>` → `{cursor, more, changes: [{kind, id, item}]}`.
    - `kind` is one of `message`, `message_removed`, `reply`, `read`, `join`. `item` is the current visible
      object (messages and replies through `BatchGetItem`).
    - It returns at most 200 changes, with `more` set when there are others.
    - With no `since` it returns `{cursor: <latest>, changes: []}`; the app loads lists through the list routes.
    - A `since` that is not a ULID gets 400. A `since` older than 30 days gets `{"resync": true}`.
  - `GET /v1/kehilot/{k}` adds `settings.pollSeconds` (the app's poll interval).
  - `PUT /v1/kehilot/{k}/me/notify {mutedChannels: [c], mutedTypes: [t], membersBroadcasts: "all" | "management_only", mutedMembers: [userId]}`
    → 200. It stores the values on the membership. They affect pushes only (spec §3a).
- [ ] **Step 1: Write `test_changes.py`:**
  - `test_new_message_appears_after_cursor`
  - `test_changes_hide_members_channel_from_listener`
  - `test_changes_hide_private_reply_from_others`
  - `test_read_mark_only_to_reader`
  - `test_removed_message_reported_without_content`
  - `test_old_cursor_requests_resync`
  - `test_more_flag_and_paging`
  - `test_notify_prefs_validate_ids`
- [ ] **Step 2: Run** → fail. **Step 3: Implement.** **Step 4: Run** → pass. **Step 5: Commit.**

### Task 7: Push enqueue and push worker

**Files:**
- Create: `server/cloud/push.py`, `server/cloud/expo.py`, `server/cloud/push_worker.py`,
  `server/tests/cloud/test_push.py`
- Modify: the routes that call the stub `push.enqueue` (no signature change)

**Interfaces:**
- Produces:
  - `push.enqueue(kind: "message" | "reply" | "request", kehila: str, ref: str) -> None`: sends
    `{"kind", "kehila", "ref"}` to the queue URL in env `PUSH_QUEUE_URL`. It is a no-op when the variable is
    unset, which is the case in unit tests unless a test sets it.
  - `PUSH_TEXT: dict[str, dict[str, str]]` keyed `[kind][lang]`, with exactly the strings in Global
    Constraints.
  - `push_worker.recipients(repo, kind, kehila, ref) -> list[str]` (user IDs):
    - `message`: members who can read the channel, minus the author, `mutedChannels`, `mutedTypes` and
      `mutedMembers`, and minus `management_only` people when `authorKind == "member"`.
    - `reply`: `[targetMemberId]`.
    - `request`: the gabbaim.
  - `push_worker.handler(event, context) -> {"batchItemFailures": [...]}`:
    - It sends to Expo in chunks of 100 messages, each `{to, title: "", body: PUSH_TEXT[kind][lang], data, sound: "default"}`.
    - It deletes devices whose ticket error is `DeviceNotRegistered` and stores `ok` ticket IDs as `PUSHTKT`
      items.
    - On an Expo HTTP error it reports the record as failed and calls `ChangeMessageVisibility` with
      `min(900, 30 * 2**receiveCount)`.
  - `expo.send(messages, token: str | None) -> list[dict]` and `expo.receipts(ids, token) -> dict`. The token
    comes from SSM `/kehilot/<env>/expo-access-token` and is cached per container. The value `"none"` means
    no Authorization header.
- [ ] **Step 1: Write `test_push.py`** with moto SQS and a fake `expo.send`:
  - `test_recipients_respect_channel_and_mutes`
  - `test_management_only_skips_member_broadcast`
  - `test_reply_push_goes_to_target_only`
  - `test_text_in_recipient_language` (one `he` and one `en` user)
  - `test_payload_has_no_message_content` (`data` keys ⊆ `{kehila, messageId, screen}`, and `body` is one of
    `PUSH_TEXT`)
  - `test_device_not_registered_deleted`
  - `test_expo_http_error_reports_batch_failure`
- [ ] **Step 2: Run** → fail. **Step 3: Implement**, replacing the stub. **Step 4: Run** → pass.
- [ ] **Step 5: Commit.**

### Task 8: Jobs and account deletion

**Files:**
- Create: `server/cloud/jobs.py`, `server/tests/cloud/test_jobs.py`, `server/tests/cloud/test_delete_account.py`
- Modify: `server/cloud/routes_me.py`, `server/cloud/repo_members.py`

**Interfaces:**
- Produces:
  - `jobs.handler(event, context)`: `event["job"] == "push_receipts"` reads `PUSHTKT` items and calls
    `expo.receipts` (up to 300 IDs per call). It deletes devices for `DeviceNotRegistered` and then deletes
    the ticket items. An unknown job raises `ValueError`.
  - `DELETE /v1/me` → 204. It deletes the user's memberships, requests, devices, read marks, profile and the
    `U#<sub>` mapping, then `cognito-idp:AdminDeleteUser` (pool from env `USER_POOL_ID`). Messages and
    replies the user wrote stay, with `authorName` replaced by `""`; the app shows a "former member" label.
    It refuses with 409 `last_gabbai` if the user is the last gabbai of any Kehila.
- [ ] **Step 1: Write the tests:**
  - `test_receipts_prune_dead_tokens`
  - `test_unknown_job_raises`
  - `test_delete_account_removes_personal_items` (scan the table: no item with the userId in a key)
  - `test_delete_account_blocked_for_last_gabbai`
  - `test_deleted_author_name_blanked`
- [ ] **Step 2: Run** → fail. **Step 3: Implement.** **Step 4: Run** → pass. **Step 5: Commit.**

### Task 9: Infrastructure: push and jobs modules, API permissions

**Files:**
- Create: `infra/modules/push/*.tf`, `infra/modules/jobs/*.tf`
- Modify: `infra/modules/api/{main,variables}.tf`, `infra/envs/dev/main.tf`, `infra/modules/observability`
  (DLQ alarm), `tools/build_lambda.py` (same zip, three handlers)

**Interfaces:**
- `modules/push`: inputs `name_prefix`, `lambda_zip`, `table_name`, `table_arn`, `log_retention_days`,
  `boundary_arn`.
  - Queue `${name_prefix}-push` (visibility timeout 120 s) and DLQ `${name_prefix}-push-dlq` (`maxReceiveCount` 5).
  - SSM `SecureString` `/kehilot/<env>/expo-access-token` with value `"none"` and `ignore_changes = [value]`.
  - Lambda `${name_prefix}-push-worker` (handler `server.cloud.push_worker.handler`, 256 MB, 60 s), event
    source mapping with batch 10 and `ReportBatchItemFailures`.
  - Role: table read/write, `sqs:ReceiveMessage/DeleteMessage/ChangeMessageVisibility/GetQueueAttributes`,
    `ssm:GetParameter` on the one parameter, and its own logs.
  - Outputs: `queue_url`, `queue_arn`, `dlq_name`, `function_name`.
- `modules/jobs`: Lambda `${name_prefix}-jobs` (`server.cloud.jobs.handler`). Scheduler group
  `${name_prefix}`, schedule `${name_prefix}-push-receipts` `rate(15 minutes)` with input
  `{"job":"push_receipts"}`. Scheduler role (path `/kehilot/`, boundary) with `lambda:InvokeFunction`.
- `modules/api` additions: env `PUSH_QUEUE_URL`, `USER_POOL_ID`; IAM `sqs:SendMessage` on the queue,
  `dynamodb:ConditionCheckItem`, and `cognito-idp:AdminDeleteUser` on the pool ARN; new input `user_pool_arn`.
  Route `GET /v1/invites/{code}` without auth.
- `observability`: alarm `${name_prefix}-push-dlq` on `ApproximateNumberOfMessagesVisible` ≥ 1; the worker
  and jobs functions are added to `function_names`.
- [ ] **Step 1: Write the modules**, then `terraform fmt -recursive infra` and `validate` → clean.
- [ ] **Step 2: Plan** with `-out=dev.tfplan`, and read the plan. Every new role has `/kehilot/` and the
  boundary, and nothing is destroyed.
- [ ] **Step 3: Apply the saved plan.** On AccessDenied, stop and report the action. Do not widen the
  boundary without the user.
- [ ] **Step 4: Commit.**

### Task 10: Smoke test, API contract and CI

**Files:**
- Modify: `tools/smoke_dev.py`, `server/API.md`, `.github/workflows/ci.yml` (no change expected; check it
  still passes)

**Interfaces:**
- New smoke checks (still self-cleaning):
  - `check_invite_flow`: create a Kehila with the admin functions, accept the gabbai invite, create a member
    invite, a second user accepts it, requests membership, and is approved.
  - `check_message_visibility`: a gabbai posts to `simchas` with `targetMemberId`; a listener does not see it
    via `/changes` and the member does.
  - `check_private_reply`: a third user replies; the gabbai's replies list is empty.
  - `check_push_pipeline`: register `ExponentPushToken[smoke-<rand>]`, publish, wait ≤ 60 s for the queue to
    empty; the DLQ stays empty and there are no `push-worker` errors in the last 5 minutes.
- `server/API.md`: add a "v2 (cloud)" section listing every route of plans 1–2a with roles, request, response
  and error codes.
- [ ] **Step 1: Extend the smoke test.** Run it twice → all checks pass both times, and the table and pool
  are empty afterwards.
- [ ] **Step 2: Write the API.md section. Commit and push**, and confirm CI is green through the GitHub API.
