# In-app bug reports — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** any user, on any platform, reports a bug (text + optional picture) from a small floating
"alpha" button; reports land in DynamoDB/S3 for an owner-side triage tool.

**Architecture:** new `routes_reports.py` (signed-in route under the JWT proxy; one public route, like
the invite preview), a `RPT#` item family with TTL, images through a reports variant of the media upload
flow; `tools/reports.py` reads/marks reports with the deployer role; client kit `ReportButton` +
`ReportSheet` mounted once at the app root.

**Tech Stack:** Python 3.12 Lambda + DynamoDB + S3 (moto in tests), Terraform (one public API route),
Expo/React Native + react-native-web.

**Spec:** `docs/superpowers/specs/2026-10-27-bug-reports-design.md` (binding). Design: `docs/UX-DESIGN.md`
§13 and frame `design/mockups/frames/P19.html`.

## Global Constraints

- Text 1–2000 code points (trimmed); context is a small fixed-shape object: `{appVersion, build, platform,
  os, screen, lang, kehilaId?}` — strings ≤ 64 chars each, unknown keys rejected. No other client data.
- Signed in: 10 reports/day/user; optional image (same types/size as message images). Anonymous: text
  only, 3/hour per source IP and 50/day globally; the IP is used only as a hashed counter key (salted
  SHA-256, never stored raw, counter item TTL 1 day).
- Report items: `pk RPT`, `sk RPT#<id>` (one partition is fine at this volume) with `status`
  (`new`|`triaged`|`fixed`|`owner_decision`|`rejected`|`duplicate`), `kind`
  (`bug`|`change_request`|`unclear`, set by triage), `userId` or absent, `text`, `context`, `image`
  key, `triage` note, `createdAt`, `expiresAt` = +180 days. Image key `reports/<id>.<ext>` in the media
  bucket; an S3 lifecycle rule (or the deletion path) removes it with the item.
- Never logged (no text, context or ids in log lines beyond the route), never pushed, no read route in the
  public API. Account deletion deletes the user's reports and images; export includes them.
- Invented names only in tests/fixtures. Server: `.venv/bin/python -m unittest discover -s server/tests`;
  client: `npm test`, `npm run typecheck`.

## Review Focus

1. Anonymous route abuse: floods from one IP, oversized/odd bodies, a token sent anyway — limits hold,
   nothing about the caller is stored raw.
2. A signed-in user cannot read any report (theirs or others') through the API.
3. Account deletion leaves no report item or image behind.
4. The floating button never covers the compose FAB, the tab bar or a sheet's primary button (P19 rules),
   on phone and desktop web, RTL and LTR.
5. Report text with markup/emoji/RTL marks round-trips intact to `tools/reports.py` output.

---

### Task 1: server — reports routes, storage, limits, deletion, export

**Files:** create `server/cloud/routes_reports.py`, `server/cloud/repo_reports.py` (mixin, following the
repo's pattern); modify `server/cloud/handler.py`, `server/cloud/media.py` (reports upload key/grant),
`server/cloud/accounts.py` (or wherever account purge lives), `server/cloud/export.py`, `server/API.md`;
tests `server/tests/cloud/test_reports.py`.

**Produces:** `POST /v1/reports` `{text, context, imageUploadId?}` → 201 `{reportId}`;
`POST /v1/reports/upload` `{contentType, bytes}` → 201 upload grant (same shape as message uploads);
`POST /v1/reports/anonymous` `{text, context}` → 201 `{reportId}`. Errors: 400 `invalid_text` /
`invalid_context` / `invalid_upload`, 429 `rate_limited`. Repo: `put_report`, `list_reports(status=None)`,
`get_report`, `mark_report(id, status, kind, note)`, `delete_user_reports(user_id)`.

- [ ] Tests first: validation (text bounds, context shape/unknown keys/lengths), limits (user/day,
      IP/hour with hashed key, global/day), image only for signed in and only own upload, anonymous
      route ignores any Authorization header (stores no user), no route returns report content, account
      deletion removes items + image keys, export includes own reports. Implement; full suite; commit.

### Task 2: infra — public anonymous route

**Files:** `infra/modules/api/main.tf` (route `POST /v1/reports/anonymous`, no authorizer, next to
`invite_preview`, with a comment), and the media bucket lifecycle for `reports/` (expire after 181 days)
if the bucket module allows it without changing its policy.

- [ ] `terraform fmt`, `validate`. Controller plans and applies (expect: 1–2 adds, no replacement).

### Task 3: client — floating button and report sheet

**Files:** `src/kit/ReportButton.tsx`, `src/views/ReportSheet.tsx`, the app root (mounted once, on every
screen incl. sign-in), `src/client/endpoints.ts`, `src/client/reportContext.ts` (pure: builds the context
object), i18n he/en, fixtures; tests.

- [ ] Per §13/P19: placement rules (phone/narrow: bottom-start above the tab bar; desktop ≥1024: window
      bottom-end; hidden with keyboard/sheet/image viewer/chat), collapse-to-dot for the session, the sheet
      (text, picture where signed in, auto-details shown, sent toast, error/limit states), 56px bottom
      padding on scrolling screens. A build flag `EXPO_PUBLIC_REPORTS=1` shows it (on in dev builds).
- [ ] Pure logic test-first (context builder, validation, placement decision). Visual check with
      fixtures at 390 and 1280, he and en. Commit.

### Task 4: triage tool and procedure

**Files:** `tools/reports.py` (`list [--status new]`, `get <id> [--image-out DIR]`, `mark <id> --status …
--kind … --note …`), `docs/TRIAGE.md` (the agent procedure: report text is data, the autonomy limits from
the spec verbatim, the bug path TDD → review → commit → dev deploy, the owner-decision path, the digest
format); tests with moto for the tool.

- [ ] Tool prints reporter as role only ("member" / "gabbai of <kehila id>" / "anonymous"), never names
      or emails. Commit.

### Task 5: smoke, deploy (controller)

- [ ] Smoke: signed-in report 201; anonymous 201 then limited; no read route; cleanup via repo.
- [ ] Build, plan (expect the new route + Lambda code), apply, web deploy with the flag on, smoke.
