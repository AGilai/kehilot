# Kehilot: Families and Privacy Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Households as families (linking by request or by a gabbai, a shared children list, private blessings
that reach the whole family), an opt-in phone list, and the privacy pack: consent records, a minimum age of 13,
Kehila terms and privacy contact, deletion with "delete everything I posted", a data download, a rewritten
privacy page, Kehila terms page and a breach procedure.

**Architecture:** The server gains a family item per household (`K#<k>` / `F#<familyId>`), referenced from each
adult's Membership (`familyId`), plus link-request, decline and consent items. Two new modules hold the logic:
`server/cloud/families.py` (pure rules: display name, child validation, target adults) and
`server/cloud/repo_families.py` (DynamoDB transactions), with routes in `routes_families.py`, `routes_privacy.py`
and `routes_export.py`. `visibility.py` stays the only place that decides who sees what; its reply rule now takes
the target family's current adults. The app adds pure, node-tested view modules in `src/client/`
(`phone.ts`, `familyView.ts`, `phoneListView.ts`, `homeCard.ts`) and screens built 1:1 from the P-frames.
Terraform changes only the media bucket's lifecycle and the API role's S3 grants, in place.

**Tech Stack:** Python 3.12 Lambdas, boto3, moto, `zipfile`; Expo SDK 57 / React Native 0.86 / react-native-web,
TypeScript 6, `node --test`; Terraform 1.17.0, AWS provider 6.70.0. No new packages.

**Spec:** `docs/superpowers/specs/2026-10-27-families-privacy-design.md` (binding, including §10). It builds on
`docs/superpowers/specs/2026-10-26-aws-architecture-design.md` (the "main spec"), which still holds.
- UX: `docs/UX-DESIGN.md` §10 (P1–P14, copy in §10.3, components in §10.2, decisions in §10.4, all accepted by
  the CTO) and `design/mockups/frames/P1.html` … `P14.html`.
- API contract: `server/API.md`, "v2 (cloud)". Each server task updates its own rows there.
- Previous plan (conventions): `docs/superpowers/plans/2026-10-27-app.md`.

**Not in this plan:**
- Person (`P#`) items, roster, Torah names, seat map (plan 2b builds on `familyId`).
- Families shared across Kehilot; addresses or any other directory field.
- Automatic deletion of inactive accounts; parental consent for under-13s.
- Google/Apple sign-in (plan 3 Tasks 19–20, still open).
- Lawyer review of the terms and privacy texts: a user follow-up (U2 below), not a task.

## Global Constraints

Every task's requirements include this section and the "Data model and API" section below.

Carried from the main spec and project rules:
- **Push payloads generic:** data only `{kehila, messageId}` or `{kehila, screen}`; no names/phones/children in
  push text or data.
- **No PII in logs:** IDs and counts only; never log tokens, emails, names, phone numbers, children, request
  bodies, or `str(exception)` from Cognito.
- **Every route starts with `require()`;** new items keyed under `K#<k>` (families, requests, decline markers) or
  `U#<user>` (consents).
- **Private replies:** only the target family's adults and the reply author; gabbaim get no exception.
- **Real congregant names never in git;** tests, fixtures, smoke use invented names.
- **Never commit** `terraform.tfvars`, `*.tfplan`, state, `.env.*`, `.superpowers/`.
- **Tests:** `.venv/bin/python -m unittest discover -s server/tests`, `npm test`, `npm run typecheck`. Machine:
  2 GB RAM, one heavy job at a time; `npm run web:fixtures` fails here (inotify) — the screenshot workaround is
  `EXPO_PUBLIC_FIXTURES=1 npx expo export --platform web --clear --output-dir <scratchpad>` +
  `python3 -m http.server 8099` + `node ~/tools/qa-browser/shoot.mjs`, stopping the server by exact command line.

Also still in force from plans 1–3: region `il-central-1`; `kehilot-<env>-` names; IAM roles under `/kehilot/` with
the `kehilot-boundary`; ULIDs (`ids.new_id()`); errors as codes (`ApiError(status, code)`); text limits count code
points; all UI text in `src/i18n/he.json` and `en.json` with equal key sets (the i18n test); logical start/end
only; `useTokens()` colours only; commits on branch `redesign`, staged by explicit path, ending with
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

From this spec:
- **Children never appear** in the phone list, the blessing picker, any push or any log. Gabbaim see them
  read-only (first name, gender, birth year only).
- **The phone list is never stored on the device:** fetched when P1 opens, held in that screen's React state,
  dropped on unmount. No "copy all", share or CSV. It is never put in the store, the message cache or AsyncStorage.
- **A phone number is shown only** to approved members and gabbaim of the same Kehila, only when its owner's
  switch for that Kehila is on, and only while the number exists.
- **Linking needs the other person's tap,** except a gabbai link, which always notifies both with an undo.
- **Consent wording versions** live in one place, `server/cloud/consents.py`
  (`VERSIONS = {'age13': '2026-10-27', 'phoneList': '2026-10-27', 'kehilaTerms': '2026-10-27'}`). The app never
  compares versions itself; the server returns booleans (`age13Required`, `cards.phoneAsk`, `cards.terms`).
- **Terraform: plan → review → the CTO applies.** Devs write the change, run `terraform fmt`, `validate` and
  `plan -out=dev.tfplan`, read the plan, and stop. Stop and report if the plan would replace (`-/+` or
  `must be replaced`) the user pool, an app client, the table or the API. Nothing in Tasks 1–22 runs `apply`,
  deploys the web or runs the migration.
- **The platform contact email is never in git.** Pages carry the placeholder `{{PLATFORM_CONTACT}}`; only the
  deploy step fills it (Task 21).

### UI verification procedure (every UI task)

1. `npm run typecheck` and `npm test` (one at a time).
2. Build fixtures (heavy; nothing else running):
   `EXPO_PUBLIC_FIXTURES=1 npx expo export --platform web --clear --output-dir <scratchpad>/web`
3. Serve: `python3 -m http.server 8099 --directory <scratchpad>/web` (in the background).
4. Shoot the app and the frame at the same width, e.g.
   `node ~/tools/qa-browser/shoot.mjs 'http://localhost:8099/?screen=phone-list&role=member&lang=he' <scratchpad>/P1-app.png --width 390`
   and `node ~/tools/qa-browser/shoot.mjs 'file:///home/ubuntu/work/kehilot/design/mockups/frames/P1.html' <scratchpad>/P1-frame.png --width 1440`.
5. Read both images and compare: layout order, kit components, copy (UX §10.3, exactly), colours/edges, states.
   List every difference you kept and why. Shoot one `lang=en` variant per task.
6. Stop the server: `pkill -f -x 'python3 -m http.server 8099 --directory <scratchpad>/web'`.

Fixture screens are opened with `?screen=<name>` (`src/client/fixtures.ts` `FIXTURE_APP_SCREENS`, routed in
`fixtureNav` in `src/views/Main.tsx` or the gate in `src/CloudApp.tsx`). Each UI task adds its screen names.

## Review Focus

1. **A member edits their name or language after saving a phone number** → the number is still there.
   `put_profile` today replaces the whole `PROFILE` item. Task 6 (`test_put_profile_keeps_phone`).
2. **A partner leaves, is removed, or deletes the account while the other adult is mid-session** (or the family
   clean-up after the membership change fails) → the family never shows a departed adult: not in Me, the phone
   list, the gabbai screen or the blessing picker, and the remaining adult keeps the children. Task 4
   (`test_departed_adult_pruned_on_read`).
3. **Both adults edit the children list at the same moment** → both edits are kept (no lost update), or one gets
   409 `try_again` and the app retries. Task 2 (`test_concurrent_child_edits_both_kept`).
4. **"Delete everything I posted" times out halfway and the app retries** → the retry finishes the job, and no
   removed post keeps its title or body in the table (today's remove only sets `removed`). Task 8
   (`test_delete_posts_scrubs_text`, `test_delete_posts_retry_finishes`).
5. **Two link actions race** (A confirms B's request while a gabbai links B to C, or both partners tap confirm on
   crossed requests) → exactly one link commits, the other gets 409 `partner_taken` / `already_linked`, and no
   family holds three adults or loses its children. Task 3 (`test_confirm_after_target_linked_elsewhere_409`,
   `test_crossed_requests_link_once`).

---

## Data model and API (shared by all server tasks)

Items (new or changed). TTL attribute is `expiresAt` (seconds) as everywhere; reads always filter on it too.

| Item | PK | SK | Attributes |
|---|---|---|---|
| Family | `K#<k>` | `F#<familyId>` | `familyId`, `adults` (list of 1–2 userIds; the keeping adult first), `children` (list of `{id, firstName, gender: 'm'\|'f', birthDate?: 'YYYY-MM-DD'}`), `version` (int, +1 on every write), `createdAt` |
| Membership (changed) | `K#<k>` | `M#<user>` | + `familyId`; `showPhone` (bool); `phoneAsked` (phoneList version answered on the Home card); `importNotice` (bool); `familyNotice` `{byUserId, partnerUserId, at}` (gabbai link) |
| Link request | `K#<k>` | `PR#<toUser>#<fromUser>` | `fromUserId`, `toUserId`, `createdAt`, `expiresAt` = +7 days |
| Sent-request marker | `K#<k>` | `PS#<fromUser>` | `toUserId`, `state` `'pending'\|'declined'`, `createdAt`, `expiresAt` (+7 days) — one per requester |
| Decline marker | `K#<k>` | `PD#<fromUser>#<toUser>` | `until`, `expiresAt` = +30 days |
| Profile (changed) | `U#<user>` | `PROFILE` | + `phone` (E.164, optional) |
| Consent | `U#<user>` | `CONSENT#<ulid>` | `kind` (`age13`\|`phoneList`\|`kehilaTerms`), `kehilaId?`, `value` (`on`\|`off`\|`accepted`), `version`, `at` |
| Export marker | `U#<user>` | `EXPORT#<yyyy-mm-dd>` | `key`, `expiresAt` (+2 days); Israel date (`repo_messages.local_date`) |
| Import marker | `U#<user>` | `SUBREF` | `sub` (only for accounts the import created) |
| Sub mapping (changed) | `U#<sub>` | `SUB` | + `neverSignedIn: true` (import-created accounts until their first API call) |
| Kehila (changed) | `K#<k>` | `META` | + `settings.privacyContact` (≤ 100 code points); `termsAccepted` `{version, userId, at}` (no name stored) |
| Message (changed) | `K#<k>` | `MSG#…` | + `targetFamilyId` (with `targetMemberId`) |

Routes (new or changed). "M/G" = member or gabbai of that Kehila (listener 403 `forbidden`); "G" = gabbai.

| Method | Path | Role | Request → Response |
|---|---|---|---|
| GET | `/v1/me` | signed in | + `profile.phone: string\|null`, + `age13Required: bool` |
| PUT | `/v1/me/profile` | signed in | unchanged shape; now an update that keeps `phone` |
| PUT | `/v1/me/phone` | signed in | `{phone: string\|null}` → 200 `{phone: string\|null}` |
| POST | `/v1/me/consents/age13` | signed in | → 204 |
| GET / POST | `/v1/me/export` | signed in | → 200 `{url, expiresAt}`; GET 404 `export_not_found`; POST 429 `export_limit` |
| DELETE | `/v1/me` | signed in | + query `deletePosts=1` |
| GET | `/v1/kehilot/{k}` | any | + `privacyContact: string`, `showPhone: bool`, `cards: {gabbaiLink: {gabbaiName, partnerName}\|null, request: {fromUserId, fromName}\|null, imported: bool, phoneAsk: bool, terms: bool}`, gabbai only: `termsAccepted: {name, at}\|null` |
| POST | `/v1/kehilot/{k}/me/cards/{card}/dismiss` | any (`gabbai_link`, `phone`: M/G) | `card` ∈ `gabbai_link`\|`imported`\|`phone` → 204 |
| PUT | `/v1/kehilot/{k}/me/phone-list` | M/G | `{show: bool}` → 200 `{show}` |
| GET | `/v1/kehilot/{k}/phone-list` | M/G | → 200 `[{familyId, name, people: [{userId, name, phone}]}]` |
| GET | `/v1/kehilot/{k}/family` | M/G | → 200 FamilyView (below) |
| POST | `/v1/kehilot/{k}/family/children` | M/G | `{firstName, gender, birthDate?}` → 201 child |
| PUT / DELETE | `/v1/kehilot/{k}/family/children/{childId}` | M/G | same body → 200 child / 204 |
| GET | `/v1/kehilot/{k}/family/candidates` | M/G | → 200 `[{userId, displayName, cooldownUntil?}]` |
| POST | `/v1/kehilot/{k}/family/requests` | M/G | `{toUserId}` → 201 `{toUserId, expiresAt}` |
| DELETE | `/v1/kehilot/{k}/family/requests/mine` | M/G | → 204 (withdraw, or dismiss a declined/expired banner) |
| POST | `/v1/kehilot/{k}/family/requests/{fromUserId}/confirm` | M/G | → 200 FamilyView |
| POST | `/v1/kehilot/{k}/family/requests/{fromUserId}/decline` | M/G | → 204 |
| POST | `/v1/kehilot/{k}/family/unlink` | M/G | → 200 FamilyView (the caller's new family) |
| GET | `/v1/kehilot/{k}/families?channelId=` | M/G | → 200 `[{familyId, name, firstNames: string[], targetMemberId}]` |
| GET | `/v1/kehilot/{k}/admin/families` | G | → 200 `[{familyId, name, adults: [{userId, displayName}], children: [{firstName, gender, birthYear?}]}]` |
| POST | `/v1/kehilot/{k}/admin/families/link` | G | `{userIds: [a, b]}` → 200 `{familyId}` |
| POST | `/v1/kehilot/{k}/admin/terms` | G | → 200 `{at}` |
| PUT | `/v1/kehilot/{k}/admin/settings` | G | `{maxListeners?, privacyContact?}` (at least one) → 200 |
| POST | `/v1/kehilot/{k}/messages` | (unchanged) | + optional `targetFamilyId` (needs `targetMemberId`) |

FamilyView: `{familyId, name, adults: [{userId, displayName, me: bool}], children: [child],
sent: {toUserId, toName, expiresAt, state: 'pending'|'declined'|'expired'} | null,
received: [{fromUserId, fromName, expiresAt}], notice: {gabbaiName, partnerName} | null}`.

New error codes: `invalid_first_name`, `invalid_gender`, `invalid_birth_date`, 409 `children_limit`,
404 `child_not_found`, 400 `invalid_to_user_id`, 409 `already_linked` (the caller has a partner),
409 `partner_taken` (the other person has one), 409 `request_pending`, 409 `request_cooldown`,
404 `request_not_found`, 409 `not_linked`, 400 `invalid_phone`, 409 `phone_required`, 400 `invalid_card`,
400 `invalid_privacy_contact`, 400 `invalid_user_ids`, 429 `export_limit`, 404 `export_not_found`.

Pushes: `push.PUSH_TEXT` gains `family_request` (he "בקשת קישור משפחה חדשה", en "New family link request") and
`family_gabbai` (he "הגבאי עדכן את פרטי המשפחה שלכם", en "The gabbai updated your family details"). Both are
queued with `ref` = the recipient's userId and sent with data `{kehila, screen: 'family'}`. They are not
gabbai-editable: `push.SYSTEM_KEYS = ('family_request', 'family_gabbai')` are left out of `GET/PUT
.../admin/push-texts`.

## File Structure

| Path | Responsibility |
|---|---|
| `server/cloud/families.py` | pure rules: `family_name`, `clean_child`, `target_adults` |
| `server/cloud/repo_families.py` | `FamiliesRepo` mixin: family item, requests, link/unlink, drop, children |
| `server/cloud/routes_families.py` | family, children, requests, picker, admin families and link |
| `server/cloud/phones.py` | `normalize_phone` |
| `server/cloud/consents.py` | `VERSIONS`, `latest(consents, kind, kehila=None)` |
| `server/cloud/routes_privacy.py` | phone, phone-list switch and list, cards, age13, terms |
| `server/cloud/posts.py` | `delete_posts` (account deletion's "everything I posted") |
| `server/cloud/export.py`, `routes_export.py` | the ZIP and its links |
| `server/cloud/visibility.py`, `routes_messages.py`, `routes_changes.py`, `push_worker.py` | family-aware private replies |
| `infra/modules/media/main.tf`, `infra/modules/api/main.tf` | `x/` lifecycle rule, `x/*` grants |
| `tools/kehila_admin.py` | `backfill-families` command |
| `tools/fill_contact.py`, `tools/deploy_web.sh`, `.gitignore` | platform contact substitution |
| `public/privacy/index.html`, `public/terms/index.html`, `docs/BREACH-PROCEDURE.md` | pages and procedure |
| `src/kit/components.tsx` | `Check`, `PickList`, `Tag` |
| `src/client/{types,endpoints,fixtures}.ts` | the new API |
| `src/client/{phone,familyView,phoneListView,homeCard}.ts` | pure view logic (node tests) |
| `src/views/PhoneList.tsx` | P1 |
| `src/views/me/{PhoneCard,FamilyCard,ChildSheet,PartnerPicker,PrivacyCard,KehilaInfo}.tsx` | P4, P2, P3, P5, P13 |
| `src/views/HomeCards.tsx` | P7 |
| `src/views/{Age13Gate,TermsGate}.tsx` | P8 |
| `src/views/admin/{FamilyBlock,LinkSheet,PrivacyContactCard}.tsx` | P11, P12 |

---

### Task 1: Families: model, creation on membership, migration command

**Files:**
- Create: `server/cloud/families.py`, `server/cloud/repo_families.py`, `server/tests/cloud/test_families.py`
- Modify: `server/cloud/repo.py` (mix `FamiliesRepo` into `Repo`), `server/cloud/routes_admin.py` (`approve`),
  `server/cloud/routes_invites.py` (`accept`), `server/cloud/importer.py`, `tools/kehila_admin.py`, `server/API.md`

**Interfaces:**
- Produces:
  - `families.family_name(profiles: list[dict]) -> str`: `profiles` in adult order, each `{firstName, lastName}`
    (a missing profile counts as empty names). Each adult contributes their last name, or their first name when
    the last name is empty; parts are de-duplicated in order and joined with `' · '`.
  - `FamiliesRepo.get_family(k, family_id) -> dict | None`.
  - `FamiliesRepo.ensure_family(k, user_id) -> str | None`: the familyId of a member/gabbai, creating
    `{adults: [user_id], children: [], version: 1}` when the membership has none. One transaction: Put `F#`
    (`attribute_not_exists(sk)`) + Update `M#` `SET familyId` with condition
    `attribute_exists(sk) AND attribute_not_exists(familyId) AND #r IN (:member, :gabbai)`. If the membership
    condition fails, re-read it: return its `familyId` if set, else `None` (a listener or gone). Idempotent.
  - `FamiliesRepo.family_of(k, user_id) -> dict | None`: the family item via the membership's `familyId`
    (no creation).
  - `tools/kehila_admin.py backfill-families --env dev [--kehila <id>]`: for every Kehila (Scan for `sk = META`
    when `--kehila` is absent), `ensure_family` for each member and gabbai; prints `kehilot=N created=M` only.
    The function `backfill_families(repo, k=None) -> (kehilot, created)` is importable for tests.
  - Hooks: `approve` (after `approve_request`), `accept` (when the resulting role is member or gabbai), and
    `importer.import_rows` (after `import_membership` when the row's role is member or gabbai and the status is
    not `exists`, and also for `exists` when the existing role is member/gabbai — ensure is idempotent) call
    `ensure_family`. A failure there is logged by IDs and does not fail the call: the lazy path (Task 2's
    `GET .../family`) creates it.
- [ ] **Step 1: Write the failing tests** in `test_families.py` (class `FamiliesTest(test_messages.MessagesTest)`):
  - `test_family_name_rules`: `[('Dana','Levi'),('Avi','Levi')]` → `'Levi'`; `[('Dana','Levi'),('Avi','Cohen')]`
    → `'Levi · Cohen'`; `[('Dana',''),('Avi','')]` → `'Dana · Avi'`; `[('Dana','')]` → `'Dana'`;
    `[('Dana','Levi'),('Avi','')]` → `'Levi · Avi'`.
  - `test_ensure_family_creates_once`: two calls return the same id; one `F#` item; adults `[user]`.
  - `test_ensure_family_skips_listener` → `None`, no `F#` item.
  - `test_approve_creates_family`, `test_member_invite_creates_family`, `test_import_member_creates_family`,
    `test_import_listener_has_no_family`.
  - `test_backfill_is_idempotent`: three members without families → `created=3`, run again → `created=0`.
- [ ] **Step 2: Run** `.venv/bin/python -m unittest server.tests.cloud.test_families -v` → FAIL (module missing).
- [ ] **Step 3: Implement** the functions above and the hooks. Add the Family and Membership rows to the
  item table in `server/API.md`.
- [ ] **Step 4: Run** the module, then the whole suite → PASS.
- [ ] **Step 5: Commit** `server/cloud/families.py server/cloud/repo_families.py server/cloud/repo.py
  server/cloud/routes_admin.py server/cloud/routes_invites.py server/cloud/importer.py tools/kehila_admin.py
  server/API.md server/tests/cloud/test_families.py` ("Families: model, creation on membership, backfill").

### Task 2: Families: the family view and children

**Files:**
- Create: `server/cloud/routes_families.py`
- Modify: `server/cloud/families.py`, `server/cloud/repo_families.py`, `server/cloud/handler.py` (routes),
  `server/API.md`
- Test: `server/tests/cloud/test_families.py`

**Interfaces:**
- Consumes: Task 1 (`ensure_family`, `get_family`, `family_name`).
- Produces:
  - `families.clean_child(d: dict, today: str) -> dict`: `firstName` via `inputs.text(d, 'firstName', 60,
    required=True)`; `gender` via `inputs.choice(d, 'gender', ('m', 'f'))`; `birthDate` optional: absent or `''`
    → omitted; else must match `^\d{4}-\d{2}-\d{2}$`, be a real date, ≥ `1900-01-01` and ≤ `today`, else 400
    `invalid_birth_date`. `today` is `repo_messages.local_date()`.
  - `FamiliesRepo.update_children(k, family_id, change: Callable[[list], list]) -> dict`: read, apply, write with
    `ConditionExpression='version = :v'`, `SET children = :c, version = :v1`; on a failed condition re-read and
    re-apply, up to 3 tries, then 409 `try_again`. Returns the new item.
  - `routes_families.family_view(ctx, k, membership) -> dict` (FamilyView). In this task `sent`, `received` and
    `notice` are `None`/`[]`; Task 3 and 4 fill them. It calls `ensure_family` when the membership has no
    `familyId` (lazy creation) and resolves names with one `batch_get` of the adults' `PROFILE` and `M#` items.
  - Routes `GET .../family`, `POST .../family/children` (new `id = new_id()`; 409 `children_limit` when the list
    already has 20), `PUT .../family/children/{childId}`, `DELETE .../family/children/{childId}` (404
    `child_not_found`). All `require(..., ('member', 'gabbai'))`. A child ID that is not a ULID is 404.
  - Logs: none beyond the handler's; never the body.
- [ ] **Step 1: Write the failing tests:**
  - `test_get_family_creates_lazily_and_names_it`: a member with no family → 200, `adults == [{userId, displayName,
    me: True}]`, `children == []`, `name` from the profile.
  - `test_listener_gets_403_on_family`.
  - `test_add_edit_remove_child`: add `{firstName: 'Noa', gender: 'f', birthDate: '2015-12-31'}` → 201 with `id`;
    edit to `gender: 'm'`; delete → 204; GET shows none.
  - `test_child_validation`: missing gender → `invalid_gender`; `'2015-02-30'`, `'31.12.2015'`, tomorrow →
    `invalid_birth_date`; 61-code-point name → `invalid_first_name`.
  - `test_children_limit`: 20 children, the 21st → 409 `children_limit`.
  - `test_concurrent_child_edits_both_kept`: patch `get_family` so the first write sees a stale version (another
    adult's add lands between read and write) → both children are in the final list.
  - `test_other_kehila_family_not_reachable`: a child ID of Kehila B's family under Kehila A → 404.
- [ ] **Step 2: Run** the module → FAIL.
- [ ] **Step 3: Implement.** Add the routes to `server/API.md`.
- [ ] **Step 4: Run** the module, then the whole suite → PASS.
- [ ] **Step 5: Commit** the five files ("Families: family view and children").

### Task 3: Families: linking by request, unlinking

**Files:**
- Modify: `server/cloud/repo_families.py`, `server/cloud/routes_families.py`, `server/cloud/handler.py`,
  `server/cloud/push.py`, `server/cloud/push_worker.py`, `server/cloud/routes_admin.py` (`get_push_texts`,
  `put_push_text` skip `SYSTEM_KEYS`), `server/API.md`
- Test: `server/tests/cloud/test_families.py`, `server/tests/cloud/test_push.py`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces:
  - `FamiliesRepo.put_link_request(k, from_user, to_user, now) -> int` (expiresAt). One transaction: Put
    `PS#<from>` with condition `attribute_not_exists(sk) OR expiresAt <= :now OR #s = :declined`
    (else 409 `request_pending`); Put `PR#<to>#<from>`. Before it, the route checks: `to_user` is a ULID, not the
    caller, a member/gabbai of `k` (else 400 `invalid_to_user_id`); the caller's family has one adult (else 409
    `already_linked`); the target's family has one adult (else 409 `partner_taken`); no live `PD#<from>#<to>`
    (else 409 `request_cooldown`).
  - `FamiliesRepo.link(k, keep_user, move_user, request_from=None) -> str` (the kept familyId). Reads both
    memberships and families (calling `ensure_family`), then one transaction:
    1. Update `F#<keep>`: `SET adults = :both, children = :merged, version = :v+1`, condition `version = :v`;
    2. Delete `F#<moved>`, condition `version = :v2`;
    3. Update `M#<move>`: `SET familyId = :keep`, condition `familyId = :moved AND #r IN (:member, :gabbai)`;
    4. ConditionCheck `M#<keep>`: `familyId = :keep AND #r IN (:member, :gabbai)`;
    5. when `request_from` is set: Delete `PR#<to>#<from>` (condition `attribute_exists(sk) AND expiresAt > :now`,
       else 404 `request_not_found`) and Delete `PS#<from>`.
    `merged` is keep's children then moved's children (it may exceed 20; adding is then refused until it is
    under 20). A family with two adults at read time → 409 `already_linked` (keep's) / `partner_taken`
    (move's). A failed condition on 1–4 re-reads once and maps to those codes, otherwise 409 `try_again`.
    After the commit, `clear_requests(k, user)` runs for both people (best effort).
  - `FamiliesRepo.clear_requests(k, user_id)`: deletes `PR#<user>#*`, every `PR#*#<user>` (query prefix `PR#`,
    filter `fromUserId = :u`), `PS#<user>`, and the `PS#<from>` of anyone whose request to `user_id` was deleted.
  - `FamiliesRepo.unlink(k, user_id) -> str` (the new familyId): family with two adults (else 409 `not_linked`);
    one transaction: Put `F#<new>` `{adults: [user_id], children: copy, version: 1}`; Update the old family
    `SET adults = :other, version = :v+1` (condition `version = :v`); Update `M#<user>` `SET familyId = :new
    REMOVE familyNotice` (condition `familyId = :old`); Update `M#<other>` `REMOVE familyNotice`. The old familyId
    (and its blessings) stays with the other adult (spec §10.3).
  - Routes:
    - `POST .../family/requests` → 201, then `push.enqueue('family_request', k, to_user)`.
    - `DELETE .../family/requests/mine` → deletes `PS#<caller>` and its `PR#<to>#<caller>`; 204 also when none.
    - `POST .../family/requests/{from}/confirm` → `link(k, keep_user=caller, move_user=from, request_from=from)`
      → 200 FamilyView. The confirmer's family is kept.
    - `POST .../family/requests/{from}/decline` → Delete `PR#<caller>#<from>` (404 `request_not_found` if
      absent or expired), Update `PS#<from>` `SET #s = :declined` (keep its `expiresAt`), Put
      `PD#<from>#<caller>` `{until: now + 30 days, expiresAt: same}` → 204. No push.
    - `POST .../family/unlink` → 200 FamilyView of the new family.
    - `GET .../family/candidates` → members and gabbaim of `k`, not the caller, whose family has one adult
      (families pruned as in Task 4), sorted by `displayName`; `cooldownUntil` from a live
      `PD#<caller>#<them>`.
  - FamilyView now fills `sent` (from `PS#<caller>`: `state` is `expired` when `expiresAt <= now` and the state
    was `pending`; a `PS` older than its `expiresAt` + 7 days is ignored) and `received` (live
    `PR#<caller>#*`, oldest first, names from memberships).
  - `push_worker.recipients` for `family_request` and `family_gabbai`: `[ref]` when `ref`'s membership in
    `kehila` is member or gabbai, else `[]`. `_data` → `{kehila, screen: 'family'}`.
- [ ] **Step 1: Write the failing tests:**
  - `test_request_confirm_links_and_merges_children`: A (child "Noa") requests B (child "Ari"); B confirms →
    both GET the same `familyId` (B's), `adults` = [B, A], children `['Ari', 'Noa']`; `F#` of A gone;
    no `PR#`/`PS#` left.
  - `test_request_pushes_generic_family_screen` (with `push.enqueue` patched): called with
    `('family_request', k, B)`; in `test_push.py`, `test_family_request_push_payload`: data is exactly
    `{'kehila': k, 'screen': 'family'}` and the body is the `family_request` text.
  - `test_request_errors`: to self / to a listener / non-ULID → 400 `invalid_to_user_id`; a second request while
    one is pending → 409 `request_pending`; to someone linked → 409 `partner_taken`; while linked → 409
    `already_linked`.
  - `test_decline_is_silent_and_starts_cooldown`: B declines → A's `sent.state == 'declined'`; A asks B again →
    409 `request_cooldown`; candidates show B with `cooldownUntil` ≈ now + 30 days; A may ask C at once.
  - `test_request_expires_after_7_days`: with `time.time` patched +7 days + 1 s → A's `sent.state ==
    'expired'`, B's `received == []`, confirm → 404 `request_not_found`, and A may request again.
  - `test_withdraw`: A withdraws → B's `received == []`, A's `sent is None`.
  - `test_unlink_copies_children_and_keeps_family_with_other`: linked A+B with two children; A unlinks → A has a
    new `familyId` with the same two children; B keeps the old `familyId` and the children; editing A's copy does
    not change B's.
  - `test_confirm_after_target_linked_elsewhere_409`: A requests B; B is linked to C first (call `repo.link`
    directly); B confirms A → 409 `already_linked`; A's request → candidates no longer list B.
  - `test_crossed_requests_link_once`: A requests B and B requests A; A confirms B's → linked; B's confirm of
    A's → 404 `request_not_found` (cleared) and the family has exactly two adults.
  - `test_push_texts_hide_system_keys`: `GET .../admin/push-texts` defaults have no `family_*` key; `PUT` with
    `key: 'family_request'` → 400 `invalid_key`.
- [ ] **Step 2: Run** the module → FAIL.
- [ ] **Step 3: Implement.** Document the routes, the two push kinds and the error codes in `server/API.md`.
- [ ] **Step 4: Run** `test_families`, `test_push`, `test_push_texts`, then the whole suite → PASS.
- [ ] **Step 5: Commit** the changed files ("Families: link requests, confirm, decline, unlink").

### Task 4: Families: gabbai link, leaving, removal, account deletion, gabbai view

**Files:**
- Modify: `server/cloud/repo_families.py`, `server/cloud/routes_families.py`, `server/cloud/routes_admin.py`
  (`leave`, `remove_member`), `server/cloud/routes_me.py` (`delete_account`), `server/cloud/routes_core.py`
  (`kehila`: `cards.gabbaiLink`, `cards.request`), `server/cloud/handler.py`, `server/API.md`
- Test: `server/tests/cloud/test_families.py`, `server/tests/cloud/test_delete_account.py`

**Interfaces:**
- Consumes: Tasks 1–3 (`link`, `clear_requests`, `unlink`).
- Produces:
  - `POST .../admin/families/link` `{userIds: [a, b]}` (G): two distinct ULIDs of members/gabbaim of `k`
    (else 400 `invalid_user_ids`); either already linked → 409 `partner_taken`. Calls `link(k, keep_user=a,
    move_user=b)`, then sets `familyNotice = {byUserId: caller, partnerUserId: <other>, at}` on both memberships,
    enqueues `family_gabbai` for each → 200 `{familyId}`. `link` already clears both people's requests.
  - FamilyView `notice` and `GET /v1/kehilot/{k}` `cards.gabbaiLink`: `{gabbaiName, partnerName}` from the
    caller's `familyNotice` (names from the current memberships; a departed gabbai's name is `''`).
    `cards.request`: the oldest live received request `{fromUserId, fromName}` or `null`.
  - `POST .../me/cards/gabbai_link/dismiss` ("that's right") → `REMOVE familyNotice` on the caller → 204.
    Undo is `POST .../family/unlink` (whoever taps it leaves, spec §10.3). The cards route itself is added here
    with only `gabbai_link`; Task 7 adds `imported` and `phone`. Unknown card → 400 `invalid_card`.
  - `FamiliesRepo.drop_adult(k, user_id)`: the family of `user_id` (via membership `familyId`, or a query for an
    `F#` whose `adults` contains the user when the membership is already gone): two adults → Update `adults =
    [other]`, `version + 1` (condition `version`) and `REMOVE familyNotice` on the other's membership; one adult
    → Delete the `F#` item (children go with it). Then `clear_requests(k, user_id)` and delete
    `PD#<user>#*` / `PD#*#<user>`. Idempotent.
  - Call sites: `leave` and `remove_member` call `drop_adult` right after the membership is removed;
    `delete_account` calls it for every Kehila **before** `purge_user` (so the scan never sees the person in a
    family). `revoke_member_invites` order is unchanged.
  - **Read-side pruning:** `FamiliesRepo.live_adults(k, family) -> list[dict]` returns the adults whose `M#` is
    member or gabbai (one `batch_get`); every reader (FamilyView, candidates, admin families, phone list in
    Task 6, blessing picker in Task 5) uses it. `GET .../family` writes the pruned list back (Update with the
    version condition; a lost race is ignored).
  - `GET .../admin/families` (G): one row per family with ≥ 1 live adult: `name`, `adults [{userId,
    displayName}]`, `children [{firstName, gender, birthYear?}]` (year only, an int). No phone numbers.
- [ ] **Step 1: Write the failing tests:**
  - `test_gabbai_links_two_members_with_notice_and_push`: both get the same family; both `GET kehila` show
    `cards.gabbaiLink == {gabbaiName: 'Gabi Gabbai', partnerName: …}`; `enqueue` called with `family_gabbai` for
    each; `dismiss` clears it for the caller only.
  - `test_gabbai_link_errors`: same user twice / a listener → 400 `invalid_user_ids`; one already linked → 409
    `partner_taken`; a member calling it → 403.
  - `test_gabbai_link_deletes_outstanding_requests`: C had requested A → after the link, C's `sent` is `None`
    and A's `received == []`.
  - `test_undo_gabbai_link_leaver_gets_new_family`: B unlinks → B has a new family with a copy of the
    children; A keeps the familyId; neither shows `gabbaiLink`.
  - `test_leave_keeps_family_with_partner`, `test_removed_member_drops_out`, `test_last_adult_leaving_deletes_family`
    (no `F#` item remains).
  - `test_leave_deletes_pending_requests_to_and_from`.
  - `test_departed_adult_pruned_on_read`: delete A's `M#` directly (no `drop_adult`) → B's `GET family` shows
    only B and the item is rewritten; admin families and candidates (B listed again) agree.
  - In `test_delete_account.py`: `test_deletion_drops_out_of_family`: A and B linked with children; A deletes
    the account → B's family has adults `[B]` and the children; no item still names A.
  - `test_admin_families_children_year_only`: a child born `2015-12-31` → `{firstName, gender, birthYear: 2015}`
    and no `birthDate` key; a listener has no row.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Document in `server/API.md`, including that a demotion to listener has no route
  (`role_change_not_allowed` already) so it needs no hook.
- [ ] **Step 4: Run** the two modules, then the whole suite → PASS.
- [ ] **Step 5: Commit** ("Families: gabbai link, leaving and deletion, gabbai families view").

### Task 5: Private blessings reach the target family

**Files:**
- Modify: `server/cloud/families.py` (`target_adults`), `server/cloud/visibility.py`,
  `server/cloud/routes_messages.py` (`post_message`, `_message_json`, `post_reply`, `list_replies`, new
  `list_target_families`), `server/cloud/routes_changes.py`, `server/cloud/push_worker.py`,
  `server/cloud/handler.py`, `server/API.md`
- Test: `server/tests/cloud/test_replies.py`, `test_changes.py`, `test_push.py`, `test_visibility.py`

**Interfaces:**
- Consumes: Tasks 1–4 (`family_of`, `get_family`, `live_adults`).
- Produces:
  - `families.target_adults(repo, k, message) -> frozenset[str]`: the live adults of `message.targetFamilyId`
    when that family exists; else of the family of `targetMemberId` (older messages, or a family merged away);
    else `{targetMemberId}`; empty for an untargeted message.
  - `visibility.reply_visible(user_id, message, reply, family_adults=frozenset()) -> bool`: the reply's author,
    or a member of `family_adults`. The `targetMemberId` alone no longer grants anything unless it is in
    `family_adults` (callers always pass `target_adults`). Gabbaim get no exception.
  - `visibility.change_visible(user_id, membership, channels_by_id, change, family_adults=None)`: for kind
    `reply`, visible when `user_id` is in `visibleTo` **or** in `family_adults` (and the channel is readable);
    other kinds unchanged.
  - `post_message`: optional `targetFamilyId` (ULID; needs `targetMemberId`; the member must be a live adult of
    that family, else 400 `invalid_target_family_id`); stored on the message; `_message_json` returns it when
    set. `reply_target_ok(targetMember)` is still required (spec §10.2).
  - `post_reply`: 409 `cannot_reply_to_own` when the caller is in `target_adults`; 409 `target_left` when no
    adult of `target_adults` passes `reply_target_ok` for the channel. `visibleTo` = `[author, *target_adults]`.
  - `list_replies` and the feed's `_item` pass `target_adults` (the feed computes it once per distinct message on
    the page, and only for reply changes).
  - `push_worker.recipients('reply', …)`: every adult in `target_adults` who passes `reply_target_ok`, minus the
    reply's author.
  - `GET /v1/kehilot/{k}/families?channelId=` (M/G; `channelId` required and readable by the caller, else 400
    `invalid_channel_id` / 404 `channel_not_found`): one row per family that has at least one live adult passing
    `reply_target_ok` for that channel: `{familyId, name, firstNames (live adults' profile first names, in adult
    order), targetMemberId (the first such adult)}`, sorted by `name`. Families with no such adult are left out
    (UX §10.4 decision 10). No children.
  - `GET .../members` is unchanged.
- [ ] **Step 1: Write the failing tests:**
  - `test_partner_sees_replies_and_gabbai_still_not`: link Quinn (target) with Omri; Mia replies → Omri and
    Quinn see it; the gabbai sees `[]`; another member sees `[]`.
  - `test_partner_who_cannot_read_channel_sees_nothing`: a group channel Quinn reads but the partner does not →
    the partner gets 404 on the message and no reply push.
  - `test_ex_partner_loses_replies_after_unlink`: Omri unlinks → Omri sees `[]`; Quinn still sees them.
  - `test_target_family_id_survives_target_member_unlink`: blessing to the family via `targetMemberId=Omri,
    targetFamilyId=F`; Omri unlinks (leaves F) → Quinn (still in F) sees the replies, Omri does not.
  - `test_old_message_falls_back_to_member_family`: a message with only `targetMemberId` → the member's
    current partner sees replies.
  - `test_partner_cannot_reply_to_own_family`: 409 `cannot_reply_to_own`.
  - `test_reply_allowed_while_one_adult_remains`: the stored target member leaves; the partner still in the
    family → a reply is 201 and pushed to the partner; when nobody remains → 409 `target_left`.
  - `test_invalid_target_family`: a family the member is not in → 400 `invalid_target_family_id`.
  - In `test_changes.py`: `test_reply_change_reaches_partner_linked_later`: reply first, link after → the
    partner's feed carries the reply; `test_reply_change_hidden_from_ex_partner`.
  - In `test_push.py`: `test_reply_push_goes_to_every_adult_not_author`.
  - `test_family_picker_lists_families_once_and_hides_unreachable`: a linked couple is one row with both first
    names; a family whose adults cannot read the group channel is absent; a listener → 403.
  - In `test_visibility.py`: `reply_visible` truth table (author, adult, gabbai, other, empty adults).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Update the replies rows and the private-reply rule in `server/API.md`.
- [ ] **Step 4: Run** the four modules, then the whole suite → PASS.
- [ ] **Step 5: Commit** ("Private blessings reach the target family; family picker").

### Task 6: Phone number, phone-list switch and the phone list

**Files:**
- Create: `server/cloud/phones.py`, `server/cloud/consents.py`, `server/cloud/routes_privacy.py`,
  `server/tests/cloud/test_phone_list.py`
- Modify: `server/cloud/repo_members.py` (`put_profile`, `get_profile`, `set_phone`, consents),
  `server/cloud/routes_me.py`, `server/cloud/routes_core.py` (`me`, `kehila`), `server/cloud/handler.py`,
  `server/API.md`

**Interfaces:**
- Consumes: Task 4 (`live_adults`), Task 1 (`family_name`).
- Produces:
  - `phones.normalize_phone(raw: str) -> str | None` (E.164). Remove spaces, `-`, `(`, `)`, `.`; a leading `00`
    becomes `+`. Israeli: `0` + 8–9 digits → `+972` + the digits without the `0`; `+972` followed by `0` drops that
    `0`. After `+972` the national part must be `5` + 8 digits, `7` + 8 digits, or one of `2 3 4 8 9` + 7 digits.
    Other `+`: first digit 1–9, 8–15 digits in all. Anything else → `None`. Length guard: raw over 32 characters
    → `None`.
  - `consents.VERSIONS` (Global Constraints); `consents.latest(items, kind, kehila=None) -> dict | None` (newest
    by SK).
  - `MembersRepo.put_profile(user_id, first, last, lang)` becomes an `update_item` (`SET firstName, lastName,
    lang`) so `phone` survives; `get_profile` returns `phone` (or `None`).
  - `MembersRepo.set_phone(user_id, phone | None)`: `SET phone` / `REMOVE phone`; 409 `profile_required` when
    there is no profile.
  - `MembersRepo.add_consent(user_id, kind, value, version, k=None)`, `list_consents(user_id) -> list[dict]`.
  - `PUT /v1/me/phone` `{phone: string|null}`: a string that does not normalise → 400 `invalid_phone`; `null` or
    `''` removes it (the switches stay as they are, UX §10.4 decision 9) → 200 `{phone}`. No consent record.
  - `PUT /v1/kehilot/{k}/me/phone-list` `{show: bool}` (M/G): `show: true` without a phone → 409
    `phone_required`. Sets `showPhone` and `phoneAsked = VERSIONS['phoneList']`, writes a consent `phoneList`
    (`on`/`off`, current version, `kehilaId`) → 200 `{show}`.
  - `GET /v1/kehilot/{k}/phone-list` (M/G; listener 403): per family, the live adults with `showPhone` true and a
    phone, `{userId, name: displayName, phone}`; families with none are left out; sorted by family `name`. One
    `list_members` query, one `_query_prefix(k, 'F#')`, one `batch_get` of the profiles. The response is never
    logged. Children are never included.
  - `GET /v1/me`: `profile.phone`. `GET /v1/kehilot/{k}`: `showPhone`.
- [ ] **Step 1: Write the failing tests** in `test_phone_list.py`:
  - `test_normalize_phone`: `'050-123 4567'`, `'+972 50 123 4567'`, `'00972501234567'`, `'+972-0501234567'` →
    `'+972501234567'`; `'02-6234567'` → `'+97226234567'`; `'077-1234567'` → `'+972771234567'`;
    `'+44 20 7946 0958'` → `'+442079460958'`; `''`, `'12345'`, `'050-123'`, `'abc'`, `'+0123456789'`,
    `'+1234567890123456'`, `'0' * 40` → `None`.
  - `test_put_profile_keeps_phone`: set phone, then `PUT /v1/me/profile` with a new name → `GET /v1/me` still has
    the phone.
  - `test_switch_needs_phone`: `show: true` with no phone → 409 `phone_required`.
  - `test_switch_writes_consent_records`: on then off → two `CONSENT#` items `phoneList` with `on`, `off`, the
    version and `kehilaId`.
  - `test_list_shows_only_switched_on_numbers`: a couple, one switched on → one family with one person; a family
    with nobody on → absent.
  - `test_switch_is_per_kehila`: on in Kehila A, member of B too → B's list does not show the number.
  - `test_listener_cannot_see_list` (403) and `test_other_kehila_404`.
  - `test_off_removes_at_once` and `test_removing_number_hides_but_keeps_switch`: after `PUT /v1/me/phone null`
    the list omits the person and `GET kehila` still says `showPhone: true`.
  - `test_departed_adult_not_listed`.
- [ ] **Step 2: Run** `.venv/bin/python -m unittest server.tests.cloud.test_phone_list -v` → FAIL.
- [ ] **Step 3: Implement.** Document in `server/API.md`.
- [ ] **Step 4: Run** the module, `test_me`, then the whole suite → PASS.
- [ ] **Step 5: Commit** ("Phone number, per-Kehila phone-list switch, phone list").

### Task 7: Consents, age 13, Kehila terms, privacy contact, one-time cards

**Files:**
- Modify: `server/cloud/routes_privacy.py`, `server/cloud/routes_core.py` (`me`, `kehila`),
  `server/cloud/routes_admin.py` (`set_settings`), `server/cloud/repo_members.py` (`import_membership`,
  `set_settings`, `accept_terms`), `server/cloud/handler.py`, `server/API.md`
- Test: `server/tests/cloud/test_consents.py` (create), `test_import.py`, `test_admin.py`

**Interfaces:**
- Consumes: Task 6 (`consents`, `add_consent`, `list_consents`), Task 4 (cards route with `gabbai_link`).
- Produces:
  - `POST /v1/me/consents/age13` → consent `{kind: 'age13', value: 'accepted', version: VERSIONS['age13']}` → 204.
  - `GET /v1/me` `age13Required`: `true` unless the latest `age13` consent has the current version.
  - `POST /v1/kehilot/{k}/admin/terms` (G): `META.termsAccepted = {version, userId: caller, at}` and a
    `kehilaTerms` consent (`accepted`, version, `kehilaId`) for the caller → 200 `{at}`. Not gated by anything.
  - `GET /v1/kehilot/{k}`:
    - `cards.terms`: role gabbai and `termsAccepted.version != VERSIONS['kehilaTerms']` (absent included);
      `false` for other roles.
    - `termsAccepted` (gabbai only): `{name: <current displayName of that userId or ''>, at}` or `null`.
    - `cards.imported`: the membership has `importNotice`.
    - `cards.phoneAsk`: role member/gabbai and `phoneAsked != VERSIONS['phoneList']`.
    - `privacyContact`: `settings.privacyContact` or `''`, for every role.
  - `POST .../me/cards/{card}/dismiss` adds `imported` (`REMOVE importNotice`, any role) and `phone` (M/G;
    `SET phoneAsked = :v`; "not now", no consent record).
  - `import_membership` sets `importNotice: True` on a membership it **adds** (not on `upgraded`/`exists`).
  - `PUT .../admin/settings`: `maxListeners` and `privacyContact` both optional, at least one (else 400
    `invalid_body`). `privacyContact`: string, stripped, ≤ 100 code points, no characters matched by
    `routes_admin._UNSAFE_TEXT` (else 400 `invalid_privacy_contact`); `''` removes it. Never logged.
  - The terms gate is **client-side** (spec §10.7 "blocks only the gabbai's management screens"); the server
    records the acceptance and does not refuse admin routes. State this in `server/API.md`.
- [ ] **Step 1: Write the failing tests** (`test_consents.py`):
  - `test_age13_required_until_recorded`: new user → `age13Required: true`; POST → `false`; with
    `consents.VERSIONS['age13']` patched to a new value → `true` again.
  - `test_terms_card_for_gabbai_only_until_accepted`: gabbai `cards.terms: true`, member `false`; accept → `false`
    for every gabbai and `termsAccepted.name == 'Gabi Gabbai'`; a consent item exists under the gabbai.
  - `test_terms_new_version_asks_again`.
  - `test_member_cannot_accept_terms` (403).
  - `test_privacy_contact_set_shown_removed`: set → every role's `GET kehila` shows it; 101 code points → 400;
    with `'‮'` → 400; `''` removes it; `PUT settings {}` → 400 `invalid_body`; `maxListeners` alone still works.
  - `test_phone_card_until_answered`: `phoneAsk: true`; dismiss `phone` → `false`; a listener has `false` and
    gets 403 on that dismiss; switching on (Task 6 route) also answers it.
  - In `test_import.py`: `test_import_sets_imported_card_once`: an added row → `cards.imported: true`; dismiss →
    `false`; an `exists` re-import does not set it again.
  - `test_unknown_card_400`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**, documenting in `server/API.md`.
- [ ] **Step 4: Run** the three modules, then the whole suite → PASS.
- [ ] **Step 5: Commit** ("Consents: age 13, Kehila terms, privacy contact, one-time cards").

### Task 8: Deletion: "delete everything I posted", imported people who never signed in

**Files:**
- Create: `server/cloud/posts.py`
- Modify: `server/cloud/routes_me.py`, `server/cloud/repo_messages.py` (`authored_items`, `scrub_message`,
  `delete_replies`, `delete_reply`), `server/cloud/routes_admin.py` (`remove_member`), `server/cloud/identity.py`,
  `server/cloud/importer.py`, `server/cloud/repo.py` / `repo_members.py` (SUB flag, `SUBREF`), `server/API.md`
- Test: `server/tests/cloud/test_delete_account.py`, `test_identity.py`, `test_import.py`, `test_admin.py`

**Interfaces:**
- Consumes: Task 4 (`drop_adult` in `delete_account`).
- Produces:
  - `MessagesRepo.authored_items(user_id) -> list[dict]`: one consistent paginated Scan with
    `FilterExpression=Attr('authorId').eq(user_id)` (messages and replies, every Kehila; same cost note as
    `purge_user`).
  - `MessagesRepo.scrub_message(k, message_id)`: `SET title = :e, body = :e` on the message.
  - `MessagesRepo.delete_replies(k, message_id) -> int`: deletes every `R#` and `RP#` item under
    `K#<k>#MSG#<id>`.
  - `MessagesRepo.delete_reply(k, message_id, reply_sk, author_id)`: deletes the reply; when it was the author's
    last reply there, also `RP#<author>` and `ADD replierCount :minus1` (condition `replierCount > 0`), then a
    `reply_count` change.
  - `posts.delete_posts(repo, user_id, remaining_ms=None) -> (messages, replies)`: for each authored message,
    whatever its Kehila: if not yet removed, the existing remove order (image first via `media.delete_image`,
    then `remove_message`, then `put_change(k, 'message_removed', …)`); then `delete_replies` and
    `scrub_message` (also for messages already removed). For each authored reply on someone else's message:
    `delete_reply`. Skips work already done, so a retry finishes. When `remaining_ms() < 3000` it raises
    `ApiError(503, 'try_again')` before the next item.
  - `DELETE /v1/me?deletePosts=1`: order is last-gabbai check → `delete_posts` (only with the flag) →
    `drop_adult` per Kehila → gabbai removals → `purge_user` → Cognito. Any other value than `1` or absence →
    posts stay (as today). Log line adds `posts=<n> replies=<n>` (counts only).
  - Imported accounts: when `accounts.ensure_account` returns `created=True`, `import_rows` calls
    `repo.mark_imported_account(sub, user_id)`: `SET neverSignedIn = :t` on `U#<sub>/SUB` and Put
    `U#<user>/SUBREF {sub}`. `identity.resolve_user_id`: when the SUB item has `neverSignedIn`, `REMOVE` it
    (one update, only that once).
  - `remove_member` (gabbai): after the removal and `drop_adult`, when the target has a `SUBREF`, its SUB item
    still has `neverSignedIn`, and `list_memberships(target)` is empty → `routes_me._delete_cognito_user(sub)`
    then `purge_user(target, sub)`. Log `removed never-signed-in user=<id>` only.
  - Spec conflict, resolved: spec §5 defines "never signed in" as Cognito `FORCE_CHANGE_PASSWORD` with no profile,
    but the import makes accounts `CONFIRMED` and writes a profile; the `neverSignedIn` flag (cleared on the first
    API call) is the test instead.
  - Listeners leaving: `DELETE .../membership` already allows them; add the test only.
  - `src/client/account.ts` is not changed here (Task 18 adds `try_again` to its retries).
- [ ] **Step 1: Write the failing tests:**
  - `test_delete_posts_removes_messages_chat_and_replies_everywhere`: the user has a weekly message with an image
    in Kehila A, a chat message in B, a blessing about someone else with two replies by others under it, and a
    private reply under another's blessing → after `DELETE /v1/me?deletePosts=1`: every one of their messages is
    `removed` with `title == body == ''`, the image key is gone from the bucket, a `message_removed` change exists
    per message, the replies under their blessing are gone, their own reply is gone and that message's
    `replierCount` dropped by 1.
  - `test_delete_posts_scrubs_text`: a message already removed earlier still gets its title/body blanked.
  - `test_delete_posts_retry_finishes`: `remaining_ms` returns 2000 after two items → 503 `try_again`; the
    retry → 204 and everything is gone.
  - `test_delete_without_flag_keeps_posts`: as today (author name blanked).
  - `test_blessings_about_deleted_person_stay_blank_target`.
  - `test_listener_can_leave`.
  - `test_resolve_clears_never_signed_in` (`test_identity.py`).
  - `test_gabbai_removing_never_signed_in_import_deletes_account` (`test_admin.py`, Cognito client mocked):
    `admin_delete_user` called with the sub; no item with the userId left; a tombstone exists.
  - `test_removing_signed_in_or_multi_kehila_import_keeps_account`: after one `GET /v1/me` as that user, or
    with a second membership → no Cognito delete.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**, documenting `deletePosts` and the removal rule in
  `server/API.md`.
- [ ] **Step 4: Run** the four modules, then the whole suite → PASS.
- [ ] **Step 5: Commit** ("Deletion: delete everything I posted; never-signed-in imports").

### Task 9: Download my data, with the media-bucket Terraform (plan only)

**Files:**
- Create: `server/cloud/export.py`, `server/cloud/routes_export.py`, `server/tests/cloud/test_export.py`
- Modify: `server/cloud/handler.py`, `server/cloud/media.py` (`presign_export`), `infra/modules/media/main.tf`,
  `infra/modules/api/main.tf`, `server/API.md`

**Interfaces:**
- Consumes: Task 8 (`authored_items`), Task 6 (`list_consents`, profile phone), Task 4 (`family_of`,
  `live_adults`).
- Produces:
  - `media.export_key(user_id, day) -> str` = `x/<userId>/<yyyy-mm-dd>.zip`.
  - `media.presign_export(key, day) -> str`: presigned GET, `ExpiresIn=600`, `ResponseContentType
    'application/zip'`, `ResponseContentDisposition 'attachment; filename="kehilot-<day>.zip"'`.
  - `media.object_exists(key) -> bool` (HeadObject; `MISSING` codes → False).
  - `export.build(repo, user_id, email, remaining_ms=None) -> str` (a path under `/tmp`): a ZIP
    (`zipfile.ZIP_DEFLATED`, written to a temp file, never held whole in memory) with:
    - `data.json` (UTF-8, `ensure_ascii=False`, indent 2): `{exportedAt, userId, email, profile: {firstName,
      lastName, lang, phone}, kehilot: [{kehilaId, name, role, classification, groups, showPhone, notify,
      family: {partnerName | null, children: [{firstName, gender, birthDate?}]} | null}], consents: [{kind,
      kehilaId?, value, version, at}], messages: [{kehilaId, messageId, channelId, type, title, body, removed,
      targetName?, photo: 'photos/<k>/<messageId>.<jpg|png>' | null}], replies: [{kehilaId, messageId, replyId,
      body, createdAt}], photosOmitted: int}`. Nothing else of other people: the partner's name only, the
      children, and `targetName` of the person's own blessings. Memberships come from `list_memberships`;
      messages and replies from `authored_items`.
    - `photos/<k>/<messageId>.<ext>`: the image of each of the person's non-removed messages (GetObject `m/…`),
      streamed into the ZIP. When `remaining_ms() < 4000`, the remaining photos are skipped and counted in
      `photosOmitted` (stated in `data.json`).
  - `POST /v1/me/export` (CTO ruling 1):
    1. today = `local_date()`; key = `export_key(user, today)`;
    2. if `object_exists(key)` → 200 `{url: presign_export(key), expiresAt: now + 600}` (a fresh link, never 429);
    3. else if the marker `U#<user>/EXPORT#<today>` exists → 429 `export_limit` (a second new build today);
    4. else build, `put_object` (`ContentType application/zip`, `CacheControl 'private, no-store'`), Put the
       marker (`expiresAt` +2 days), delete the temp file (in `finally`), → 200 `{url, expiresAt}`.
    A failed build writes no marker, so the app's retry builds again.
  - `GET /v1/me/export` → 200 fresh link when today's ZIP exists, else 404 `export_not_found`.
  - Logs: `export built user=<id> messages=<n> photos=<n> omitted=<n> bytes=<n>`; never the URL or the key.
  - Terraform (in place only):
    - `infra/modules/media/main.tf`: a lifecycle rule `id = "expire-exports"`, `filter { prefix = "x/" }`,
      `expiration { days = 1 }`.
    - `infra/modules/api/main.tf`: the existing S3 statement's resources gain `"${var.media_bucket_arn}/x/*"`
      (actions unchanged: Put, Get, Delete). The Lambda timeout stays 20 s.
- [ ] **Step 1: Write the failing tests** (`test_export.py`, moto table + bucket via `helpers.make_bucket`):
  - `test_export_contents`: a member with a phone, a partner, two children, a consent, a message with an image, a
    chat message and a reply → the ZIP's `data.json` has those fields; `photos/<k>/<id>.jpg` bytes equal the
    object's; the partner appears only as `partnerName`; another member's message text is absent.
  - `test_second_post_same_day_reissues_link`: two POSTs → both 200; one object; one marker; `build` called
    once (patched spy).
  - `test_limit_when_zip_gone`: delete the object, POST → 429 `export_limit`.
  - `test_failed_build_allows_retry`: `build` raises once → 500; the next POST builds → 200.
  - `test_get_without_export_404` and `test_get_after_export_200`.
  - `test_link_expires_in_600s_and_downloads_as_attachment` (inspect the presigned query: `X-Amz-Expires=600`,
    `response-content-disposition=attachment`).
  - `test_photos_omitted_near_deadline`.
- [ ] **Step 2: Run** `.venv/bin/python -m unittest server.tests.cloud.test_export -v` → FAIL.
- [ ] **Step 3: Implement** the server part; document the routes in `server/API.md`.
- [ ] **Step 4: Run** the module, then the whole suite → PASS.
- [ ] **Step 5: Terraform:** in `infra/envs/dev`: `terraform fmt -recursive ../../`, `terraform validate`,
  `.venv/bin/python tools/build_lambda.py`, `terraform plan -out=dev.tfplan`. Expected: in-place updates to
  `aws_s3_bucket_lifecycle_configuration.media`, `aws_iam_role_policy.api` and the Lambda code (Tasks 1–9);
  nothing replaced. Paste the summary line into the report. Do not apply. Do not commit `dev.tfplan`.
- [ ] **Step 6: Commit** the server files, the two `.tf` files and `server/API.md` ("Download my data; x/
  lifecycle and API grants").

### Task 10: Kit: Check, PickList, Tag and the §10.3 copy

**Files:**
- Modify: `src/kit/components.tsx`, `src/views/admin/shared.tsx` (re-export `Tag` from the kit), every import of
  `Tag`, `src/views/Compose.tsx` (its picker becomes `PickList`), `src/i18n/he.json`, `src/i18n/en.json`
- Test: `tests/i18n.test.ts` (existing key-set test)

**Interfaces:**
- Produces (UX §10.2, exactly):
  - `Check({label, value, onChange, note?, disabled?})`: Pressable row, `minHeight: TOUCH`,
    `accessibilityRole="checkbox"`, `accessibilityState={{ checked: value, disabled }}`,
    `accessibilityLabel=label`; box 24×24, radius 6, border 2 `muted`, background `surface`; checked: background
    and border `tekhelet`, "✓" in `onAction` (uiBold, 15); label `Txt` body, flex 1, paddingTop 12; `note` as
    `Txt size="small" color={muted}` under the row; disabled opacity .6.
  - `PickList({query, onQuery, placeholder, rows, selected, onSelect, empty, state, errorText?, max = 8})` with
    `rows: {id, title, subtitle?}[]`: Compose's current TextInput style; rows `minHeight: TOUCH`, radius 10,
    border 1 `line`; selected border 2 `tekhelet`, bold, "✓ " prefix; subtitle `Txt small muted`; gap 6; shows at
    most `max` rows; `state: 'loading'` → spinner, `'error'` → `Banner tone="error"` with `errorText`.
  - `Tag` moved unchanged to `src/kit/components.tsx`; `shared.tsx` keeps `export { Tag } from '../../kit/components.tsx'`
    until every import is moved, then drops it.
  - All §10.3 keys added to both files (Hebrew and English exactly as written there; dots are nesting), and
    `deleteAccount.deleted.i4` replaced. Also keys this plan needs beyond §10.3, written in the same voice:
    `errors.request_pending` / `request_cooldown` / `partner_taken` / `already_linked` / `phone_required` /
    `invalid_phone` / `children_limit` / `export_limit` (reuse the §10.3 sentences where one exists, e.g.
    `export_limit` = `export.limit`), `export.photosOmitted` (he "חלק מהתמונות לא נכנסו לקובץ.", en "Some photos
    did not fit in the file."), `family.dismiss` (he "סגירה", en "Dismiss").
- [ ] **Step 1: Run** `npm test` → the i18n test passes before the change (baseline).
- [ ] **Step 2: Implement** the components, the move and the copy. Compose renders the same as before with
  `PickList` (no behaviour change yet; Task 20 switches it to families).
- [ ] **Step 3: Verify:** `npm test` (key sets equal) and `npm run typecheck` → PASS. UI verification procedure on
  `?screen=compose-target&role=member` → identical to the pre-change shot (shoot it before Step 2 too).
- [ ] **Step 4: Commit** the kit, Compose, shared, the moved imports and both JSON files ("Kit: Check, PickList,
  Tag; families and privacy copy").

### Task 11: Client: types, endpoints and fixtures for the new API

**Files:**
- Modify: `src/client/types.ts`, `src/client/endpoints.ts`, `src/client/fixtures.ts`
- Create: `tests/endpoints-families.test.ts`

**Interfaces:**
- Consumes: the Data model and API section (server Tasks 1–9).
- Produces:
  - Types: `Profile.phone?: string | null`; `Me.age13Required: boolean`; `Kehila` + `privacyContact: string`,
    `showPhone: boolean`, `cards: HomeCards`, `termsAccepted?: {name: string; at: number} | null`;
    `HomeCards = {gabbaiLink: {gabbaiName: string; partnerName: string} | null; request: {fromUserId: string;
    fromName: string} | null; imported: boolean; phoneAsk: boolean; terms: boolean}`; `Child = {id: string;
    firstName: string; gender: 'm' | 'f'; birthDate?: string}`; `FamilyView` (as in the Data model);
    `Candidate = {userId; displayName; cooldownUntil?: number}`; `PhoneListFamily = {familyId; name; people:
    {userId; name; phone}[]}`; `TargetFamily = {familyId; name; firstNames: string[]; targetMemberId}`;
    `AdminFamily`; `ExportLink = {url: string; expiresAt: number}`; `Message.targetFamilyId?`;
    `PostMessageBody.targetFamilyId?`.
  - Endpoints (names fixed; later tasks use them): `putPhone(phone|null)`, `age13Consent()`, `exportStatus()`
    (GET), `startExport()` (POST), `deleteMe(o?: {deletePosts?: boolean})` (adds `?deletePosts=1`),
    `dismissCard(k, card)`, `putPhoneList(k, show)`, `phoneList(k)`, `family(k)`, `addChild(k, c)`,
    `editChild(k, id, c)`, `removeChild(k, id)`, `familyCandidates(k)`, `requestPartner(k, toUserId)`,
    `withdrawPartnerRequest(k)`, `confirmPartner(k, fromUserId)`, `declinePartner(k, fromUserId)`, `unlink(k)`,
    `targetFamilies(k, channelId)`, `adminFamilies(k)`, `adminLink(k, a, b)`, `acceptTerms(k)`,
    `putSettings(k, {maxListeners?, privacyContact?})`.
  - Fixtures (invented names only, e.g. "משפחת ניסיון", "דנה בדויה", "אבי דמיון"): the fixture API answers
    every new endpoint; `FIXTURE_APP_SCREENS` gains `phone-list`, `phone-list-empty`, `me-family`, `me-request`,
    `me-linked`, `partner-picker`, `child-sheet`, `privacy`, `privacy-ready`, `kehila-info`, `leave-listener`,
    `home-card` (with `&card=gabbai|request|imported|terms|phone|phone-nonumber`), `age13`, `age13-under`,
    `terms`, `profile-age`, `delete`, `delete-ticked`, `admin-families`, `admin-link`, `overview-privacy`,
    `compose-family`. Each screen's data matches its P-frame's main state.
- [ ] **Step 1: Write `tests/endpoints-families.test.ts`** with a recording fake `Http`: each endpoint above
  issues the expected method and path (e.g. `deleteMe({deletePosts: true})` → `DELETE /v1/me?deletePosts=1`,
  `requestPartner('K', 'U')` → `POST /v1/kehilot/K/family/requests` body `{toUserId: 'U'}`), and
  `fixture api returns a phone list with no children fields`.
- [ ] **Step 2: Run** `node --test tests/endpoints-families.test.ts` → FAIL.
- [ ] **Step 3: Implement.** **Step 4: Run** `npm test`, then `npm run typecheck` → PASS.
- [ ] **Step 5: Commit** ("Client: families, phone list and privacy endpoints and fixtures").

### Task 12: App: phone list (P1), Me phone card (P4), Home entry card

**Files:**
- Create: `src/client/phone.ts`, `src/client/phoneListView.ts`, `src/views/PhoneList.tsx`,
  `src/views/me/PhoneCard.tsx`, `tests/phone.test.ts`, `tests/phoneListView.test.ts`
- Modify: `src/views/Main.tsx` (nav `{tab: 'phoneList'}`, fixture routes), `src/views/Home.tsx` (entry Card),
  `src/views/Me.tsx` (card order per UX §10.1), `src/client/store.ts` (`setPhone`, `setShowPhone` update `me` /
  `kehila`)

**Interfaces:**
- Consumes: Task 10 (kit, copy), Task 11 (`putPhone`, `putPhoneList`, `phoneList`).
- Produces:
  - `phone.ts` (same rules as `server/cloud/phones.py`): `normalizePhone(raw) -> string | null`;
    `formatPhone(e164) -> string` (`+9725XXXXXXXX` → `05X-XXXXXXX`, `+9727XXXXXXXX` → `07X-XXXXXXX`,
    `+972` landline → `0X-XXXXXXX`, others unchanged with `+`); `telUrl(e164)` = `tel:<e164>`;
    `whatsappUrl(e164)` = `https://wa.me/<digits without +>`.
  - `phoneListView.ts`: `filterFamilies(rows: PhoneListFamily[], q: string) -> PhoneListFamily[]` (every query
    word must occur in the family name or a person's name, using `src/search/normalize.ts`; empty query → all),
    `sortFamilies(rows)` (`Intl.Collator('he')` on `name`).
  - `PhoneList` (P1, UX §10.1 row P1, copy `phoneList.*`): Back, title, intro, search, count, one Card per family
    (serif name; per person: name, number LTR tabular via `formatPhone`, two secondary Buttons `☎ חיוג` /
    `וואטסאפ` with the a11y labels) → `Linking.openURL`; privacy note and "my settings" link (opens Me). States:
    loading spinner, error Banner + retry, empty (`phoneList.empty`, plus `emptyJoin` + `showMine` button when
    my switch is off), no results (`noResults`, `noResultsHint`). The list lives in component state only.
  - `PhoneCard` (P4, copy `me.phone.*`): after Profile; my number, add/change/remove with `Field` (Save disabled
    when empty; `me.phone.invalid` when `normalizePhone` is null; server 400 `invalid_phone` shows the same),
    Toggle "show my phone in <Kehila>'s list" (hidden without a number; `offNote` = `me.phone.switchOff`),
    `me.phone.who`, "open the phone list". Toasts `me.phone.saved` / `removed` / `shown` / `hidden`. Hidden for
    listeners.
  - Home: a pressable Card under the Shabbat card (`home.phoneList`, `home.phoneListSub`), members and gabbaim
    only (UX §10.4 decision 4).
- [ ] **Step 1: Write the tests:** `tests/phone.test.ts` with the server's cases (`normalize matches server
  cases`) plus `formats Israeli mobile and landline`, `whatsapp link has digits only`;
  `tests/phoneListView.test.ts`: `search matches first or last name ignoring niqqud`, `every word must match`,
  `sorts with Hebrew collation`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: UI verification** for P1 (`phone-list`, `phone-list-empty`) and P4 (`me`) against
  `P1.html` and `P4.html`; also confirm a listener's `me` has no phone card and Home has no entry Card.
- [ ] **Step 6: Commit** ("App: phone list, phone card and Home entry").

### Task 13: App: My family (P2), partner picker, child sheet (P3)

**Files:**
- Create: `src/client/familyView.ts`, `src/views/me/FamilyCard.tsx`, `src/views/me/PartnerPicker.tsx`,
  `src/views/me/ChildSheet.tsx`, `tests/familyView.test.ts`
- Modify: `src/views/Me.tsx`

**Interfaces:**
- Consumes: Tasks 10–11 (`family`, `addChild`, `editChild`, `removeChild`, `familyCandidates`,
  `requestPartner`, `withdrawPartnerRequest`, `confirmPartner`, `declinePartner`, `unlink`).
- Produces:
  - `familyView.ts`:
    - `parseBirthDate(typed: string, today: string) -> {ok: 'YYYY-MM-DD' | ''} | {error: 'invalid' | 'future'}`
      (`d.m.yyyy`, also `dd.mm.yyyy`; empty → `{ok: ''}`; same range rule as the server);
    - `formatBirthDate('YYYY-MM-DD') -> 'd.m.yyyy'`;
    - `familyState(v: FamilyView) -> 'linked' | 'received' | 'sent' | 'declined' | 'expired' | 'alone'`
      (in that priority);
    - `canAddChild(v) = v.children.length < 20`.
  - `FamilyCard` (P2, copy `family.*`, `children.*`): adults with Tag "אני" on me; the action for the state
    (add partner / Tag "ממתין לאישור" + `family.sentBody` + withdraw / received Banner + confirm / don't confirm
    with `declineNote` / not-confirmed or expired Banner with dismiss → `withdrawPartnerRequest` / linked →
    unlink with the inline confirm `family.unlinkConfirm`, danger + keep); then children (`children.title` with
    n, rows with son/daughter and date, edit; `children.empty`; add disabled with `children.max` at 20;
    `children.shared` note). Shown to members and gabbaim only.
  - `PartnerPicker`: Sheet with `PickList` over `familyCandidates` (title `family.pick.title`, hint, body,
    footer `family.pick.send`); a row with `cooldownUntil` shows `family.pick.cooldown` and disables send; 409
    `partner_taken` → `family.pick.taken`; `request_cooldown` → cooldown text; none → `family.pick.none`.
  - `ChildSheet` (P3, `children.form.*`): first name (60 code points), two Chips son/daughter (required,
    `pickGender`), date Field with `birthHint`, errors `birthInvalid` / `birthFuture`; edit adds remove with the
    inline confirm; toasts `saved` / `removed`. A 409 `try_again` retries once silently.
- [ ] **Step 1: Write `tests/familyView.test.ts`:** `parses d.m.yyyy and pads`, `rejects 30.2 and letters`,
  `future date is future`, `state priority prefers received over sent`, `limit at 20`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npm test`, typecheck → PASS.
- [ ] **Step 5: UI verification** against `P2.html` (`me-family`, `me-request`, `me-linked`, `partner-picker`)
  and `P3.html` (`child-sheet`).
- [ ] **Step 6: Commit** ("App: my family, partner requests, children").

### Task 14: App: Home one-time cards (P7)

**Files:**
- Create: `src/client/homeCard.ts`, `src/views/HomeCards.tsx`, `tests/homeCard.test.ts`
- Modify: `src/views/Home.tsx`, `tests/push.test.ts`

**Interfaces:**
- Consumes: Task 11 (`Kehila.cards`, `dismissCard`, `confirmPartner`, `declinePartner`, `unlink`, `putPhone`,
  `putPhoneList`), Task 12 (`normalizePhone`), Task 16's `TermsGate` route (the terms card's button opens it;
  until Task 16 lands, the button opens management mode).
- Produces:
  - `pickHomeCard(cards: HomeCards, role: Role) -> 'gabbaiLink' | 'request' | 'imported' | 'terms' | 'phone' | null`
    in that fixed order (UX §10.4 decision 1); `terms` only for gabbai, `phone` only for member/gabbai.
  - `HomeCards` renders one `Card` under the greeting, above zmanim, with `edgeColor`: tekhelet (gabbaiLink,
    request, phone), ash (imported), gold (terms). Copy `cards.*`. Actions:
    - gabbaiLink: "that's right" → `dismissCard('gabbai_link')`; unlink → inline confirm → `unlink(k)`;
    - request: confirm / don't confirm → `confirmPartner` / `declinePartner`;
    - imported: "got it" → `dismissCard('imported')`, with `cards.imported.leave` and the privacy link;
    - terms: "read and accept" → the terms gate;
    - phone: with a number "yes, show" → `putPhoneList(k, true)`; without, a Field inside and "save and show"
      (disabled until `normalizePhone` passes) → `putPhone` then `putPhoneList`; "not now" →
      `dismissCard('phone')`.
    After each action `refreshKehila()`; the next card (if any) shows.
  - A push with `screen: 'family'` lands on Home (existing `pushDestination` → `'home'`).
- [ ] **Step 1: Write the tests:** `tests/homeCard.test.ts`: `priority order`, `listener never gets phone or
  terms`, `member never gets terms`, `none when nothing pending`; in `tests/push.test.ts`:
  `family screen opens home`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npm test`, typecheck → PASS.
- [ ] **Step 5: UI verification** against `P7.html`: `home-card` with each `card=` value, plus one dark-mode
  shot (`node ~/tools/qa-browser/act.mjs <url> <out> 390 900 dark`).
- [ ] **Step 6: Commit** ("App: one-time Home cards").

### Task 15: App: age gate (P8) and profile setup tick (P9)

**Files:**
- Create: `src/views/Age13Gate.tsx`
- Modify: `src/CloudApp.tsx` (right after the `route === 'setup'` line and before the Join screen:
  `if (state.me?.age13Required) return <Age13Gate />`; a pending invite waits behind it),
  `src/views/ProfileSetup.tsx`, `src/client/store.ts` (`saveProfile(p, {age13})`, new `acceptAge13()`),
  `src/client/SessionProvider.tsx` (expose `acceptAge13()`)
- Test: `tests/store.test.ts`

**Interfaces:**
- Consumes: Task 10 (`Check`), Task 11 (`age13Consent`), plan 3's `deleteAccount` / `signOut`.
- Produces:
  - `Age13Gate` (P8, age part, copy `age13.*`): AuthFrame, no TopBar or tabs; `Check` `age13.check`, Continue
    disabled until ticked → `acceptAge13()`; "I am under 13" swaps in a Banner `age13.underBody` with delete
    account (opens `DeleteAccount`) and sign out.
  - `ProfileSetup` (P9): today's form plus `Check` `profileSetup.age13` (unticked) with
    `profileSetup.age13Note`, and the `profileSetup.privacy` link (`/privacy` in the browser via
    `Linking.openURL(config.webUrl + '/privacy/')`). Continue needs a first name and the tick.
  - `store.saveProfile(p, {age13: true})` calls `putProfile`, then `age13Consent()`, then `loadMe()` before it
    computes the route, so `me.age13Required` is already false and the gate never flashes after setup.
  - `store.acceptAge13()`: `age13Consent()` then `loadMe()`.
- [ ] **Step 1: Write the tests** in `tests/store.test.ts`: `profile save records age13 before loading me` (fake
  api call order `putProfile`, `age13Consent`, `me`) and `acceptAge13 reloads me` (after it,
  `getState().me.age13Required === false`).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npm test`, typecheck → PASS.
- [ ] **Step 5: UI verification** against `P8.html` (`age13`, `age13-under`) and `P9.html` (`profile-age`).
- [ ] **Step 6: Commit** ("App: age 13 gate and profile tick").

### Task 16: App: terms gate (P8) and gabbai privacy contact and terms cards (P12)

**Files:**
- Create: `src/views/TermsGate.tsx`, `src/views/admin/PrivacyContactCard.tsx`
- Modify: `src/views/Main.tsx` (management tabs → `TermsGate` while `kehila.cards.terms`),
  `src/views/admin/Overview.tsx`, `src/views/HomeCards.tsx` (terms button opens the gate)

**Interfaces:**
- Consumes: Task 11 (`acceptTerms`, `putSettings`, `Kehila.termsAccepted`, `privacyContact`), Task 14.
- Produces:
  - `TermsGate` (P8, terms part, copy `terms.*`): replaces every management tab of that Kehila while
    `cards.terms` is true; title (`terms.updatedTitle` when `termsAccepted` exists, i.e. a new version),
    `terms.intro`, `p1`–`p4`, `terms.read` → `<webUrl>/terms/`, one primary button `terms.accept` →
    `acceptTerms(k)` → toast `terms.accepted` and `refreshKehila()`; `terms.others` note. The rest of the app
    (phone list included) is never blocked (spec §10.7).
  - `PrivacyContactCard` (P12) in Overview: the view/edit pattern of the listener-cap card; `Field` with
    `maxCodePoints={100}` (counter red and Save disabled over 100) → `putSettings(k, {privacyContact})`;
    `admin.overview.privacy.*`. A second Card: `admin.overview.terms.title` and `accepted` with name and date.
    (On desktop the same card shows in Overview; a GD3 settings tab does not exist yet.)
- [ ] **Step 1: Implement** (no pure logic beyond what earlier tests cover; the gate condition is
  `kehila.cards.terms`).
- [ ] **Step 2: Verify:** typecheck and `npm test` → PASS; UI verification against `P8.html` (`terms`) and
  `P12.html` (`overview-privacy`, and the over-100 state by typing via `act.mjs`).
- [ ] **Step 3: Commit** ("App: terms gate, privacy contact and terms cards").

### Task 17: App: Privacy and data (P5), About this Kehila (P13), leaving (P6)

**Files:**
- Create: `src/views/me/PrivacyCard.tsx`, `src/views/me/KehilaInfo.tsx`, `src/client/exportView.ts`,
  `tests/exportView.test.ts`
- Modify: `src/views/Me.tsx` (order per UX §10.1; the leave Card for listeners too, with `me.leave.*` lines),
  `src/views/KehilaSwitcher.tsx` (current-Kehila row opens `KehilaInfo`)

**Interfaces:**
- Consumes: Task 11 (`exportStatus`, `startExport`, `Kehila.privacyContact`, `family`).
- Produces:
  - `PrivacyCard` (P5, every role, copy `privacy.*`, `export.*`): the Kehila contact as typed or
    `privacy.contactNone`; `privacy.about` → `KehilaInfo`; `privacy.policy` → `<webUrl>/privacy/`; export:
    on mount `exportStatus()` (200 → ready, 404 → idle); idle "prepare" → `startExport()` with the busy Button and
    `export.preparing`; ready → success Banner, primary "download" → `Linking.openURL(url)`; when the link is
    older than its `expiresAt`, "download" first calls `exportStatus()` for a fresh one; 429 → limit Banner and
    a disabled Button; error → `export.failed` with retry. The URL is held in component state only, never
    logged or stored. `photosOmitted` is not shown (it is in the file).
  - `KehilaInfo` (P13): Sheet titled with the Kehila name: my role (Tag), the privacy contact,
    `kehilaInfo.roles`, privacy policy and terms links.
  - Leave (P6): listeners get the same Card and inline confirm (`me.leave.confirmListener`); a member with a
    partner sees `me.leave.family` (partner name from `family(k)`); everyone sees `me.leave.posts`. No posts box.
  - `src/client/exportView.ts` (new): `exportState(r: {link: ExportLink} | {code: string}) -> 'ready' | 'idle' |
    'limit' | 'failed'` (`export_not_found` → idle, `export_limit` → limit, any other code → failed) and
    `needsFreshLink(link: ExportLink, nowSeconds: number) -> boolean` (true within 30 s of `expiresAt`).
- [ ] **Step 1: Write** `tests/exportView.test.ts`: `404 is idle`, `429 is limit`, `other errors fail`,
  `link near expiry needs a fresh one`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npm test`, typecheck → PASS.
- [ ] **Step 5: UI verification** against `P5.html` (`privacy`, `privacy-ready`), `P13.html` (`kehila-info`),
  `P6.html` (`leave-listener`, `me` as a member with a partner).
- [ ] **Step 6: Commit** ("App: privacy and data, about this Kehila, leaving for listeners").

### Task 18: App: account deletion (P10)

**Files:**
- Modify: `src/views/DeleteAccount.tsx`, `src/client/account.ts`, `tests/deleteAccount.test.ts`

**Interfaces:**
- Consumes: Task 11 (`deleteMe({deletePosts})`), Task 10 (`Check`).
- Produces:
  - `deleteAccount(api, signOut, sleep?, o?: {deletePosts?: boolean})`: passes the flag on **every** retry;
    `try_again` joins `internal` and `network` as retryable.
  - DeleteAccount (P10): items `i1`–`i5` (new `i4`, `i5`); a Card with `Check` `deleteAccount.posts` (unticked),
    under it `postsOff` (muted) or `postsOn` (ink), then `always` and `backups`; the link `exportFirst` → Me's
    privacy card; then today's type-the-word Card. `deleteAccount.kept` is no longer rendered.
- [ ] **Step 1: Write the tests:** `passes deletePosts on every retry`, `retries try_again`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npm test`, typecheck → PASS.
- [ ] **Step 5: UI verification** against `P10.html` (`delete`, `delete-ticked`).
- [ ] **Step 6: Commit** ("App: delete everything I posted").

### Task 19: App: gabbai members and families (P11), link sheet

**Files:**
- Create: `src/views/admin/FamilyBlock.tsx`, `src/views/admin/LinkSheet.tsx`
- Modify: `src/views/admin/Members.tsx`, `src/client/membersView.ts`, `tests/membersView.test.ts`

**Interfaces:**
- Consumes: Task 11 (`adminFamilies`, `adminLink`), Task 10 (`PickList`, `Tag`).
- Produces:
  - `membersView.familyLine(userId, families: AdminFamily[]) -> {partnerName: string | null; children: number}`
    and `linkCandidates(members, families, exceptUserId)` (members and gabbaim whose family has one adult).
  - Members: each card (and a "family" column at ≥ `WIDE`) gets `admin.members.familyWith` + `children` or
    `familyAlone`; "פעולות" shows `FamilyBlock` (adults, children with birth year, `admin.members.readOnly`);
    `admin.members.link` (only without a partner) opens `LinkSheet`: first person fixed, `PickList` of
    `linkCandidates`, `admin.link.notice`, button `admin.link.confirm` with both names → `adminLink` → toast
    `admin.link.done`; 409 `partner_taken` → Banner `admin.link.taken` in the Sheet. No phone numbers here.
- [ ] **Step 1: Write the tests:** `family line with partner and children`, `alone`, `link candidates exclude
  linked people and self`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npm test`, typecheck → PASS.
- [ ] **Step 5: UI verification** against `P11.html` (`admin-families` at 390 and 1440, `admin-link`).
- [ ] **Step 6: Commit** ("App: gabbai families view and link").

### Task 20: App: blessing picker by family (P14)

**Files:**
- Modify: `src/views/Compose.tsx`, `src/client/SessionProvider.tsx` (`targetFamilies(channelId)` like
  `directory`), `src/client/familyView.ts`, `tests/familyView.test.ts`

**Interfaces:**
- Consumes: Task 11 (`targetFamilies`), Task 10 (`PickList`), Task 5 (server rows).
- Produces:
  - `familyView.familyRows(rows: TargetFamily[], t) -> {id, title, subtitle}[]`: `title = name`, `subtitle` =
    one first name, or `compose.familyAnd` with two; sorted with `Intl.Collator('he')`.
  - Compose: the picker lists `targetFamilies(channelId)` rows; the draft stores `targetFamilyId` and that row's
    `targetMemberId` and sends both; `compose.familyNote` under the picker; a chosen family that is not in the
    new channel's rows is dropped (as today). The `compose-target` fixture keeps working with a family id.
- [ ] **Step 1: Write the test:** `family rows subtitle joins two first names`, `sorted by name`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npm test`, typecheck → PASS.
- [ ] **Step 5: UI verification** against `P14.html` (`compose-family`).
- [ ] **Step 6: Commit** ("App: blessing target picker by family").

### Task 21: Privacy and terms pages, platform-contact substitution, breach procedure

**Files:**
- Modify: `public/privacy/index.html`, `tools/deploy_web.sh`, `.gitignore`
- Create: `public/terms/index.html`, `tools/fill_contact.py`, `server/tests/cloud/test_fill_contact.py`,
  `docs/BREACH-PROCEDURE.md`

**Interfaces:**
- Produces:
  - `public/privacy/index.html` rewritten, Hebrew first then English, covering spec §8 point by point: roles
    (each Kehila responsible; Kehilot runs the platform); what is stored and why; families and the phone list;
    who sees what (listeners, members, gabbaim; private blessings only the family and the author); deletion and
    the "everything I posted" option; the 35-day backups (DynamoDB point-in-time recovery); download my data;
    minimum age 13; sub-processors (AWS in Israel, il-central-1; Expo push with generic texts only; Google/Apple
    when used to sign in); each Kehila's contact in the app; the platform contact `{{PLATFORM_CONTACT}}`. Claude
    drafts both languages; a version line ("עודכן 27.10.2026 / Updated 27 October 2026").
  - `public/terms/index.html`: the Kehila–Kehilot terms (spec §6.3: what the platform does with the data,
    security, sub-processors, deletion at the end, the Kehila as controller and Kehilot as processor), Hebrew then
    English, the version `2026-10-27` (= `consents.VERSIONS['kehilaTerms']`) and `{{PLATFORM_CONTACT}}`. Same
    page style as the privacy page.
  - `tools/fill_contact.py --env dev --dist dist/web`: the value comes from env `KEHILOT_PLATFORM_CONTACT`, else
    the line `PLATFORM_CONTACT=<value>` in `infra/envs/<env>/site.env`. It must match
    `^[^@\s<>"']+@[^@\s<>"']+\.[^@\s<>"']+$`; it is HTML-escaped and replaces every `{{PLATFORM_CONTACT}}` in
    `<dist>/privacy/index.html` and `<dist>/terms/index.html`. Exit 1 with a message naming the setting (never the
    value) when it is missing or invalid, when a file is missing, when a file has no placeholder, or when one
    remains after replacing. `fill(text, contact) -> str` and `read_contact(env, environ, root) -> str` are
    importable.
  - `tools/deploy_web.sh`: after the export and the existing checks, `python3 tools/fill_contact.py --env
    "$ENV_NAME" --dist "$DIST"` (the script stops on failure, before any sync); also check
    `$DIST/terms/index.html` exists before syncing; upload it with `text/html; charset=utf-8` and `no-cache` like
    the privacy page; add `/terms /terms/ '/terms/*'` to the invalidation.
  - `.gitignore`: `infra/**/site.env`.
  - `docs/BREACH-PROCEDURE.md` (spec §8): who does what on a suspected breach — contain (rotate/disable, keep
    evidence), assess (what data, which Kehilot, how many people, whether religion-revealing membership data
    is involved), record (a log entry with times and decisions, kept outside the repo); notify the Israeli
    Privacy Protection Authority for a severe incident, the EU authority within 72 hours where GDPR applies, the
    affected Kehilot (controllers) and people; the concrete AWS levers (Cognito global sign-out, disabling the
    app client, CloudTrail, PITR); a template for the log. No real names or the contact address.
- [ ] **Step 1: Write `test_fill_contact.py`:** `test_fill_escapes_and_replaces_all`, `test_missing_setting_fails`,
  `test_invalid_value_fails`, `test_env_overrides_file`, `test_page_without_placeholder_fails`, and
  `test_public_pages_have_no_email`: both files in `public/` contain `{{PLATFORM_CONTACT}}` and nothing matching
  an email pattern.
- [ ] **Step 2: Run** `.venv/bin/python -m unittest server.tests.cloud.test_fill_contact -v` → FAIL.
- [ ] **Step 3: Implement** the pages, the tool, the script change, `.gitignore` and the procedure.
- [ ] **Step 4: Run** the module → PASS; `bash -n tools/deploy_web.sh`; shoot both pages from `public/` with
  `shoot.mjs` (file URLs) at 390 px and read them (RTL, then LTR English section).
- [ ] **Step 5: Commit** the seven files ("Privacy and terms pages, contact substitution, breach procedure").

### Task 22: Smoke test additions

**Files:**
- Modify: `tools/smoke_dev.py`

**Interfaces:**
- Consumes: every server task.
- Produces new checks, called from `run()` before `check_account_deletion`:
  - `check_family_link_and_replies`: two members of a smoke Kehila request/confirm → same `familyId`; a third
    member's blessing to one of them gets a reply that both partners read and a gabbai does not; unlink → the
    ex-partner reads none.
  - `check_phone_list_rules`: member A sets a phone and switches on → B (member) sees it; a listener gets 403;
    another smoke Kehila's member gets 404; switching off removes it at once.
  - `check_children_hidden`: A adds a child → the phone list and `families?channelId=` bodies contain no
    `children` key and not the child's name.
  - `check_export`: POST → 200 with a URL that downloads a ZIP containing `data.json` (no other member's name);
    a second POST → 200; the object is under `x/`.
  - `check_delete_posts`: a throwaway user posts a message with an image, then `DELETE /v1/me?deletePosts=1` →
    the message reads as removed for others, the image object is gone.
  - `check_terms_and_age`: a fresh user has `age13Required: true` until the consent POST; the smoke gabbai sees
    `cards.terms: true` until it accepts.
  - The cleanup also deletes `x/<userId>/` objects of the smoke users and every `F#`/`PR#`/`PS#`/`PD#` item of
    the smoke Kehilot (they are under `K#<k>`, so the existing per-Kehila cleanup covers them; check it does).
  - All names invented (e.g. "Smoke Example").
- [ ] **Step 1: Implement.** `python3 -m py_compile tools/smoke_dev.py` → OK. (It runs against dev only after
  Task 23's deploy; the dev does not run it.)
- [ ] **Step 2: Commit** ("Smoke: families, phone list, export, delete posts, consents").

### Task 23: Apply, migrate, deploy and final QA (CTO runs)

**Files:**
- Modify: `HANDOFF.md` (a dated entry), `server/API.md` (check complete)

The CTO runs every step here; no dev task applies or deploys.
- [ ] **Step 1:** On `redesign` with Tasks 1–22 merged: the Python suite, `npm test`, `npm run typecheck` (one at
  a time) → all pass.
- [ ] **Step 2:** `.venv/bin/python tools/build_lambda.py`; in `infra/envs/dev`: `terraform plan -out=dev.tfplan`.
  Read it: only in-place changes (media lifecycle, API role policy, Lambda code for api/push/jobs/triggers).
  **Stop** if anything would replace the user pool, an app client, the table or the API. Then
  `terraform apply dev.tfplan`. Delete `dev.tfplan`.
- [ ] **Step 3:** `.venv/bin/python tools/kehila_admin.py backfill-families --env dev` → prints the counts; run it
  again → `created=0`.
- [ ] **Step 4:** Put the user's contact in `infra/envs/dev/site.env` (`PLATFORM_CONTACT=…`, git-ignored; check
  `git status` shows nothing), then `npm run deploy:web`. Confirm `<web_url>/privacy/` and `/terms/` show the
  address and no `{{PLATFORM_CONTACT}}`.
- [ ] **Step 5:** `.venv/bin/python tools/smoke_dev.py` → every check passes, twice, nothing left behind.
- [ ] **Step 6:** Final fixture QA: P1–P14 screens at 390 px in `he`, P1/P2/P5/P10 in `en`, P11 at 1440, P7 dark.
  List what was not checked: native `tel:` and WhatsApp hand-off, push on a phone, VoiceOver/TalkBack, real
  device fonts.
- [ ] **Step 7:** Commit `HANDOFF.md` and any API.md fixes ("Families and privacy pack: deployed to dev").

---

## User steps (only the user can do these)

- **U1:** Give the platform contact email for the privacy and terms pages (Task 23 Step 4 puts it in the
  git-ignored `infra/envs/dev/site.env`).
- **U2:** Have a lawyer review the terms (`public/terms/index.html`, the in-app summary `terms.p1`–`p4`) and the
  privacy page, including the age (GDPR lets EU states set 13–16) and the 35-day backup wording.
- **U3:** A native Hebrew editor reviews the §10.3 copy.
- **U4:** On a phone: the call and WhatsApp buttons open the dialer and WhatsApp; the family pushes arrive
  with the generic text and open Home; the export downloads and opens on iOS and Android.

---

## Self-review notes

- Spec coverage: §3.1 rules → Tasks 1, 3, 4; §3.2 → Tasks 1, 2; §3.3 and §10.2–10.3 → Task 5; §4 → Tasks 6, 12,
  14; §5 → Tasks 8, 17, 18, 7 (imported card); §6.1 → Tasks 6, 7; §6.2 → Tasks 7, 15; §6.3 → Tasks 7, 16, 21;
  §7 → Tasks 9, 17; §8 → Task 21; §10.5 → Tasks 4, 19; §10.8 → Task 9; §10.9 → Tasks 1, 23.
- Conflicts resolved in this plan: "never signed in" detection (Task 8); export within the API's 20 s Lambda and
  30 s gateway limit, by a deadline guard and `photosOmitted` instead of an async job (Task 9); replies after the
  stored target member leaves go to the remaining adults (Task 5); a merge may exceed 20 children (Task 3); the
  terms gate is client-side, the server records (Task 7); the removed post's text is scrubbed (Task 8); family
  push texts are not gabbai-editable (Task 3); "demoted to listener" has no route, so no hook (Task 4).
