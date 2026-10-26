# Kehilot on AWS: architecture, Terraform and deployment (2026-10-26)

Status: **approved by the user, 2026-10-26** (draft 2 after builder check), on branch `redesign`. Nothing is deployed. The UX is being designed in parallel
(`docs/UX-DESIGN.md`, `design/mockups/`); this document covers the backend, infrastructure and delivery.
Items marked **[call]** are the author's decisions, open to change. Items marked **[open]** need the user.

## 1. Intent

Noam's app is a polished single-community Hebrew app (Expo, iOS/Android/web) with a Python 3.11 + SQLite
server that runs on one machine. The goal is to turn it into a **multi-tenant service on AWS**: each
synagogue community (Kehila) is a tenant, people can belong to several Kehilot, and the service costs
close to nothing at the first Kehila's size while needing no servers to babysit.

The user prefers AWS. Noam knows about and accepts the move.

## 2. Goals, non-goals, anti-goals

**Goals**
- Multi-tenant from day one: every stored item belongs to one Kehila; one login, many Kehilot, a role per Kehila.
- Serverless and near-free at small scale: target **under $5/month** for the first Kehila (≈70 families,
  ≈100 visitors, 3 gabbaim), excluding Apple/Google developer fees.
- Everything reproducible from Terraform; two environments, `dev` and `prod`.
- Keep Noam's domain logic (Hebrew calendar, roster/bar-mitzvah promotion, aliyah windows, seating rules,
  family identities) in Python and port it, not rewrite it.
- Push notifications that reach closed phones within seconds; polling while the app is open.

**Non-goals (for now)**
- MQTT / AWS IoT Core, WebSockets, live chat, presence. Revisit only if real chat is added.
- WAF, multi-region, cross-region backups, a custom analytics pipeline.
- Cloud native builds (EAS Build). Native iOS/Android compilation stays on Noam's Mac (`AGENTS.md`).
- Migrating data from SQLite: there is no real community database yet, so production starts empty.

**Anti-goals (failure even if it works)**
- Any data visible across Kehilot. Tenant isolation is the first thing tested.
- Personal data inside push payloads. Pushes stay generic ("new message"); content is fetched by the
  authenticated app (Noam's existing rule in `server/push.py`).
- Surprise bills. Budgets and alarms exist before the first real user.
- Long-lived AWS keys in GitHub or on laptops.

## 3. Constraints

- Hebrew/RTL app, users in Israel.
- Repo `AGilai/kehilot` is going private on a free GitHub plan: GitHub Pages is unavailable, Actions
  minutes are limited (2,000/month), and environment protection rules (required reviewers) are not available.
- This EC2 dev box is small (2 GB RAM, no Docker). It has no Terraform, AWS CLI or AWS credentials yet.
  The infrastructure is fully separate from the Flow-Mapper service running on this box.
- Two developers (the user and Noam), both need AWS access without sharing keys.

## 3a. Product rules the backend must enforce (from the brainstorming with the user)

- **Roles per Kehila**: `listener` (joined through a member's invite link; reads general channels only; no
  directory, family data, seating or posting), `member` (approved by a gabbai, who also classifies: '' / א /
  קבוע), `gabbai` (management). Platform admins (the user, Noam) create Kehilot.
- **Joining**: a member creates an invite link (expires, records the inviter, limited uses). The newcomer
  opens it, signs up in Cognito and becomes a `listener` of that Kehila at once. A listener can request
  membership, which creates a `REQ` item; a gabbai approves and classifies. There is no public Kehila search.
- **Creating a Kehila** **[call]**: a platform-admin CLI (`server/manage.py` successor) creates the Kehila,
  its default channels and the first gabbai's invite. A platform-admin web screen can come later.
- **Channels are in scope.** Each Kehila has channels (default: announcements, simchas, condolences) and
  message types. Management messages go to all members of the channel.
- **Member broadcasts**: allowed per member by `canBroadcast` on the Membership item; the gabbai screen
  has allow-all / block-all bulk actions plus per-member switches; the Kehila stores the default for new
  members. Management can always post; management can remove any message; authors can delete their own.
- **Private replies** **[decided by the user, 2026-10-26]**: replies to a blessing/condolence about a family
  are visible only to that family and the reply's author. Gabbaim/management cannot see them (unless they
  are that family); there is no moderation view.
  Everyone who can see the message also sees a count chip, "N members sent private blessings to <family>"
  (distinct repliers; no names, no text) — it encourages others to bless **[decided by the user, 2026-10-26]**.
- **Notification preferences** per member and Kehila: channels, message types, "broadcasts from management
  only". They affect pushes only; the API returns every message the caller may see, and the app filters
  "My messages / Everything" on the device.

## 3b. Languages (user's requirement, 2026-10-26)

- The app is **multi-language**: **Hebrew and English** first, more later. The language is chosen in
  **Settings**; the default on first launch follows the device (Hebrew if the device is Hebrew, otherwise English).
- **[call]** The choice is stored on the user's profile (`U#<userId>` / `PROFILE`, attribute `lang`) and cached
  on the device, so it follows the user to every device and the server knows it for pushes and emails.
  Before sign-in, the device setting is used.
- **[call]** Layout direction follows the language: RTL for Hebrew, LTR for English, switched at runtime
  (`I18nManager` on native, `dir` on web). Screens use logical start/end properties only.
- **[call]** All UI text lives in translation files (`src/i18n/he.json`, `src/i18n/en.json`); no literal UI
  strings in components. A missing key falls back to Hebrew and is caught by a test that compares key sets.
- **[call]** The API returns **error codes** (`{"error": "kehila_not_found"}`), not sentences; the app
  translates them. (Plan 1 returns Hebrew sentences; plan 2 switches to codes.)
- **[call]** Push text and Cognito/SES emails use the recipient's `lang` (push-worker picks the text per
  user; a Cognito custom-message trigger picks the email template).
- **Not translated:** content people write (messages, blessings, names). Hebrew dates, parasha and zmanim
  are shown in both languages (e.g. "Parashat Noach", "15 Cheshvan 5787"), using pyluach's English names.
- Kehila setting **[call]**: a default language for new members of that Kehila (an English-speaking
  community can default to English).

## 4. Architecture

```
 Phone app (Expo)          Web app (same Expo code, react-native-web)
   │  Cognito login (SRP)      │  served from CloudFront ← S3 (private, OAC)
   ▼                           ▼
 API Gateway HTTP API  ── JWT authorizer (Cognito user pool)
   │  /v1/...
   ▼
 Lambda "api" (Python 3.12, arm64) ──► DynamoDB table "kehilot-<env>" (on-demand, TTL, PITR in prod)
   │ publish
   ▼
 SQS "push" ──► Lambda "push-worker" ──► Expo Push API ──► APNs / FCM ──► phones
   ▲                                       (Expo token in SSM Parameter Store)
   │
 EventBridge Scheduler ──► Lambda "jobs": push receipts (every 15 min), roster refresh (daily 00:05 Israel)

 CloudWatch logs + alarms ──► SNS email   ·   AWS Budgets alert
```

### 4.1 Region
**[decided by the user, 2026-10-26]** `il-central-1` (Tel Aviv). It is an **opt-in region**; it was enabled in
account 180521634103 (dev and prod) on 2026-10-26. A future account must enable it before Terraform runs. IAM Identity Center has its own home region that cannot be
changed later; it may live in another region (e.g. `eu-central-1`) without affecting the workload. Use it for everything regional: lowest latency for users, data stays in
Israel. The builder must confirm that every service used here is available in `il-central-1` (Cognito,
HTTP API, Lambda arm64 Python 3.12, DynamoDB, SQS, EventBridge Scheduler, SSM). If any is missing, use
`eu-central-1` for the whole stack rather than splitting regions. CloudFront certificates (if a domain is
added) live in `us-east-1` by AWS rule.

### 4.2 Identity: Cognito
- One **user pool per environment**. Sign-in with email + password; email verification; self-service
  password reset (replaces Noam's CLI-only resets). Password policy ≥ 12 characters (Noam's current rule).
- One public app client (no secret) used by both phone and web, `USER_SRP_AUTH` + refresh tokens.
  **[call]** In-app Hebrew login/register screens calling Cognito directly (e.g. `amazon-cognito-identity-js`
  or Amplify Auth), not the hosted login page, so the RTL design from the UX work is kept.
- **[call, 2026-10-26]** The app sends the Cognito **ID token** as `Authorization: Bearer` (it carries `email`;
  API Gateway checks its `aud` against the client ID). The API never stores email; it reads it from the token.
- **Roles are not stored in Cognito.** Roles, classification and `can_broadcast` are per Kehila and live
  in DynamoDB. The API loads the caller's membership for the Kehila in the path on every request (one
  `GetItem`), so a role change takes effect immediately with no token refresh. **[call]**
- A `post-confirmation` trigger is not needed: the API creates the user's profile item lazily on first call.
- Platform admins (the user and Noam) are a Cognito group `platform-admin`; that is the only use of groups.

### 4.2a Onboarding and social sign-in (user's decisions, 2026-10-26)
- **Two directions into a Kehila.**
  - *Pull:* a member's invite link makes the newcomer a `listener` at once (as built in plan 2a).
  - *Push:* an invite created by a gabbai lets the gabbai choose `listener` or `member` (with classification). A
    member-role invite joins the person already approved, with no membership request.
- **Kehila onboarding from the gabbaim's list.** The gabbai (or a platform admin) imports an Excel/CSV with one
  row per person: first name, last name, email, role (listener/member/gabbai), classification. The import:
  - creates the people records;
  - pre-creates a Cognito account per email (`AdminCreateUser` with the invitation message suppressed). Each
    account gets a random password nobody knows (`AdminSetUserPassword`, permanent) and `email_verified=true`,
    so it is `CONFIRMED`;
  - pre-creates the Kehila membership with the role from the row.

  People then sign in through "forgot password" (a code by email) or with Google/Apple. **No shared default
  password**, by the user's choice.
  - An email that already has an account just gets the membership added.
  - A re-import is idempotent by email.
  - People without email are out of scope (user: everyone with a smartphone has one).
- **Google and Apple sign-in in plan 3**, next to email + password, through Cognito federation.
  - This needs a Cognito domain (an `amazoncognito.com` prefix until plan 4's own domain), a Google OAuth client,
    and an Apple Services ID + key. The user creates the Google and Apple credentials; they go to SSM, never git.
  - On iOS, Google requires Sign in with Apple too (App Store rule 4.8), so the two always come together.
  - A pre-sign-up trigger links a federated login to an existing account with the same verified email
    (`AdminLinkProviderForUser`), so a pre-loaded person who taps "Continue with Google" lands in the same
    account and memberships.
  - The app opens the provider through the system browser sheet (`expo-auth-session`), or native Apple sign-in
    on iOS. Email + password stays on the in-app Hebrew screens.

### 4.3 API
- **API Gateway HTTP API** with a Cognito JWT authorizer on all routes except `GET /health` and
  `GET /v1/invites/{code}` (shows the Kehila name for an invite link before sign-up).
- One Lambda (`api`) with an internal router, porting `server/app.py` routing. **[call]** One function
  keeps cold starts rare at this traffic and makes the port of Noam's code direct.
- Paths become tenant-scoped: `/v1/me` (my profile and my Kehilot), `/v1/kehilot/{k}/...` for everything
  else (messages, replies, reads, preferences, profile-in-Kehila, healing prayers, seating, admin routes).
  The old `/api/...` contract in `server/API.md` is the functional reference; the new contract is written
  as `server/API.md` v2 during implementation.
- Authorization in one place: a `require(kehila, roles)` helper that every handler calls before touching
  data. Every DynamoDB key used after it starts with that Kehila's ID.
- **Polling is cheap by design.** The app's periodic poll calls `GET /v1/kehilot/{k}/changes?since=<cursor>`,
  which queries only new/changed messages, replies and read marks (a key-range `Query` on a change feed
  sort key, a few items). Heavy views (roster, aliyah statistics, seating summary, member directory) are
  computed only when a screen asks for them, never on the poll. `/v1/me` is called on app start and on
  focus, not every poll. **[call]**
- Stage throttling: 20 requests/s, burst 50 **[call]**, plus Noam's per-member limits ported (registration
  limits move to Cognito; broadcast limit: a few per member per day, value configurable per Kehila).

### 4.4 Data: one DynamoDB table
On-demand billing, TTL enabled on attribute `expiresAt`, point-in-time recovery and deletion protection in
`prod`. Item layout **[call]**, to be refined by the builder:

| Item | PK | SK | Notes |
|---|---|---|---|
| Kehila | `K#<k>` | `META` | name, settings (member broadcasts default, poll seconds, broadcast daily limit) |
| Membership | `K#<k>` | `M#<user>` | role (listener/member/gabbai), classification (''/א/קבוע), canBroadcast, notification prefs, `personId` (the member's own Person item in this Kehila). GSI1: `U#<user>` / `K#<k>` lists a user's Kehilot |
| Channel | `K#<k>` | `C#<c>` | name, type, who may post |
| Message | `K#<k>` | `MSG#<ts>#<id>` | channel, type, author, authorKind (management/member), target family for blessings |
| Private reply | `K#<k>#MSG#<id>` | `R#<ts>#<id>` | visible only to the author and the target family |
| Read mark | `K#<k>#U#<user>` | `READ#<msgId>` | |
| Invite | `INV#<code>` | `META` | Kehila, inviter, `expiresAt` (TTL), uses left |
| Person / roster | `K#<k>` | `P#<personId>` | Noam's permanent `community_people`/`roster_people` identity, family links, tribe, dates |
| Aliyah service | `K#<k>` | `AL#<date>#<id>` | calls with person IDs and name snapshots |
| Seating event / report | `K#<k>` | `SE#<id>` / `SR#<eventId>#<household>` | reports get `expiresAt` = after the event (replaces Noam's cleanup worker) |
| Healing prayer | `K#<k>` | `HP#<owner>#<id>` | |
| Device | `U#<user>` | `D#<token>` | Expo push token, platform, last seen |
| Membership request | `K#<k>` | `REQ#<user>` | pending approvals queue for gabbaim |

User IDs are our own stable `userId`, mapped from the Cognito `sub` (see §7a). Email changes go through Cognito's verified-attribute flow.
A Person created by a gabbai without a login is linked to a login only through a gabbai-issued personal
invite that names that `personId` (no automatic matching by name or email). **[call]**

The change feed: every message, reply, edit/removal and read mark also bumps `K#<k>` / `CHG#<ts>#<id>`
items (with `expiresAt` after 30 days) so `/changes` is one small range query. **[call]**

Calculations that look relational (aliyah counts over 6/12 months, roster promotion at 13, seating
totals) load one Kehila's items with a single `Query` and compute in Python, as Noam's code does today.
One Kehila is a few thousand items at most. Multi-item writes that must be atomic (two seating numbers,
approval + classification) use `TransactWriteItems`.

### 4.5 Notifications
- Publishing a message writes it, then sends one SQS message `{kehila, messageId}`.
- `push-worker` (SQS trigger, batch 10, partial batch failures) resolves recipients: members with access
  to the channel who have not muted that type, skipping member-authored broadcasts for "management only"
  people; for a private reply, only the target family and the author. It sends to Expo in batches of
  100 tokens, deletes `DeviceNotRegistered` tokens, and stores ticket IDs for receipt checks.
- Failures retry through SQS: the event source mapping uses `ReportBatchItemFailures`, and the worker
  extends visibility (`ChangeMessageVisibility`) for backoff, then a dead-letter queue after 5 attempts with
  a CloudWatch alarm.
- Payload text is generic and in the recipient's language (`he` or `en`), chosen by message type; `title` is
  the Kehila's name, and `data` carries only `{kehila, messageId}` (or `{kehila, screen}`). No message
  title, body or author name is ever sent. Body by type (he / en):
  weekly "עדכון שבועי מהקהילה" / "Weekly update from your community";
  celebration "מזל טוב חדש בקהילה" / "New mazal tov in your community";
  condolence "הודעת אבל בקהילה" / "Condolence notice in your community";
  event "אירוע חדש בקהילה" / "New event in your community";
  unknown type "הודעה חדשה בקהילה" / "New message in your community";
  reply "ברכה חדשה" / "New blessing"; request "בקשת הצטרפות חדשה" / "New membership request".
- The Expo access token is an SSM Parameter Store `SecureString`; Apple/Google credentials live in the
  Expo project, not in AWS.
- The app polls while open; the interval comes from the Kehila's settings (default 30 s, dev 5 s).

### 4.5a Email from Cognito
Cognito's default sender is limited (about 50 emails/day) and often lands in spam. **[call]** Use it in
dev; for prod, send through Amazon SES from a verified domain, with Hebrew verification and password-reset
templates. This depends on the domain question (§9).

### 4.5b Account deletion and privacy
App Store and Google Play require in-app account deletion and a privacy policy. **In scope [call]**:
`DELETE /v1/me` removes the Cognito user, Membership items, Devices, read marks and the user's own
healing-prayer entries in every Kehila; the member's Person items are archived (identity kept, personal
fields cleared) so aliyah history stays consistent. A Hebrew privacy-policy page is served by the web app.

### 4.6 Scheduled jobs
EventBridge Scheduler → `jobs` Lambda:
- Every 15 minutes: Expo push receipts, prune dead tokens.
- Daily 00:05 Asia/Jerusalem: roster refresh (bar-mitzvah promotion at 13, derived classifications).
  Noam's 60-second worker is unnecessary at daily granularity; the same refresh also runs after profile saves.

### 4.7 Web hosting
- S3 bucket (private, Origin Access Control) + CloudFront, SPA fallback to `index.html`, long cache for
  hashed assets, no-cache for `index.html`.
- **[call]** One web app for members and the gabbai console (same Expo code; desktop layout for wide
  screens), so one distribution per environment. If the UX review decides the desktop console must be a
  separate app, add a second bucket/distribution; the module supports it.
- **[decided by the user, 2026-10-26]** Domain `meyodea.com` (Route 53, same account; its apex already serves
  another site through CloudFront and must not be touched). The app lives under the subdomain
  `kehilot.meyodea.com`: prod `app.kehilot.meyodea.com` / `api.kehilot.meyodea.com`, dev
  `dev.kehilot.meyodea.com` / `api.dev.kehilot.meyodea.com`. ACM certificates in `us-east-1` (CloudFront)
  and `il-central-1` (API custom domain), validated by DNS in the subzone.
- **[call]** The admin creates the `kehilot.meyodea.com` hosted zone once and adds its NS record to the
  `meyodea.com` zone by hand. The deployer role gets Route 53 record rights on that one subzone only (by
  zone ID), never on `meyodea.com`. Until then the `*.cloudfront.net` address works.

### 4.8 Observability and cost guard
- CloudWatch log groups with 30-day retention (14 in dev).
- Alarms → SNS email: API 5xx rate, Lambda errors, DLQ not empty.
- AWS Budgets: alert at $10 and $25 per month, per account.

### 4.9 Expected monthly cost (first Kehila, prod)
Lambda, API Gateway, SQS, Scheduler, DynamoDB on-demand, Cognito (under 10k MAU), CloudWatch at this
volume: within free tiers or cents. S3 + CloudFront: cents. SSM standard parameters: free. Realistic total
**$0–3/month**, provided polling stays on the small change-feed query (§4.3); polling whole-Kehila
queries every 30 s would cost $10+/month and is ruled out. The dev environment is similar. (Estimates,
prices not re-checked.)

## 5. Terraform

```
infra/
  bootstrap/            one-time: state bucket, GitHub OIDC provider, deploy roles (applied by hand)
  modules/
    auth/               Cognito user pool, app client, platform-admin group
    data/               DynamoDB table, GSI, TTL, PITR
    api/                HTTP API, JWT authorizer, api Lambda, routes, throttling
    push/               SQS + DLQ, push-worker Lambda, SSM parameter (value set by hand)
    jobs/               scheduler schedules, jobs Lambda
    web/                S3, CloudFront, OAC, optional domain
    observability/      log retention, alarms, SNS topic, budgets
  envs/
    dev/                main.tf wires modules; backend key dev/terraform.tfstate
    prod/               same, prod settings (PITR, deletion protection, retention)
```

- Terraform ≥ 1.11 (native S3 locking is GA there) with the S3 backend and native locking (`use_lockfile = true`); no DynamoDB lock table.
  Provider versions pinned exactly in `envs/*/versions.tf`.
- Lambda code is packaged from `server/` by a build script (`tools/build_lambda.py`) into a zip with
  pure-Python dependencies (`pyluach`) vendored; Terraform references the zip and its hash. No Lambda layers.
- All resource names carry `kehilot-<env>-`. Tags: `project=kehilot`, `env`.
- IAM: one role per Lambda, least privilege (the api role can read/write the table and send to the push
  queue; push-worker reads the table and the SSM parameter; etc.).

## 6. Deployment

- **AWS access without keys.** GitHub Actions assumes deploy roles through OIDC, restricted to this repo.
  The user and Noam use IAM Identity Center (SSO) users for console and CLI. **[call]**
- **Workflows** (GitHub Actions):
  - Pull request / push to `redesign` or `main`: Python tests (with `moto` for AWS mocks), JS tests,
    `terraform fmt -check`, `validate`, and `plan` for dev.
  - Merge to `main`: build the Lambda zip, `terraform apply` to **dev**, run a smoke test (`/health`,
    sign-in with a test user, cross-tenant check).
  - **prod**: manual `workflow_dispatch` with a confirmation input (free plan has no required reviewers).
    It refuses to run unless the same commit passed the dev smoke test.
  - CI pins Node 24 (Noam's `package.json` requires it) and Python 3.12.
- **Web deploy**: `npm run deploy:web -- --env dev|prod` = `expo export --platform web`, `aws s3 sync`,
  CloudFront invalidation of `index.html`. Runs locally or in CI; see [open] below.
- **Local development**: unit tests run offline with `moto`. Manual testing runs the app (phone or web)
  against the **dev** AWS environment; no DynamoDB Local (no Docker on the dev box). The existing demo
  mode (no `EXPO_PUBLIC_API_URL`) keeps working.
- **App configuration**: `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_COGNITO_POOL_ID`, `EXPO_PUBLIC_COGNITO_CLIENT_ID`,
  `EXPO_PUBLIC_REGION` per environment, written by `terraform output` into `.env.dev` / `.env.prod`.

## 7. What changes in the existing code (scope for the plan)

- `server/`: SQLite store replaced by a DynamoDB repository layer; session/password code removed
  (Cognito); routes re-scoped per Kehila; push outbox replaced by SQS; workers replaced by Scheduler/TTL.
  Domain modules (`hebrew_calendar.py`, roster/seating/validation rules) kept and adapted. The 81 existing
  server tests are the behaviour reference and are ported, plus new tenant-isolation tests.
- `src/api.ts`, `src/state.tsx`: Cognito sign-in, token refresh, Kehila selection, new paths, configurable
  polling. Screens follow the approved UX.
- New: `infra/`, `tools/build_lambda.py`, GitHub workflows, `server/API.md` v2.

## 7a. Account and future move (user's decision, 2026-10-26)

The first stage runs in the **user's existing AWS account**, with **both `dev` and `prod` in that account**,
and uses the **user's existing domain**. The user wants a later move to a dedicated account to be easy,
with all data. Therefore:
- No account ID, ARN or domain is hard-coded; they are Terraform variables. A new account = bootstrap +
  `terraform apply` with new variables.
- Every resource name is prefixed `kehilot-<env>-` and tagged, so nothing is confused with the account's
  other resources, and IAM policies are scoped to those prefixes.
- **DNS**: the app uses a delegated subdomain (e.g. `kehilot.<domain>` with its own Route 53 hosted zone,
  delegated by NS records from the parent zone). Moving accounts = recreate the subzone and change the NS
  records in the parent; the parent domain itself never moves.
- **DynamoDB**: PITR export to S3 and import into the new account's table (native Export/Import), plus a
  documented `tools/migrate_account.md` runbook. S3 web content is rebuilt, not copied.
- **Cognito cannot export password hashes.** Moving users to a new pool keeps their `sub` only if we plan
  for it. **[call]** Store our own stable `userId` (a ULID created at first sign-in) on a `U#<cognitoSub>`
  mapping item and use `userId`, not `sub`, as the key everywhere. A move then uses Cognito's
  *user-migration Lambda trigger* in the new pool (authenticates against the old pool on first login and
  copies the user silently), or a forced password reset as fallback. This replaces "User IDs are the
  Cognito `sub` everywhere" in §4.4.
- Expo push tokens, channels and Apple/Google credentials live outside AWS and are unaffected.

## 8. Left to the builder
Exact DynamoDB attribute names and any extra GSIs; Lambda memory/timeout sizes; alarm thresholds; module
inputs/outputs; the Cognito client library; the order of porting endpoints.

## 9. Open questions for the user
1. ~~Family details~~ — answered (user approved default, 2026-10-26): entered once per family and shared
   with every Kehila it joins, visible to a Kehila only after approval there. Seating, classification and
   aliyah history stay per Kehila.
2. ~~AWS account~~ — answered: existing account, dev and prod together, movable later (§7a).
3. ~~Region~~ — answered: Tel Aviv (`il-central-1`), enabled 2026-10-26.
4. ~~Domain~~ — answered: `meyodea.com`, Route 53 in the same account; app under `kehilot.meyodea.com`.
5. ~~Web builds in CI~~ — answered: the web bundle is built and deployed by GitHub Actions; Noam's
   no-cloud-build rule covers native iOS/Android builds only (confirm with Noam).
6. ~~Who administers AWS~~ — answered: the user only for now; an SSO user for Noam later.
