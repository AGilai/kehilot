# Families and privacy pack — design

Status: approved in conversation with the user (2026-10-27). Builds on
`docs/superpowers/specs/2026-10-26-aws-architecture-design.md` (the "main spec"); everything there still holds
unless this document says otherwise. Items marked **[call]** are my defaults that the user accepted wholesale
("go with your defaults"); everything else is the user's own decision.

## 1. Why

- Members want to reach people they are not close to. Close friends already have each other's numbers; the rarer
  case is two people who are not close. Today they ask around; in the app they will search a phone list.
- A household is the unit the community thinks in: blessings go to a family, the seat map (plan 2b) seats
  families, children belong to a family. Children must be entered once per family, not once per parent.
- Privacy law: Israel's Privacy Protection Law (Amendment 13, in force 2025) applies to everyone, GDPR to
  members living in the EU. Membership of a synagogue reveals religion, which makes all of this sensitive data
  under both. The app needs consent for the phone list, real deletion, a data download, a minimum age, clear roles
  (Kehila responsible, platform operator processes) and an honest privacy page.

## 2. Goals, non-goals, anti-goals

Goals
- Families: every member household is a family; two adults can be linked; children live on the family.
- Phone list: a dedicated, searchable screen of families, showing only the numbers each adult chose to show.
- Privacy pack: consent records, deletion with an optional "delete everything I posted", "download my data",
  minimum age 13, a "leave Kehila" button for listeners, Kehila terms and privacy contact, a rewritten privacy
  page, a breach procedure.

Non-goals (for now)
- Families shared across Kehilot. A family belongs to one Kehila; a couple in two Kehilot links twice. (User:
  "can be cool like the family is stored just associated to a different kehila – but that can be postponed".)
- Addresses, children in the phone list, any other directory field. Phone numbers only.
- Torah names, tribe, bar-mitzvah fields, yahrzeits: plan 2b ports Noam's roster model onto the family built here.
- Automatic deletion of inactive accounts **[call]**.
- Parental consent flows for under-13s. They may not use the app.

Anti-goals (would be a failure even if it works)
- Anyone linked to someone without their own tap (except by a gabbai, with notice and undo).
- A phone number shown that its owner did not switch on, or shown to a listener, or to another Kehila.
- A way to copy the whole phone list out in one action.
- Names, phone numbers or family details in push payloads or logs (main spec rules hold).
- A gabbai able to read private blessings because of a family change (private replies stay family + author).

## 3. Families

### 3.1 Rules (user)
- Every **member and gabbai** household in a Kehila is a family: a couple, a single person, a widow(er), a divorced
  person. Listeners have no family.
- A family is created automatically, with that person as its only adult, when someone becomes a member or gabbai
  (approval, member invite, import, listener upgrade). Existing members get one by migration.
- **Linking by request:** in Me, an adult picks "add my partner" and chooses from the approved members and
  gabbaim of the same Kehila who are not already linked. The other gets a push and a card and must confirm.
  - An unanswered request expires after **7 days**.
  - After a decline, the same requester cannot ask the same person again for **30 days**.
  - One partner per person; at most two adults per family; one outstanding request per requester.
  - The requester can withdraw; the decline is silent ("not confirmed").
- **Linking by a gabbai:** a gabbai can link two members directly, for couples who find the app hard. Both get a
  push and a card: "the gabbai linked you with X; not right? tap to undo". Undo is an ordinary unlink.
- **Unlinking:** either adult, any time, no agreement needed. Each becomes a family of their own and **both keep a
  copy of the children** **[call]**, each editing their own copy from then on.
- **Merging on link [call]:** the new family takes the children of both former families (concatenated); duplicates
  are the adults' to tidy up.
- **Leaving / deletion:** when one adult leaves the Kehila, is removed, demoted to listener or deletes the account,
  they drop out of the family and the other adult keeps it, children included. When the last adult goes, the
  family and its children are deleted. Pending link requests to or from that person are deleted.

### 3.2 What a family holds
- `adults`: one or two userIds. Each adult's own details stay on their own profile and membership (name, phone,
  phone switch). The family's display name is derived: the adults' last names (one if equal), else first names.
- `children`: list of `{id, firstName, gender ('m'|'f'), birthDate (YYYY-MM-DD, optional)}`, at most 20.
  **[call]** These are the minimum the seat map and aliyot will need; plan 2b may add fields. Either adult
  edits. Gabbaim may view a family's children (they run the community) but do not edit them **[call]**.

### 3.3 Blessings and private replies
- A blessing still names one target member; the **family of that member at read time** is the target family.
  `reply_visible` becomes: the reply's author, or any adult currently in the target member's family. Gabbaim
  still get no exception. The private-reply push goes to every adult in that family.
- The blessing target picker lists families (one row per family, family display name) and stores one of its
  adults as `targetMemberId` **[call]**, so the message format does not change.
- After an unlink, only the target member's new family sees the replies. An ex-partner loses access. That is
  accepted.

## 4. Phone list

- **Who sees it:** approved members and gabbaim of that Kehila. Never listeners, never another Kehila.
- **Phone number:** each person's own number on their profile (one per person, validated as an Israeli or
  international number, stored normalised). It is used only for the phone list.
- **Switch:** per person **and per Kehila**: "show my phone in <Kehila>'s phone list". Off by default. Turning it
  on or off writes a consent record (§6.1). Turning it off removes the number from the next response at once.
- **One-time card** on Home for members and gabbaim who have not decided yet: "want to be in the phone list?" with
  "yes, show" and "not now". It is shown once per person per Kehila; afterwards the choice lives only in Me.
- **Screen (UX choice A):** its own screen, entered from the Home and Me menus, with a search box. One entry per
  family: the family display name, then each adult who switched on, with name, number and buttons to call
  (`tel:`) and open WhatsApp (`https://wa.me/<digits>`). Families where nobody switched on do not appear.
- **No export:** no "copy all", "share list" or CSV. The list is fetched when the screen opens and kept in memory
  only, not written to the phone's storage **[call]**; search filters it on the phone. Leaving the screen drops it.
- The existing names-only directory (`GET /members`, used to pick a blessing target) is unchanged apart from §3.3.

## 5. Account deletion, leaving, imported people

- **Deletion screen:** a box "also delete everything I posted (messages, photos, chat)", **unticked by default**.
  - Unticked: as today, posts stay with the author name blanked.
  - Ticked: every message, chat message and private reply the person wrote is removed for everyone, with its
    image (the existing remove path: image first, then message, then the change-feed item).
  - Either way: the person leaves every family (§3.1), their phone, switches and pending link requests go, and
    blessings others wrote about them stay with the target name blanked. A gabbai can remove such a blessing on
    request (gabbaim can already remove any message).
- **Listeners** get the same "leave Kehila" button members have (the server route already allows it).
- **Imported people:** the import sends no email (Cognito `SUPPRESS`). On their first sign-in, each membership
  that came from an import shows a one-time card: "<Kehila> added you from its members list. Here is what is
  stored and why", with the privacy link **[call]**.
- **A gabbai removing an imported person who never signed in** also deletes their account (Cognito user and
  profile) when they have no other Kehila. "Never signed in" means the Cognito user is still in
  `FORCE_CHANGE_PASSWORD` and has no profile item.
- The privacy page states that backups (DynamoDB point-in-time recovery) keep deleted data for up to 35 days.

## 6. Consent, age, terms, contacts

### 6.1 Consent records
- Append-only records per user: kind, Kehila (when relevant), value (on/off/accepted), wording version, time.
  Kinds: `age13`, `phoneList` (per Kehila), `kehilaTerms` (per Kehila, by the accepting gabbai).
- Records are deleted with the account (they are the person's data) and included in the data download.
- When a wording version changes, people are asked again **[call]**: the app compares the stored version with the
  current one.

### 6.2 Minimum age 13 (user)
- Profile setup, which every new account goes through (email, Google, Apple), requires a ticked box "I am 13 or
  older". It is recorded as `age13`. Existing accounts are asked once, as a blocking card, at their next sign-in.
- The design notes for the user's lawyer that GDPR lets EU states set the age between 13 and 16.

### 6.3 Kehila terms and contacts (user)
- **Roles:** each Kehila is responsible for its members' data (the controller). The platform, named
  **"Kehilot"**, runs the service for the Kehilot (the processor).
- **Terms:** short Hebrew/English terms between the Kehila and Kehilot (what the platform does with the data,
  security, sub-processors, deletion at the end). A gabbai must accept them once per Kehila, as a blocking card on
  their next sign-in to that Kehila and when a new Kehila is set up. One gabbai's acceptance covers the Kehila.
  Text drafted by Claude; **a lawyer should review it** **[call]**.
- **Kehila privacy contact:** a free-text setting (≤ 100 code points) in the gabbai's Kehila settings, shown to
  every role in the Kehila's info and in Me. Requests about a Kehila's data go there.
- **Platform contact:** the user's email, shown on the privacy page as the contact for Kehilot. It is not in the
  repo (the repo is public): the deploy script substitutes it into the page from a git-ignored setting and refuses
  to deploy without it.

## 7. Download my data

- A button in Me. The server builds one ZIP file and returns a short-lived download link **[call]**:
  - `data.json`: profile, phone, memberships and roles, for each Kehila the family (the person's own details,
    the partner's name only, the children), consent records, every message, chat message and private reply
    the person wrote, notification settings.
  - `photos/`: the images of the person's own messages.
  - Nothing of other people beyond the partner's name and the children.
- The ZIP is written to the media bucket under `x/<userId>/` with a 1-day lifecycle rule; the link lives 10
  minutes. At most one export per person per day (HTTP 429 `export_limit`).

## 8. Privacy page and breach procedure

- `public/privacy/index.html` is rewritten (Hebrew first, English below) to cover: roles (each Kehila is
  responsible; Kehilot runs the platform); what is stored and why; families and the phone list; who sees what
  (listeners, members, gabbaim; private blessings only the family and the author); deletion and its options;
  the 35-day backups; download; minimum age 13; sub-processors (AWS in Israel, il-central-1; Expo push, which gets
  only generic texts; Google/Apple when used to sign in); each Kehila's contact in the app; the platform contact.
- `docs/BREACH-PROCEDURE.md`: who does what on a suspected breach. Contain, assess, record. Notify the Israeli
  Privacy Protection Authority for a severe incident, the EU authority within 72 hours where GDPR applies, and the
  affected Kehilot and people. Keep a log.

## 9. Constraints (from the main spec and machine rules, unchanged)

- Push payloads stay generic: `data` is only `{kehila, messageId}` or `{kehila, screen}`. New pushes (link
  request, gabbai link) use `screen: 'family'` and a generic body with no names.
- No PII in logs: IDs and counts only. Never log phone numbers, names, children or request bodies.
- Every route starts with `require()`; family, request and phone-list items are keyed under `K#<k>`.
- Real congregant names never in git; tests and fixtures use invented names.
- Apply via `plan -out`, review the plan, apply the saved plan. Stop if the pool, client, table or API would be
  replaced.

## 10. Builder-check answers (all [call] unless noted)

1. **Family vs the main spec's Person item.** `F#<familyId>` is the household model from now on. Membership
   gets `familyId`. Plan 2b's Person items (`P#`, Noam's roster identities incl. children) will reference
   `familyId`, and may move the simple children list here into Person items. Nothing in this plan creates `P#`.
2. **Blessings across two adults.** The target must still pass today's `reply_target_ok` (the stored target
   member can read the channel). Another adult of the family sees the blessing only if they can read its channel
   (message visibility comes first). If they can, they also see the replies and get the reply push. The
   "N members sent private blessings" chip is unchanged.
3. **Keeping the target right.** The picker stores `targetFamilyId` with `targetMemberId`. Reply visibility uses
   the current adults of `targetFamilyId`, falling back to the family of `targetMemberId` for older messages. On
   unlink, the adult who unlinks leaves and gets a new family. The familyId, and with it the family's
   blessings, stays with the other adult. On a gabbai link, whoever taps undo is the one who leaves.
4. **Phone number.** Optional, entered in Me (and asked for by the Home card's "yes, show" if missing). The
   per-Kehila switch is stored on the membership item `M#<user>` with its consent record in the user's consent
   items. Changing the number needs no new consent; the switch is the consent.
5. **Gabbai link details.** A gabbai cannot link someone who already has a partner (409). A gabbai link deletes
   any outstanding requests of the two people. Link then undo leaves duplicated children on the leaver's side;
   accepted. Gabbaim see families (adults and children) read-only in the members screen.
6. **"Delete everything I posted".** Removes the person's messages in every Kehila, blessings they wrote about
   others included, and their private replies. Removing a message also deletes all replies under it. Each
   removal writes the existing `message_removed` change item, so phones drop cached copies. Leaving a Kehila
   (any role, listeners included) never deletes posts and has no such box.
7. **Terms gate.** It blocks only the gabbai's management screens of that Kehila until a gabbai accepts.
   Everything else in the Kehila, including the phone list, keeps working. New Kehilot are created by the
   operator script `tools/kehila_admin.py`, and the first gabbai accepts on first sign-in. The terms live in the
   repo as a public page (`public/terms/index.html`, Hebrew then English) that the app links to, with a version
   constant. Claude drafts both languages.
8. **Scope of export and deletion.** Both cover every Kehila the person belongs to. The export limit is 1 per
   person per day. Terraform adds an `x/` lifecycle rule (1 day) to the media bucket and `x/*` rights to the API
   role. These are in-place changes, and nothing core may be replaced.
9. **Migration.** Only `dev` exists, so there is no production data. A one-off idempotent job creates
   families for existing members and gabbaim, and the app also creates one lazily if missing. The age-13 card
   affects only dev testers.

## 11. Left to the builder

- Item keys and API shapes, following the main spec's patterns (e.g. `K#<k>`/`F#<familyId>`,
  `K#<k>`/`PR#<toUser>` with TTL, a decline marker with a 30-day TTL, consents under `U#<user>`).
- How the migration creates families for existing members (one-off job or lazy on first read).
- Screen layout in the existing RTL style; the `screen: 'family'` push target.
- How the export is streamed into the ZIP within the Lambda's memory and time.
