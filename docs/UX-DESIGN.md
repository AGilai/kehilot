# Kehilot: UX design (draft 1, 2026-10-26)

Status: draft for approval. No app code changed. Mockups: `design/mockups/index.html` (22 frames, one page per
screen, each with design notes beside it). All names in the mockups are invented.

## 1. What this is

A Hebrew, right-to-left app for synagogue communities. Each Kehila is a tenant; one login can belong to several
Kehilot with a different role in each. Three surfaces:

- **A. Member, mobile** (primary). Android 360x800, also right on iPhone.
- **B. Gabbai, mobile.** Quick tasks: approve a newcomer, publish, toggle a broadcast permission, see seating totals.
- **C. Gabbai, desktop web (about 1440).** The full management console.

First Kehila: about 70 member families, 100 visitors, 3 gabbaim.

## 2. Design direction

**Idea: tekhelet on Jerusalem stone, set in book type.** The app should feel like the community's own printed
siddur and notice board, not like a SaaS dashboard.

| Choice | Decision | Why it fits |
|---|---|---|
| Colour | Stone paper `#F6F7F2`, night ink `#151A33`, **tekhelet** `#2A3F94` as the one action colour. Message types: tekhelet (announcement), pomegranate `#A32A47` (mazal tov), ash `#555B75` (condolence). Gold `#8F6512` only for Shabbat. Olive `#44652A` for approved/open. Management surfaces use a deep night band `#161C44`. | Tekhelet is the thread of the tallit and tzitzit. Stone is the wall of the building. Each emotional register gets its own hue, so a condolence is never mistaken for a party. |
| Signature | **The tallit-stripe edge**: a double line on the start edge of every message, in the type colour (`border-inline-start: 6px double`). Repeated on Shabbat and on the index tiles. | One recognisable mark, almost free to build. It also carries information: type, and a dotted version means "muted". |
| Home | **The day arc**: the day's zmanim drawn as a sun path. Runs right to left, like reading: sunrise on the right, nightfall on the left. Passed zmanim turn gold, "now" is a blue dot, next zman is outlined below. | Replaces a list of seven times with one glance: where in the day am I, what is next. |
| Type | **Noto Serif Hebrew** (titles, Hebrew date, greeting) and **Heebo** (UI, numerals, tabular). Scale: 28 / 21 / 19 / 16 body / 14 secondary / 12.5 minimum. | Serif Hebrew gives the look of a printed book; Heebo is sturdy and readable for older eyes. Both are Google Fonts. |
| Shape | Cards 14 to 16 px, sheets 26 px, chips pill. Hairlines before shadows. | Quiet; the stripe and the arc carry the personality. |
| Tone | Plain, warm, short. Sentence case, active verbs, one name per action ("פרסום" everywhere, toast says "פורסם"). Hebrew dates in letters (ט״ו בחשוון תשפ״ז); dates follow the rule below. | Members are mixed ages and tech comfort. |
| Accessibility | Touch targets 48 dp, 12.5 px minimum text, contrast checked against both palettes, status never by colour alone (icons and words), full dark mode following the device. | |
| Direction | Logical properties throughout. Back arrow points right, forward points left. Switches slide toward the end (left). Timelines and meters fill from the right. Phone numbers and times stay LTR inside RTL text. | |

Not copied from the current app: its palette, its category symbols and its plain list layout.

**Dates: Hebrew first, Gregorian in brackets (owner, 2026-10-28).** A Gregorian date is never shown alone. Day letters
and year are in gematria. Formats (`dualDate` and `dualRange` in `src/dates.ts`, used by every screen):

| Case | Hebrew UI | English UI |
|---|---|---|
| Single day | י״א בחשוון (23.10) | 11 Cheshvan (23.10) |
| With weekday (where one is shown today) | יום ו׳, י״א בחשוון (23.10) | Friday, 11 Cheshvan (23.10) |
| Range in one Hebrew month | י״א–י״ז בחשוון (23.10–29.10) | 11–17 Cheshvan (23.10–29.10) |
| Range across Hebrew months | כ״ח בתשרי–ד׳ בחשוון (17.10–23.10) | 28 Tishrei–4 Cheshvan (17.10–23.10) |
| With a year (only where a year is shown today) | י״א בחשוון תשפ״ז (23.10.2026) | 11 Cheshvan 5787 (23.10.2026) |

"היום", "אתמול" and "היום, 14:05" stay as they are; only an actual date is replaced. Clock times alone are unchanged.
The Hebrew calendar is computed with `@hebcal/hdate`, never with `Intl` `-u-ca-hebrew` (not dependable on Hermes). The
numbers inside the brackets of a Hebrew range are isolated left to right. A Hebrew date alone (no Gregorian) is allowed.

## 3. Roles and what each sees

| | Listener (guest) | Member | Gabbai / admin |
|---|---|---|---|
| Joined by | Invite link from a member | Gabbai approval | Appointed (platform admin creates the Kehila) |
| General channels | read | read | read, write |
| Other channels (simchot, management) | no | read, write if permitted | all |
| Directory, family, seating | no | directory yes; family and Mi Sheberach yes; seating only for א household heads | all |
| Broadcast | no | only if switched on | always; can remove any broadcast |

A gabbai also uses the member app in that Kehila; M6 offers "מצב ניהול" to switch to surfaces B and C.

## 4. Information architecture

**A. Member (bottom bar, 4 tabs).** Listener has 3: no Mi Sheberach tab.

```
 בית            הודעות             מי שברך          אני
 zmanim arc     My / Everything    my names         family details
 Shabbat        channels filter    add / remove     notification preferences
 seating card   message > private  (private)        seating (א heads)
 latest         reply              Kehila switcher  logout
 top bar on every screen: [Kehila chip v]  [bell]
```

The Kehila chip opens the switcher (M6). The broadcast button ("הודעה חדשה") floats on Messages, only for permitted members.

**B. Gabbai mobile (4 tabs):** סקירה, אישורים (badge), הודעות, חברים. Dark top bar = management mode.

**C. Gabbai desktop (right-hand sidebar):** סקירה, אישורים, ספר הקהילה, הודעות, ערוצים והגדרות, סגל ועליות, מקומות בשבת, מי שברך. Kehila switcher on top of the sidebar.

## 5. Screens

IDs match `design/mockups/frames/<id>.html`. "(no mockup)" screens are specified here only.

### A. Member, mobile

| ID | Screen | Purpose and contents | States |
|---|---|---|---|
| M1 | בית | Greeting, Hebrew date, day arc and zmanim grid, Shabbat card (parasha, candle lighting for two cities, countdown), seating card (א heads only), latest messages. | Offline: cached zmanim and a note. Friday: Shabbat card moves up. Loading: skeleton arc. |
| M2 | הודעות | Segmented "שלי / הכול", channel filter chips, messages grouped by day, pin, unread dot, broadcast button if permitted. | "הכול" shows muted items with dotted edge and "מושתק" tag. Empty: "הודעות חדשות מהגבאים יופיעו כאן." Filter remembered on device. |
| M3 | הודעה | Full message. Public action "מצטרף לברכות" (counted, no text). Private box "ברכה אישית למשפחה" with a permanent lock line. My sent reply shown above the box. | Condolence variant: "משתתף בצער", no count. Sent / failed. Author sees "מחק". |
| M4 | שידור חדש | Type cards, subject family (for mazal tov and condolence), channel, title, body, audience line ("יישלח ל־52 חברים"). | Draft saved. Blocked state does not exist: the entry point is hidden if not permitted. |
| M5 | העדפות התראות | Channels, message types, "התראה על שידורי חברים" (management only), mute specific members, locked private replies. Banner: mute only affects notifications. | Device push permission off: banner with a button to settings. |
| M6 | החלפת קהילה | Sheet with all Kehilot, role chip, unread, management-mode shortcut, join by invite link. | Single Kehila: chip shows no chevron. |
| M7 | אני | Name, standing (א, household head, tribe), personal, spouse, children, yahrzeits, settings. Each group opens an edit screen (no mockup for the edit forms: reuse today's fields, new styling). | Listener: only name and phone. |
| M8 | מי שברך | Add name (name and mother's name), my list with dates, delete with confirm. | Empty: "הוסיפו שם לרפואה." |
| M9 | מקומות בשבת | Allocated seats shown as chairs per prayer (Arvit, Shacharit). Tap a chair to release it. Deadline, save. | Special event: wording becomes "needed seats", chairs start empty. Closed: read-only. Not allocated: "פנו לגבאי". |
| M10 | בית, מתפלל אורח | Zmanim, "בקשת חברות" card (shows who invited), open channels, locked rows for what members get. | Request sent: card becomes "הבקשה נשלחה, ממתינה לגבאי". Approved: tabs appear at once. |
| M11 | הצטרפות בקישור | Landing from invite: Kehila, inviter, short registration, "כבר יש לי חשבון". | Expired link: "הקישור פג. בקשו מחבר קישור חדש." No form. |
| M12 | Mi Sheberach, profile edit, notification inbox (no mockup) | As today. | |

### B. Gabbai, mobile

| ID | Screen | Purpose and contents |
|---|---|---|
| GM1 | סקירה | Pending approvals with inline "אישור", seating meters for the coming Shabbat, four quick actions. |
| GM2 | אישור חברים | Open request card (inviter, details), three-way classification (א, קבוע, השאר אורח) with the consequence written under it, approve / reject. Undo for 6 seconds. |
| GM3 | פרסום הודעה | Type, recipients (all members or a channel), title, body, pin, notify, schedule. Recipient count at the bottom. |
| GM4 | חברים והרשאות | Search, filters, bulk "התר לכולם / חסום לכולם" (confirm with count), per-row broadcast switch, lock for gabbaim. |
| GM5 | מקומות לשבת | Needed / released / allocated per prayer as bars, households not reported with a reminder button, copy summary. |
| GM6 | Combined Mi Sheberach, member card, invite link creation (no mockup) | List with copy; invite link with expiry. |

### C. Gabbai, desktop

| ID | Screen | Purpose and contents |
|---|---|---|
| GD1 | ספר הקהילה | Table with checkbox, class, tribe, phone, joined, broadcast switch. Tabs: members, guests, invited. Dark bulk bar when rows are selected (allow, block, reclassify, message). "Allow all / block all" for the filtered results. Side card for the selected member. Export. |
| GD2 | אישורים | Queue on the right, detail on the left: inviter first, filled details, classification with written consequences, approve / keep as guest / reject, advance to next. Shows who is handling a request. |
| GD3 | ערוצים והגדרות | Channels: visible to (members / members and guests), who writes, default subscription, types. Tabs for broadcast defaults, Kehila settings (candle minutes, city, invite expiry), invite links. |
| GD4 | סגל ועליות | Roster with tribe, derived class (דור ב, חתן), last aliyah, 12-month meter. Per-person aliyah timeline, manual add with audit mark. |
| GD5 | מקומות בשבת | Event strip (parasha, mode, allocation, deadline), one chart per prayer, households table with "not reported" filter, bulk reminder, print, copy. |
| GD6 | הודעות | All messages with a "member broadcasts" filter, read rate, preview, remove with optional reason sent to the author, pin. |
| GD7 | מי שברך מאוחד (no mockup) | Combined list, names with member, date, print for the service. |
| GD8 | Platform admin: create Kehila (no mockup, low priority) | Name, city, first gabbai invite. |

## 6. Key flows

**1. Invite, listener, approval**
1. A member opens "אני" then "הזמנת מתפלל" and shares a link (expires after 7 days by default, records the inviter).
2. Newcomer opens it: M11 shows the Kehila and inviter. Registers, or logs in if they have an account (the Kehila is added to the same login).
3. They land in M10 as a listener: zmanim and general channels.
4. "בקשת חברות" sends a request with the inviter's name. A gabbai gets a push and a badge.
5. Gabbai approves in GM2 or GD2 and classifies (א or קבוע). The newcomer's tabs expand without re-login, with a short welcome message.
6. Reject: optional reason; the person stays a listener and can ask again later (open question).

**2. Posting a broadcast**
1. Messages, "הודעה חדשה" (visible only to permitted members and management).
2. Choose type, family concerned, channel, text (M4). The audience line shows the real count.
3. "פרסום". Toast "פורסם". It appears at the top of Messages with an author-only "מחק".
4. A gabbai can remove it from the app or from GD6; the author is told, with an optional reason.
5. Permission comes from the per-member switch (GM4, GD1), with "allow all / block all" bulk buttons. Management always can.

**3. Private reply to a mazal tov**
1. Open the message (M3). Two separate actions: "מצטרף לברכות" (public count only) and the private box.
2. The lock line "יגיע למשפחת בדיוני בלבד" stays visible while typing.
3. Send. The reply shows above the box as "נשלחה למשפחה בלבד". Nobody else can see it, not even other members; gabbaim do not see it either unless they are the family.
4. The family gets a dedicated notification ("ברכה חדשה") and sees replies under their own message.
5. Everyone who can see the message sees a chip "12 חברים שלחו ברכה פרטית למשפחת בדיוני" (count of distinct repliers only, no names or text), to encourage others to bless.

**4. Setting notification preferences**
1. אני, "העדפות התראות" (or the sliders icon on Messages).
2. Three independent layers: channels, message types, member broadcasts ("הנהלה בלבד" or all permitted, plus muting individual members).
3. Every switch states what happens when off. A fixed banner says muting only affects notifications.
4. Changes save immediately with a short confirmation (no Save button).

**5. The "My / Everything" filter**
*Superseded by §12.8 (2026-10-28): no Segmented; "הכול" is the switch "להציג גם הודעות מושתקות" in the type list. The rules below still describe what the switch does.*
1. Messages has one segmented control: "שלי" and "הכול". It is remembered on the device, per Kehila.
2. "שלי": only channels and types I am subscribed to, from members I have not muted.
3. "הכול": adds what I muted, with a dotted edge, lighter title and a "מושתק" tag. Same layout, so scrolling back through a week feels natural.
4. The unread count belongs to "שלי". Unread muted items are never counted or badged.

## 7. Decisions and assumptions to confirm

- ~~Hebrew-only UI~~ — changed by the user (2026-10-26): Hebrew and English, chosen in Settings (default from the device); layout flips RTL/LTR with the language. Mockups stay Hebrew; English layouts are mirrored. Dark mode follows the device.
- Mazal tov and condolence use one shared message layout; extra types (event, lesson) get their own hue later.
- ~~Private replies~~ — confirmed by the user (2026-10-26): visible only to the family and the author; gabbaim have no access.
- Channels carry a "visible to guests" flag; listeners see only flagged channels.
- Gabbai mode is a switch inside the same app, not a separate app.

## 8. Open questions for the user

1. **Shabbat quiet mode:** hold notifications from candle lighting to nightfall and deliver them after? (Shown as a suggestion in M5.)
2. **Mi Sheberach expiry:** remind members after 30 days to renew or remove a name?
3. Should gabbaim see private replies to a mazal tov or condolence, or only the family?
4. Rejected newcomers: may they re-request, and after how long?
5. Invite link: expiry (7 days?), single use or many, who may create one (every member?).
6. Can a member leave one Kehila, and what happens to their family data there?
7. Should "קבוע" members be allowed to broadcast, or only א?
8. One shared guest channel set per Kehila, or per-channel choice (the mockup assumes per channel)?
9. Reply counts on mazal tov: show "23 בירכו" publicly, or hide to avoid comparison?
10. Is Android first for rollout, with iPhone later, or both on day one?

## 9. Verification status

Checked by headless screenshots at phone and desktop widths: M1, M2, M3, M5, M6, M9, GM1, GD1, GD5, M4 in dark mode, and the index at 390 px (no horizontal scroll). Not individually screenshot-checked: M7, M8, M10, M11, GM2 to GM5, GD2 to GD4, GD6. Real Hebrew copy should be reviewed by a native editor.


## 10. Families & privacy (P*)

Added 2026-10-27 for `docs/superpowers/specs/2026-10-27-families-privacy-design.md`. Mockups: `design/mockups/frames/P1.html`
to `P14.html` (index section "ד. משפחות ופרטיות"). Unlike the M/GM/GD drafts, **the P frames draw the shipped kit**
(`src/kit/theme.ts` tokens, `src/kit/components.tsx`): TopBar with logo tile and bell icon, bottom tabs with line icons (§11.3–11.4), Card,
Button (primary / secondary / danger), Field, Chip, Toggle (the "פעיל/כבוי" pill), Banner, Sheet, Toast and `Tag`
from `admin/shared.tsx`. Build them 1:1; QA compares against them. Each frame has one or two phones plus labelled
state panels. All names and numbers are invented.

Dark mode: the frames use only `--k-*` variables in `shared.css`, which are the light and dark values of `theme.ts`
exactly. Developers use `useTokens()`; no hard-coded colours (the Toast's `#FFFFFF` text and the band are as today).

### 10.1 Screens

| ID | Screen | Content | States | Kit |
|---|---|---|---|---|
| P1 | רשימת הטלפונים | Back, title, intro, search (same TextInput style as Members search), count, one Card per family: family display name (serif heading), then each adult who switched on: name, number (LTR, tabular) and a row of two secondary Buttons "☎ חיוג" (`tel:`) and "וואטסאפ" (`https://wa.me/<digits>`). Privacy note and "my settings" link at the end. Entry: a pressable Card on Home under the Shabbat card (members and gabbaim only) and the "פתיחת רשימת הטלפונים" button in Me. | Loading (spinner), error (Banner + retry), empty (nobody on; "show my phone" if I am off), no results, filtered. Listener: no entry point at all. | Txt, Card, Button, Banner |
| P2 | אני · המשפחה שלי | Card "המשפחה שלי": adults (Tag "אני" on me), the action for the state, then children. Partner picker in a Sheet (search + PickList, footer "שליחת בקשה"). | none / request sent (Tag "ממתין לאישור", expiry date, withdraw) / request received (Banner + confirm / don't confirm) / not confirmed or expired (Banner, at the requester) / linked (unlink → inline confirm, danger + keep) / picker errors (30-day cooldown, already linked, no match). | Card, Tag, Banner, Button, Sheet, **PickList** |
| P3 | ילד/ה: הוספה ועריכה | Sheet form: first name (Field, 60 code points), son/daughter (two Chips, required), date of birth (Field, optional, `d.m.yyyy` typed, stored `YYYY-MM-DD`). Edit adds "הסרה מהרשימה" with inline confirm. | add / edit / remove confirm / invalid or future date / gender missing / 20-child limit / empty list. | Sheet, Field, Chip, Button, Banner |
| P4 | אני · טלפון ורשימה | Card "רשימת הטלפונים" right after Profile: my number (one for all Kehilot), change / remove, Toggle "show my phone in <Kehila>'s list" (current Kehila only), who sees it, "open the phone list". | no number (no Toggle, only "add"), editing (invalid number error, Save disabled when empty), switch off (offNote), toast on change. Listener: card hidden. | Card, Field, Toggle, Button, Toast |
| P5 | אני · פרטיות ונתונים | Card near the end of Me, every role: Kehila privacy contact (as typed) or "not set", "על הקהילה" (P13), privacy policy (browser), "download my data". | export idle / preparing (busy Button + line) / ready (success Banner, primary "download", 10-minute note) / limit reached (info Banner, Button disabled) / error (retry). | Card, Button, Banner |
| P6 | יציאה מהקהילה | Listeners now get the same "leave" Card and inline confirm as members. Members in a family see one more line about the family. | listener confirm, member-with-partner confirm. No "delete my posts" box: leaving never deletes posts. | Card, Button |
| P7 | בית · כרטיסים חד־פעמיים | One card at a time under the greeting, above zmanim, in this order: gabbai linked you, partner request, imported notice, terms waiting (gabbai), phone-list invitation. Card with `edgeColor`: tekhelet = action, ash = imported (information), gold = terms. | phone invite with / without a number (Field inside, "save and show" disabled until valid); request confirm / don't confirm; gabbai link → "that's right" / unlink → inline confirm; imported → "got it"; terms → opens P8. | Card(edgeColor), Field, Button |
| P8 | מסכים חוסמים | Age 13 for existing accounts: replaces the whole signed-in app (no TopBar, no tabs), AuthFrame layout, Check + Continue; "I am under 13" swaps in a Banner with delete account / sign out. Terms (gabbai): replaces every management tab of that Kehila until one gabbai accepts; one button "אישור התנאים בשם הקהילה", link to `/terms`. | unticked (Continue disabled), under 13, terms new version ("התנאים עודכנו"). | AuthFrame, **Check**, Card, Button, Banner |
| P9 | הגדרת פרופיל | Today's ProfileSetup plus a Check "I am 13 or older" (unticked) with a note, and a privacy-policy link. Continue needs a first name and the tick; the save also records `age13` with the wording version. | unticked / ticked. | **Check**, Field, Chip, Button |
| P10 | מחיקת החשבון | "What is deleted" gains i4 (new text) and i5. New Card: Check "also delete everything I posted" (unticked), the explanation for the current choice, the "either way" line and the 35-day backups line. Link "want a copy first?" to P5. Then today's type-the-word Card. `deleteAccount.kept` is no longer shown (its meaning is now `postsOff`). | unticked (explanation muted) / ticked (explanation in ink colour). | **Check**, Card, Field, Button |
| P11 | גבאי · חברים ומשפחות | Each member card (and a "family" column on wide) gets one line: "family with X · children: n" or "no partner". "פעולות" shows a read-only family block (adults, children with birth year, read-only note). "קישור לבן/בת זוג" (only if no partner) opens a Sheet: first person fixed, PickList of members and gabbaim without a partner, what will happen, button with both names. ~~No phone numbers on this screen.~~ **Changed by §18 (owner 2026-10-28):** each adult in the family block shows the phone (LTR), "ברשימה: לכולם / לגבאים בלבד", and "חיוג" / "וואטסאפ"; gabbaim always see members' phones. The privacy page (P5 / policy) and P13 must say so. | 409 already linked (Banner in Sheet), success (Sheet closes, toast). | Card, Tag, Toggle, Button, Sheet, **PickList** |
| P12 | גבאי · איש קשר לפרטיות | In Overview (there is no mobile settings screen), same view/edit pattern as the listener cap card: Field with `maxCodePoints=100`. A second Card shows who accepted the terms and when. On desktop the same card goes in the Kehila settings tab (GD3). | set / not set / editing / over 100 (counter red, Save disabled). | Card, Field, Button |
| P13 | על הקהילה | Sheet titled with the Kehila name: my role (Tag), privacy contact, the roles sentence, privacy policy, Kehila terms. Opened from P5 and from the current-Kehila row of the switcher. | listener without contact. | Sheet, Tag |
| P14 | בחירת משפחה לברכה | Compose's picker lists families: display name, adults' first names under it; stores `targetFamilyId` and an adult who can read the chosen channel as `targetMemberId`. A family with no adult who can read the channel is not listed. New note line under the picker. | no results. | PickList |

Order of Me (member or gabbai): title, management mode, Profile, Phone list (P4), My family (P2), Language, Groups,
Invite, My links, Notification preferences, Privacy and data (P5), Leave (P6), Sign out, Delete. Listener: Profile,
Language, Groups, Notification preferences, Privacy and data, Leave, Sign out, Delete.

Family display name (P1, P14): one last name if both adults share it, both joined with " · " if they differ
("ניסיון · דמיון"), first names if there are no last names. Sorted with `Intl.Collator('he')`. Children are never
shown in P1 or P14 and never in a push.

Pushes (generic text, `data` = `{kehila, screen: 'family'}`): partner request → "בקשת קישור משפחה חדשה"; gabbai link →
"הגבאי עדכן את פרטי המשפחה שלכם". The tap opens Home, where the P7 card is waiting.

### 10.2 New components

- **`Check`** (`src/kit/components.tsx`): `{ label: string; value: boolean; onChange: (v: boolean) => void; note?: string; disabled?: boolean }`.
  A Pressable row, `minHeight: TOUCH`, `accessibilityRole="checkbox"`, `accessibilityState={{ checked, disabled }}`,
  `accessibilityLabel=label`. Box 24×24, radius 6, border 2 `muted`, background `surface`; checked: background and border
  `tekhelet`, a "✓" in `onAction` (uiBold, 15). Label `Txt` body, flex 1, top-aligned with the box (paddingTop 12).
  `note` is a `Txt size="small" color=muted` under the row. Disabled: opacity .6. Used by P8, P9, P10.
- **`PickList`** (extract Compose's family picker into `src/kit/`): `{ query: string; onQuery: (q: string) => void; placeholder: string; rows: { id: string; title: string; subtitle?: string }[]; selected: string | null; onSelect: (id: string) => void; empty: string; state: 'loading' | 'error' | 'ready'; errorText?: string; max?: number }`.
  Same TextInput style as today; rows `minHeight: TOUCH`, radius 10, border 1 `line` (selected: border 2 `tekhelet`, bold,
  "✓ " prefix), optional subtitle `Txt small muted`; gap 6; `max` default 8. Used by P2, P11, P14.
- **`Tag`** moves from `src/views/admin/shared.tsx` to `src/kit/components.tsx` (member screens now use it), unchanged.

No other new components: contact buttons are two secondary Buttons in a row; one-time cards are `Card` with
`edgeColor`; inline confirms follow the existing leave/revoke pattern (text, danger Button, secondary Button).

### 10.3 Copy

New keys, Hebrew and English, to paste into `src/i18n/he.json` / `en.json` (dots are nesting). Keys that already
exist and are reused unchanged are not listed. `deleteAccount.deleted.i4` replaces today's text.

| Key | Hebrew | English |
|---|---|---|
| `phoneList.title` | רשימת הטלפונים | Phone list |
| `phoneList.intro` | חברים וגבאים של {kehila} שבחרו להציג את המספר שלהם. | Members and gabbaim of {kehila} who chose to show their number. |
| `phoneList.search` | חיפוש לפי שם | Search by name |
| `phoneList.count` | {n} משפחות | {n} families |
| `phoneList.call` | חיוג | Call |
| `phoneList.whatsapp` | וואטסאפ | WhatsApp |
| `phoneList.callA11y` | חיוג אל {name} | Call {name} |
| `phoneList.whatsappA11y` | וואטסאפ אל {name} | WhatsApp {name} |
| `phoneList.empty` | עדיין אף אחד לא בחר להופיע ברשימה. | Nobody has chosen to appear in the list yet. |
| `phoneList.emptyJoin` | אפשר להיות הראשונים להופיע: | You can be the first to appear: |
| `phoneList.showMine` | הצגת הטלפון שלי | Show my phone |
| `phoneList.noResults` | לא נמצאה משפחה בשם "{q}". | No family named "{q}". |
| `phoneList.noResultsHint` | אפשר לחפש לפי שם פרטי או שם משפחה. ברשימה מופיע רק מי שבחר להופיע. | Search by first or last name. Only people who chose to appear are listed. |
| `phoneList.loadError` | לא הצלחנו לטעון את הרשימה. בדקו את החיבור ונסו שוב. | We couldn't load the list. Check your connection and try again. |
| `phoneList.privacyNote` | הרשימה לא נשמרת בטלפון, ואי אפשר להעתיק או לשתף אותה. | The list is not saved on your phone and cannot be copied or shared. |
| `phoneList.mySetting` | להופיע או להסתיר את המספר שלכם: בהגדרות שלי | To show or hide your number: my settings |
| `home.phoneList` | רשימת הטלפונים | Phone list |
| `home.phoneListSub` | מספרים של משפחות בקהילה | Numbers of families in the Kehila |
| `me.phone.title` | רשימת הטלפונים | Phone list |
| `me.phone.label` | מספר הטלפון שלי | My phone number |
| `me.phone.none` | לא הוזן מספר. | No number entered. |
| `me.phone.add` | הוספת מספר | Add a number |
| `me.phone.edit` | שינוי המספר | Change number |
| `me.phone.remove` | הסרת המספר | Remove number |
| `me.phone.placeholder` | 050-0000000 | 050-0000000 |
| `me.phone.hint` | המספר משמש רק לרשימת הטלפונים. | The number is used only for the phone list. |
| `me.phone.invalid` | המספר לא נראה תקין. כתבו מספר ישראלי, למשל 050-0000000, או מספר בינלאומי שמתחיל ב־+. | That number doesn't look right. Use an Israeli number, e.g. 050-0000000, or an international one starting with +. |
| `me.phone.saved` | המספר נשמר | Number saved |
| `me.phone.removed` | המספר הוסר ולא מוצג באף רשימה | Number removed. It no longer shows in any list |
| `me.phone.switch` | הצגת הטלפון שלי ברשימה של {kehila} | Show my phone in {kehila}'s list |
| `me.phone.switchOff` | כבוי: המספר שלכם לא מוצג לאף אחד ב{kehila}. | Off: your number is not shown to anyone in {kehila}. |
| `me.phone.who` | את הרשימה רואים רק חברים וגבאים של {kehila}. מתפללים אורחים וקהילות אחרות לא רואים אותה. | Only members and gabbaim of {kehila} see the list. Listeners and other Kehilot don't. |
| `me.phone.needNumber` | כדי להופיע ברשימה, הוסיפו קודם מספר טלפון. | To appear in the list, add a phone number first. |
| `me.phone.open` | פתיחת רשימת הטלפונים | Open the phone list |
| `me.phone.shown` | המספר שלכם מוצג ברשימה | Your number is in the list |
| `me.phone.hidden` | המספר שלכם הוסתר מהרשימה | Your number is hidden from the list |
| `family.title` | המשפחה שלי | My family |
| `family.intro` | המשפחה שלכם ב{kehila}. ברכות פרטיות למשפחה מגיעות לשני בני הזוג. | Your household in {kehila}. Private blessings to the family reach both adults. |
| `family.me` | אני | Me |
| `family.alone` | כרגע רק אתם במשפחה. | For now it's just you. |
| `family.addPartner` | הוספת בן/בת הזוג | Add my partner |
| `family.addHint` | בן/בת הזוג צריכים להיות חברים ב{kehila} ולאשר את הבקשה. | Your partner must be a member of {kehila} and confirm the request. |
| `family.sent` | ממתין לאישור | Waiting |
| `family.sentBody` | שלחתם בקשה ל{name}. אם לא תאושר, היא תפוג ב־{date}. | You sent a request to {name}. If it isn't confirmed, it expires on {date}. |
| `family.withdraw` | ביטול הבקשה | Withdraw request |
| `family.withdrawn` | הבקשה בוטלה | Request withdrawn |
| `family.received` | {name} ביקש/ה לקשר אתכם כמשפחה אחת. | {name} asked to link you as one family. |
| `family.confirm` | אישור | Confirm |
| `family.decline` | לא לאשר | Don't confirm |
| `family.declineNote` | אם לא תאשרו, {name} יראה/תראה רק שהבקשה לא אושרה. | If you don't confirm, {name} only sees that the request was not confirmed. |
| `family.linked` | אתם מקושרים כמשפחה | You are linked as a family |
| `family.notConfirmed` | הבקשה ל{name} לא אושרה. | Your request to {name} was not confirmed. |
| `family.expired` | הבקשה ל{name} פגה אחרי 7 ימים. | Your request to {name} expired after 7 days. |
| `family.unlink` | ביטול הקישור | Unlink |
| `family.unlinkConfirm` | לבטל את הקישור עם {name}? תהיה לכם משפחה נפרדת עם עותק של רשימת הילדים. הברכות שהמשפחה קיבלה יישארו אצל {name}. | Unlink from {name}? You'll get a separate family with a copy of the children list. Blessings the family received stay with {name}. |
| `family.unlinkYes` | כן, לבטל את הקישור | Yes, unlink |
| `family.keep` | השארה | Keep |
| `family.unlinked` | הקישור בוטל | Unlinked |
| `family.pick.title` | הוספת בן/בת הזוג | Add my partner |
| `family.pick.search` | חיפוש לפי שם | Search by name |
| `family.pick.body` | הבקשה תגיע אליו/ה, והקישור ייווצר רק אחרי אישור. | They get a request; the link is made only once they confirm. |
| `family.pick.hint` | מוצגים חברים וגבאים של {kehila} שעדיין לא מקושרים. | Showing members and gabbaim of {kehila} who aren't linked yet. |
| `family.pick.none` | לא נמצא חבר בשם הזה שאפשר לקשר. | No member by that name who can be linked. |
| `family.pick.send` | שליחת בקשה | Send request |
| `family.pick.sent` | הבקשה נשלחה | Request sent |
| `family.pick.cooldown` | אפשר לבקש שוב מ{name} החל מ־{date}. | You can ask {name} again from {date}. |
| `family.pick.taken` | {name} כבר מקושר/ת לבן/בת זוג. | {name} already has a partner. |
| `children.title` | ילדים · {n} | Children · {n} |
| `children.empty` | לא נוספו ילדים. | No children added. |
| `children.add` | הוספת ילד/ה | Add a child |
| `children.shared` | רשימה אחת לכל המשפחה: כל אחד מבני הזוג יכול לעדכן. הגבאים רואים אותה ולא עורכים. ילדים לא מופיעים ברשימת הטלפונים. | One list for the whole family: either adult can edit it. Gabbaim can see it but not edit it. Children never appear in the phone list. |
| `children.son` | בן | Son |
| `children.daughter` | בת | Daughter |
| `children.edit` | עריכה | Edit |
| `children.max` | אפשר לרשום עד 20 ילדים במשפחה. | A family can list up to 20 children. |
| `children.form.addTitle` | הוספת ילד/ה | Add a child |
| `children.form.editTitle` | עריכת הפרטים של {name} | Edit {name} |
| `children.form.firstName` | שם פרטי | First name |
| `children.form.gender` | בן או בת | Son or daughter |
| `children.form.birth` | תאריך לידה (לא חובה) | Date of birth (optional) |
| `children.form.birthHint` | יום.חודש.שנה, למשל 31.12.2015 | Day.month.year, e.g. 31.12.2015 |
| `children.form.birthInvalid` | התאריך לא תקין. כתבו יום.חודש.שנה. | That date isn't valid. Use day.month.year. |
| `children.form.birthFuture` | תאריך הלידה לא יכול להיות בעתיד. | The date of birth can't be in the future. |
| `children.form.pickGender` | בחרו בן או בת | Choose son or daughter |
| `children.form.save` | שמירה | Save |
| `children.form.saved` | הפרטים נשמרו | Saved |
| `children.form.remove` | הסרה מהרשימה | Remove from the list |
| `children.form.removeConfirm` | להסיר את {name} מרשימת הילדים? הפרטים יימחקו גם אצל בן/בת הזוג. | Remove {name} from the children list? It is removed for your partner too. |
| `children.form.removeYes` | כן, להסיר | Yes, remove |
| `children.form.removed` | הוסר/ה מהרשימה | Removed from the list |
| `privacy.title` | פרטיות ונתונים | Privacy and data |
| `privacy.contact` | פניות על המידע שלכם ב{kehila}: | Questions about your data in {kehila}: |
| `privacy.contactNone` | הקהילה עוד לא הגדירה איש קשר לפרטיות. אפשר לפנות לגבאים. | The Kehila hasn't set a privacy contact yet. You can ask the gabbaim. |
| `privacy.policy` | מדיניות הפרטיות | Privacy policy |
| `privacy.about` | על הקהילה | About this Kehila |
| `export.title` | הורדת הנתונים שלי | Download my data |
| `export.body` | קובץ ZIP עם הפרופיל, המשפחה, ההסכמות שנתתם וכל מה שכתבתם, בכל הקהילות שלכם. | A ZIP file with your profile, family, the consents you gave and everything you wrote, across all your Kehilot. |
| `export.start` | הכנת הקובץ | Prepare the file |
| `export.preparing` | מכינים את הקובץ. זה יכול לקחת עד דקה. | Preparing your file. This can take up to a minute. |
| `export.ready` | הקובץ מוכן. | Your file is ready. |
| `export.download` | הורדת הקובץ | Download the file |
| `export.readyNote` | הקישור פעיל 10 דקות. הקובץ נמחק מהשרת אחרי יום. | The link works for 10 minutes. The file is deleted from the server after a day. |
| `export.limit` | כבר הכנתם קובץ היום. אפשר להכין קובץ חדש מחר. | You already prepared a file today. You can prepare a new one tomorrow. |
| `export.failed` | לא הצלחנו להכין את הקובץ. נסו שוב. | We couldn't prepare the file. Try again. |
| `me.leave.action` | יציאה מהקהילה | Leave the Kehila |
| `me.leave.confirmListener` | לצאת מהקהילה: {kehila}? תפסיקו לקבל ממנה הודעות. אפשר לחזור בקישור הזמנה חדש. | Leave the Kehila: {kehila}? You will stop getting its messages. You can come back with a new invite link. |
| `me.leave.family` | תצאו גם מהמשפחה שלכם בקהילה. {name} יישאר/תישאר בה עם רשימת הילדים. | You'll also leave your family here. {name} keeps it, with the children list. |
| `me.leave.posts` | ההודעות שכתבתם בקהילה יישארו. | Messages you wrote here stay. |
| `me.leave.yes` | כן, יציאה | Yes, leave |
| `cards.phone.title` | להופיע ברשימת הטלפונים? | Appear in the phone list? |
| `cards.phone.body` | חברי {kehila} יוכלו למצוא את המספר שלכם ולהתקשר. רק חברים וגבאים רואים את הרשימה. אפשר לשנות בכל עת ב"אני". | Members of {kehila} could find your number and call you. Only members and gabbaim see the list. You can change this any time in Me. |
| `cards.phone.yes` | כן, להציג | Yes, show it |
| `cards.phone.saveShow` | שמירה והצגה | Save and show |
| `cards.phone.notNow` | לא עכשיו | Not now |
| `cards.request.title` | בקשת קישור משפחה | Family link request |
| `cards.request.body` | {name} ביקש/ה לקשר אתכם כמשפחה אחת ב{kehila}. אחרי האישור תהיה לכם רשימת ילדים משותפת, וברכות למשפחה יגיעו לשניכם. | {name} asked to link you as one family in {kehila}. Once you confirm you'll share one children list, and blessings to the family reach you both. |
| `cards.gabbai.title` | הגבאי קישר אתכם כמשפחה | The gabbai linked you as a family |
| `cards.gabbai.body` | {gabbai} קישר/ה אתכם עם {name} כמשפחה אחת ב{kehila}. לא נכון? אפשר לבטל. | {gabbai} linked you with {name} as one family in {kehila}. Not right? You can undo it. |
| `cards.gabbai.ok` | זה נכון | That's right |
| `cards.imported.title` | הקהילה {kehila} הוסיפה אתכם מרשימת החברים שלה | {kehila} added you from its members list |
| `cards.imported.body` | מה נשמר: השם, כתובת הדוא״ל, התפקיד והקבוצות שלכם בקהילה. למה: כדי שתקבלו את הודעות הקהילה ותוכלו להשתתף. הקהילה אחראית למידע הזה, ופלטפורמת קהילות מפעילה את השירות עבורה. | What is stored: your name, email address, role and groups in the Kehila. Why: so you get the Kehila's messages and can take part. The Kehila is responsible for this data; the Kehilot platform runs the service for it. |
| `cards.imported.ok` | הבנתי | Got it |
| `cards.imported.leave` | לא רוצים להיות כאן? אפשר לצאת מהקהילה ב"אני". | Don't want to be here? You can leave the Kehila in Me. |
| `cards.terms.title` | התנאים לקהילה ממתינים לאישור | The Kehila terms are waiting |
| `cards.terms.body` | מסכי הניהול של {kehila} ייפתחו אחרי שגבאי אחד יאשר את התנאים. כל השאר עובד כרגיל. | {kehila}'s management screens open once one gabbai accepts the terms. Everything else works as usual. |
| `cards.terms.open` | לקריאה ולאישור | Read and accept |
| `age13.title` | רגע לפני שממשיכים | One moment before you continue |
| `age13.body` | קהילות מיועדת לבני 13 ומעלה. אשרו את גילכם כדי להמשיך. | Kehilot is for people aged 13 and over. Confirm your age to continue. |
| `age13.check` | אני בן/בת 13 ומעלה | I am 13 or older |
| `age13.continue` | המשך | Continue |
| `age13.under` | אני מתחת לגיל 13 | I am under 13 |
| `age13.underBody` | מצטערים, האפליקציה מיועדת לבני 13 ומעלה. אפשר למחוק את החשבון עכשיו, או לצאת ולחזור כשתגיעו לגיל 13. | Sorry, the app is for people aged 13 and over. You can delete your account now, or sign out and come back when you're 13. |
| `terms.title` | התנאים בין הקהילה לבין קהילות | Terms between the Kehila and Kehilot |
| `terms.updatedTitle` | התנאים עודכנו | The terms have changed |
| `terms.intro` | לפני ניהול {kehila}, גבאי אחד צריך לאשר את התנאים. האישור שלכם יחול על כל הקהילה. | Before managing {kehila}, one gabbai accepts these terms. Your acceptance covers the whole Kehila. |
| `terms.p1` | הקהילה אחראית למידע של חבריה. קהילות מפעילה את השירות עבורה ומשתמשת במידע רק לשם כך. | The Kehila is responsible for its members' data. Kehilot runs the service for it and uses the data only for that. |
| `terms.p2` | המידע נשמר מוצפן בשרתי AWS בישראל, וכל אחד רואה רק מה שהתפקיד שלו מאפשר. | Data is stored encrypted on AWS servers in Israel, and everyone sees only what their role allows. |
| `terms.p3` | ספקי משנה: AWS (שרתים ואחסון), Expo (התראות, טקסט כללי בלבד), Google ו־Apple (כניסה, למי שבוחר בהן). | Sub-processors: AWS (servers and storage), Expo (notifications, generic text only), Google and Apple (sign-in, for those who use them). |
| `terms.p4` | כשהקהילה מפסיקה להשתמש בשירות, המידע שלה נמחק. | When the Kehila stops using the service, its data is deleted. |
| `terms.read` | קריאת התנאים המלאים | Read the full terms |
| `terms.accept` | אישור התנאים בשם הקהילה | Accept the terms for the Kehila |
| `terms.accepted` | התנאים אושרו. מסכי הניהול פתוחים | Terms accepted. Management is open |
| `terms.others` | כל השאר באפליקציה, כולל רשימת הטלפונים, ממשיך לעבוד גם בלי האישור. | Everything else in the app, including the phone list, keeps working without it. |
| `profileSetup.age13` | אני בן/בת 13 ומעלה | I am 13 or older |
| `profileSetup.age13Note` | האפליקציה מיועדת לבני 13 ומעלה. | The app is for people aged 13 and over. |
| `profileSetup.privacy` | מה נשמר ולמה: מדיניות הפרטיות | What we store and why: privacy policy |
| `deleteAccount.deleted.i4` | המקום שלכם במשפחה בכל קהילה. אם אתם האחרונים במשפחה, גם רשימת הילדים נמחקת. | Your place in your family in each Kehila. If you are the last adult, the children list is deleted too. |
| `deleteAccount.deleted.i5` | מספר הטלפון, ההגדרות וההסכמות שלכם, ובקשות קישור משפחה פתוחות. | Your phone number, settings and consents, and any open family link requests. |
| `deleteAccount.posts` | למחוק גם את כל מה שפרסמתי (הודעות, תמונות, שיחה) | Also delete everything I posted (messages, photos, chat) |
| `deleteAccount.postsOff` | לא מסומן: ההודעות שכתבתם יישארו בלי שמכם, ותמונות שצירפתם יישארו איתן. | Unticked: messages you wrote stay without your name, with any photos you attached. |
| `deleteAccount.postsOn` | מסומן: כל ההודעות, הודעות השיחה והברכות הפרטיות שכתבתם, בכל הקהילות, יימחקו לכולם יחד עם התמונות. גם התגובות שנכתבו להודעות האלה יימחקו. | Ticked: every message, chat message and private blessing you wrote, in every Kehila, is removed for everyone with its photos. Replies under those messages are removed too. |
| `deleteAccount.always` | בכל מקרה: ברכות שאחרים כתבו עליכם יישארו בלי שמכם. | Either way: blessings others wrote about you stay, without your name. |
| `deleteAccount.backups` | עותקי גיבוי נשמרים עד 35 יום ואז נמחקים. | Backups keep the data for up to 35 days, then it is gone. |
| `deleteAccount.exportFirst` | רוצים עותק קודם? הורדת הנתונים שלי | Want a copy first? Download my data |
| `admin.members.family` | משפחה | Family |
| `admin.members.familyWith` | משפחה עם {name} | Family with {name} |
| `admin.members.familyAlone` | ללא בן/בת זוג | No partner |
| `admin.members.children` | ילדים: {n} | Children: {n} |
| `admin.members.readOnly` | הגבאים רואים את פרטי המשפחה ולא עורכים אותם. המשפחה מעדכנת אותם ב"אני". | Gabbaim see family details but don't edit them. The family updates them in Me. |
| `admin.members.link` | קישור לבן/בת זוג | Link to a partner |
| `admin.link.title` | קישור שני חברים כמשפחה | Link two members as a family |
| `admin.link.with` | עם מי לקשר את {name}? | Who should {name} be linked with? |
| `admin.link.hint` | מוצגים חברים וגבאים שאין להם בן/בת זוג. | Showing members and gabbaim without a partner. |
| `admin.link.notice` | שניהם יקבלו התראה וכרטיס עם אפשרות לבטל. בקשות קישור פתוחות שלהם יימחקו. | Both get a notification and a card with an undo. Their open link requests are deleted. |
| `admin.link.confirm` | קישור {a} ו{b} | Link {a} and {b} |
| `admin.link.done` | הקישור נשמר. שניהם קיבלו הודעה | Linked. Both have been told |
| `admin.link.taken` | {name} כבר מקושר/ת לבן/בת זוג. | {name} already has a partner. |
| `admin.link.none` | לא נמצא חבר מתאים. | No matching member. |
| `admin.overview.privacy.title` | איש קשר לפרטיות | Privacy contact |
| `admin.overview.privacy.body` | למי פונים חברים בשאלות על המידע שלהם: שם, טלפון או דוא״ל. מוצג לכל מי שבקהילה. | Who members contact about their data: a name, phone or email. Shown to everyone in the Kehila. |
| `admin.overview.privacy.none` | לא הוגדר | Not set |
| `admin.overview.privacy.edit` | עריכה | Edit |
| `admin.overview.privacy.field` | איש קשר לפרטיות | Privacy contact |
| `admin.overview.privacy.saved` | איש הקשר נשמר | Contact saved |
| `admin.overview.terms.title` | התנאים בין הקהילה לבין קהילות | Terms between the Kehila and Kehilot |
| `admin.overview.terms.accepted` | אושרו על ידי {name} ב־{date} | Accepted by {name} on {date} |
| `kehilaInfo.role` | התפקיד שלכם | Your role |
| `kehilaInfo.contact` | פניות בנושא פרטיות | Privacy questions |
| `kehilaInfo.roles` | הקהילה אחראית למידע של חבריה. את השירות מפעילה פלטפורמת קהילות. | The Kehila is responsible for its members' data. The Kehilot platform runs the service. |
| `kehilaInfo.terms` | התנאים בין הקהילה לבין קהילות | Terms between the Kehila and Kehilot |
| `compose.familyNote` | ברכות פרטיות יגיעו לכל המבוגרים במשפחה שנבחרה. | Private blessings reach every adult in the chosen family. |
| `compose.familyAnd` | {a} ו{b} | {a} and {b} |
| `push.familyRequest` | בקשת קישור משפחה חדשה | New family link request |
| `push.familyGabbai` | הגבאי עדכן את פרטי המשפחה שלכם | The gabbai updated your family details |
| `common.policyLink` | מדיניות הפרטיות | Privacy policy |

Also change: `admin.members.count` stays; `me.leave.confirm` stays for members (P6 adds `me.leave.family` and `me.leave.posts`
under it); `deleteAccount.kept` is no longer rendered.

### 10.4 Decisions the spec left open (for the CTO to check)

1. **One one-time card at a time** on Home, in a fixed priority order (P7), rather than a stack.
2. **Age gate exit:** "I am under 13" offers delete account or sign out (spec says only that they may not use the app).
3. **Terms acceptance is one button** ("אישור התנאים בשם הקהילה"), no extra checkbox. A gabbai also sees a
   non-blocking Home card while the terms wait.
4. **Phone-list entry on Home** is a pressable Card under the Shabbat card (Home has no menu today); in Me it is a button
   in the phone-list card.
5. **Family display name** with two different last names: "A · B".
6. **Gabbai privacy contact** lives in Overview on mobile (no settings screen exists) and in GD3 on desktop.
7. **Kehila info** is a new Sheet (no screen existed), opened from Me and from the switcher.
8. **Export link expiry:** after the 10-minute link expires the same day, the card shows "limit reached" (429). The
   server could instead re-issue a link to the day's ZIP; that would need a small API change.
9. **Removing the phone number** keeps the per-Kehila switches as they are; they take effect again with a new number.
10. **Blessing picker** hides families with no adult who can read the chosen channel.

### 10.5 Verification

Screenshot-checked at 1440 wide: P1 to P14, M7 for comparison, P7 also in dark mode, the index at 390 px.
Not checked: English (LTR) rendering of these frames, and real device fonts. The Hebrew copy should be reviewed by a
native editor; the terms summary (P8) and the privacy texts by the user's lawyer.

### 10.6 Test build: "new version" card (P15)

Android test build only (installed from GitHub Releases, used by the owner). The store build and every member never see
any of this; the check does not run there. Frame: `design/mockups/frames/P15.html`.

- **Where:** Home, under the greeting and above zmanim, first in that slot. It is outside the P7 one-at-a-time queue, so a
  P7 card still shows under it.
- **Component:** `Card` with `edgeColor={k.tekhelet}`, the P7 pattern: title (`Txt bold serif`), body, primary `Button`,
  secondary `Button`. Not `Banner` (it has one action and no dismiss). No new component.
- **When:** on start and on resume the app reads the latest GitHub release. Shown if it is newer than the installed build
  and not the version last dismissed. "Download" opens the APK URL in the browser; the card stays until that version is
  installed or dismissed. "Not now" stores the dismissed version; the card returns only for a newer one. Offline, error or
  slow reply: nothing is shown, no spinner, no message.
- **A11y:** the download Button gets `accessibilityLabel` = `testBuild.downloadA11y`.
- **Test-build marker:** Android app name (launcher label) **"בדיקה · הקהילה שלי"** (store: "הקהילה שלי"); the marker
  comes first so it survives launcher truncation. Home always shows a plain `Tag` "גרסת בדיקה · {installed}" at the end
  of the date line, in the test build only, so bug reports name the build.

| Key | Hebrew | English |
|---|---|---|
| `testBuild.title` | גרסת בדיקה חדשה | New test version |
| `testBuild.body` | גרסה {version} מוכנה. ההורדה נפתחת בדפדפן, ואחריה Android יתקין אותה על הגרסה הנוכחית. | Version {version} is ready. The download opens in your browser, then Android installs it over this version. |
| `testBuild.download` | הורדה | Download |
| `testBuild.later` | לא עכשיו | Not now |
| `testBuild.downloadA11y` | הורדת גרסת בדיקה {version} | Download test version {version} |
| `testBuild.tag` | גרסת בדיקה · {version} | Test build · {version} |

`{version}` is the release's version name (e.g. `0.1.3`), shown LTR. Not screenshot-checked (no browser run on this
machine for this change).

## 11. Mobile web polish

Added 2026-10-27 after the owner opened the deployed web app in Brave on Android (dark mode) and reported:
"English with Hebrew, not aligned the filters. Require better design even for Web over mobile." Audit: the fixtures
web build (`EXPO_PUBLIC_FIXTURES=1`) at 390x844, light and dark, Hebrew and English, plus 1440x900. Screens checked:
Home, Messages (member, gabbai), M3 detail, Compose, Me, phone list, sign-in, Messages and Home in English.
Frame: `design/mockups/frames/P16.html` (Messages after the fixes, Hebrew and English, plus the control and icon
sheets). The P1–P15 frames now draw the new top-bar bell and bottom tabs (`shared.css` `.ktop .bell`, `.ktabs`).

Scope is polish, not a redesign: existing tokens (`theme.ts`), type scale and kit components. Fixes in priority order.

### 11.1 Channel names show stored keys (Messages, MessageRow, M3, Chat, Compose, Search, prefs)

**Wrong:** the default channels are seeded as `announcements`, `simchas`, `condolences`
(`server/cloud/repo_members.py`) and the client prints `channel.name`, so a Hebrew screen shows English words
(owner's screenshot: chips "announcements", "simchas", "…es").

**Fix:** one helper, used everywhere a channel name is shown:
`channelLabel(c: Pick<Channel,'name'>, t): string` in `src/client/channelsView.ts`. If `c.name` is one of the three
keys, return `t('channel.default.<key>')`; otherwise return `c.name` unchanged (gabbai-created names are shown as
stored). Use it in: Messages chips and `nameOf`, MessageRow (via `channelName`), MessageDetail (both lines),
ChatView header, Compose (chips, `channelName`, audience line), Search (chips, `nameOf`), NotifyPrefs toggles,
admin Channels list and Home "latest".

| i18n key | he | en |
|---|---|---|
| `channel.default.announcements` | הודעות הקהילה | Announcements |
| `channel.default.simchas` | שמחות | Simchas |
| `channel.default.condolences` | אבלות | Condolences |

Admin channel sheet (`admin/Channels.tsx`): the name Field is prefilled with `channelLabel(c)`. On save, if the
trimmed value still equals that label, send the stored key unchanged, so the channel keeps localising in both
languages; any edit stores the new text. Server unchanged.

### 11.2 Messages filter header: two misaligned rows of oversized pills (M2)

**Wrong:** "שלי / הכול" and the channel row both use `Chip` (48 px tall, tekhelet fill), so two rows of identical
big pills compete; the first row is two short pills hugging the start edge while the second is a scroller, so their
widths and rhythm don't line up; the scroller is clipped at the 16 px content padding, so the last chip is cut with a
hard edge and no sign that it scrolls (owner's "…es"). Every selected control is tekhelet, the action colour.

**Fix** (frame P16; M2 already intended a segmented control and small chips):

1. **New kit `Segmented`** (`src/kit/components.tsx`): `Segmented({ options: {key,label}[], value, onChange })`.
   Track: full width, `minHeight: TOUCH` (48), `padding: 4`, `gap: 4`, `borderRadius: 12`, `backgroundColor: k.stone`,
   `borderWidth: 1, borderColor: k.line`. Segment: `flex: 1`, `minHeight: 38`, `borderRadius: 9`, centred
   `Txt size="small" bold`. Selected: `backgroundColor: k.surface`, `borderWidth: 1, borderColor: k.tekhelet`, text
   `k.tekhelet`; unselected: transparent border, text `k.muted`. `accessibilityRole="tab"` per segment inside a
   `tablist` row, `accessibilityState={{ selected }}`. Use it for "שלי / הכול" (Mine / Everything).
2. **`Chip` gets `size?: 'regular' | 'filter'`** (default regular, unchanged elsewhere). `filter`: `height: 36`,
   `paddingHorizontal: 14`, `borderRadius: 18`, `borderWidth: 1`, `hitSlop={{ top: 6, bottom: 6 }}` (48 touch),
   `Txt size="small" bold`. Unselected: `k.surface` fill, `k.line` border, `k.ink` text. Selected: `k.ink` fill and
   border, `k.stone` text (ink, not tekhelet: tekhelet stays the action colour). Optional `icon?: IconName` drawn at
   16 px before the label, `gap: 6`.
3. **Channel row** uses `Chip size="filter"`. The horizontal `ScrollView` bleeds to the screen edge so a cut chip
   reads as "more": `style={{ marginHorizontal: -16 }}`, `contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}`.
   Conversation channels: `icon="msg"` instead of the `💬 ` prefix (same in Search).
4. Header order and spacing: title row (title + search icon button, 11.3) / Segmented / channel chips, `gap: 12`,
   then the day label. All three rows share the same 16 px start edge.
5. Compose (M4) channel picker and admin chip pickers keep wrapping rows but use `size="filter"` for the same look.

### 11.3 Emoji and text glyphs as icons (top bar, Messages, tabs, FAB, phone list, chevrons)

**Wrong:** 🔔 and 🔍 render as colour emoji (Android's yellow bell, a blue magnifier) beside a typographic UI;
tab glyphs ⌂ ✉ ☺ (▦ ✓ ☷ in management) come from fallback fonts at different weights; ＋ is a full-width glyph;
☎, 🔒, 💬, ✕, ⎙ likewise. The text chevrons ‹ › are bidi-mirrored characters, so in RTL they can flip (the Home
phone-list card's "forward" chevron points right at 1440 px).

**Fix: new kit `Icon`** (`src/kit/Icon.tsx`), drawing the frames' own line icons (the `<symbol>` sprite in every
frame: 24 viewBox, stroke 1.8, round caps and joins, no fill). No new dependency: render the SVG through
`expo-image` (already installed; it renders SVG on Android, iOS and web) from a data URI:

```tsx
export function Icon({ name, size = 24, color }: { name: IconName; size?: number; color?: string }) {
  const k = useTokens();
  const c = color ?? k.ink;
  const uri = React.useMemo(() => 'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${PATHS[name]}</svg>`), [name, c]);
  return <Image source={{ uri }} style={{ width: size, height: size }} contentFit="contain" accessible={false} />;
}
```

`PATHS` is copied verbatim from the sprite in `design/mockups/frames/P1.html` (`bell, search, home, msg, user, plus,
phone, lock, check, grid, users, back, fwd, chev, x, belloff, pin, send`). Icons are images, so they are never
bidi-mirrored: pick the direction explicitly (`back` points right, `fwd` points left; in LTR swap them). The
pressable around an icon carries the `accessibilityLabel`, as today. `react-native-svg` was not chosen: it would add
a native module and need a new store build for a cosmetic change.

| Where | Today | Icon | Size / colour |
|---|---|---|---|
| TopBar bell | 🔔 | `bell` | 24, `k.ink`, in the existing 48x48 pressable |
| TopBar Kehila chevron | ⌄ | `chev` | 16, `k.muted` |
| Messages search | 🔍 | `search` | 24, `k.ink`, 48x48 pressable |
| Bottom tabs | ⌂ ✉ ☺ / ▦ ✓ ☷ ✉ ☷ | `home msg user` / `grid check msg users` | 24, active `k.tekhelet`, else `k.muted` (11.4) |
| Messages FAB | ＋ | `plus` | 20, `k.onAction` |
| Conversation chips (Messages, Search) | 💬 | `msg` | 16 via `Chip icon` |
| Phone list "חיוג", Home phone card | ☎ | `phone` | 18, `k.tekhelet` (inside secondary Button: `[Icon, label]` row, gap 8) |
| NotifyPrefs, admin Members lock | 🔒 | `lock` | 16, `k.muted` |
| Back links (M3, Compose, Me, Chat, Search, Delete, NotifyPrefs, KehilaInfo, FamilyCard) | › / ‹ | `back` (RTL) / `fwd` (LTR) | 20, `k.tekhelet`, row gap 4 |
| Forward affordances (Home cards, "לכל ההודעות", Search rows) | ‹ / › | `fwd` (RTL) / `back` (LTR) | 20, `k.tekhelet` |
| ImageViewer close | ✕ | `x` | 24, white on the dark viewer |

Leave as text: ✓ inside `Check` and `PickList` (it is a typographic tick on a filled box), ↗ external-link marks in
running text, and the Home zmanim glyphs (☀ ◷ ✧) which belong to the arc design, not chrome.

### 11.4 Bottom tab bar (all signed-in screens)

**Wrong:** icon and label side by side in one 56 px row; the glyphs are uneven (above); on a desktop browser the
three tabs spread across the full 1440 px window, far from the 680 px content column.

**Fix** (`Main.tsx` tab bar; frame `.ktabs`): outer bar unchanged (`k.surface`, top hairline `k.line`). Inner row
`width: '100%', maxWidth: 680, alignSelf: 'center', flexDirection: 'row'`. Each tab: `flex: 1, minHeight: 64`,
column, `gap: 2`: `Icon` 24 then label `Txt size="caption" bold` (12.5). Active: tekhelet icon and label plus a
`36x3` tekhelet indicator at the top edge (`position: 'absolute', top: 0`, radius `0 0 3 3`). Badge: `k.pomegranate`
circle 18 px, white 11 px bold numeral, `position: 'absolute', top: 6`, offset to the icon's end side by 6 px from
centre. Accessibility labels unchanged.

### 11.5 Hebrew content in the English UI, and names inside sentences (MessageRow, M3, Chat, replier chip)

**Wrong (English, 390 px):** Hebrew message titles and bodies are left-aligned with `writingDirection: 'ltr'`, so
the full stop lands at the wrong end (".זכרו ברוך") and lines break oddly. "3 members sent a private blessing to the
בדיוני family" mixes runs without isolation. The same happens in reverse for English content in the Hebrew UI.

**Fix:**
1. `Txt` gets `content?: boolean`. When set, direction comes from the text, not the UI language:
   `contentDir(s)` in `src/i18n/direction.ts` returns `'rtl'` if the first strong letter is Hebrew/Arabic
   (`[֐-׿؀-ۿ]`), `'ltr'` if it is Latin, else the UI `dir`. Apply `writingDirection` and
   `textAlign` (`'right'` for rtl, `'left'` for ltr) from it. Use `content` on user text: message titles and bodies
   (MessageRow, MessageDetail), replies and private blessings, chat bubbles, Kehila names in TopBar and the switcher,
   family and person names in lists.
2. `translate()` (`src/i18n/translate.ts`) wraps every interpolated string parameter in Unicode isolates
   (`'⁨' + value + '⁩'`) so a Hebrew name inside an English sentence (and the reverse) keeps its own
   direction. Numbers are left as they are. Update tests that compare translated strings with parameters.

### 11.6 Dates follow the UI language; Hebrew date in letters (Home, Shabbat card)

**Wrong:** in English, Home shows "יום שלישי, 27 באוקטובר · 16 בחשוון 5787" and the Shabbat line in Hebrew
(`dates.ts` hard-codes `he-IL`). In Hebrew, the Hebrew date uses digits, against §2 ("ט״ו בחשוון תשפ״ז"; P15 already
draws "ט״ז בחשוון תשפ״ז").

**Fix:** `displayDate(date, lang)` and `hebrewDate(date, lang)` take the UI language. Hebrew: `displayDate` as today;
`hebrewDate` uses `formatToParts` of `he-IL-u-ca-hebrew` and replaces the `day` and `year` parts with `gematriya()`
from `@hebcal/hdate` (already a dependency) → "ט״ז בחשוון תשפ״ז". English: `en-GB` → "Tuesday 27 October" and
`en-GB-u-ca-hebrew` → "16 Heshvan 5787". The parasha comes from the server in Hebrew; keep it and let 11.5's
isolates handle it.

### 11.7 Desktop and wide browsers

**Wrong (1440x900):** content is correctly capped at 680 px and centred, but the "הודעה חדשה" FAB sits at the
window's bottom-left corner, about 380 px away from the column, and the tab bar spans the window (11.4).

**Fix:** the FAB is positioned inside a full-width absolute wrapper that is itself capped:
`position: 'absolute', bottom: 16, left: 0, right: 0, alignItems: 'center'` → inner
`width: '100%', maxWidth: 680, paddingHorizontal: 16, alignItems: 'flex-end'` (logical end, i.e. left in RTL, the
side it is on today), `pointerEvents="box-none"` on both. The FAB itself follows the frame: `height: 56`,
`borderRadius: 18`, `paddingHorizontal: 20`, `[Icon plus 20, label]` with `gap: 8`. On web with window width
≥ 600 (`useWindowDimensions`), the channel chips wrap (`flexWrap: 'wrap'`, no ScrollView): a mouse cannot drag a
horizontal scroller.

### 11.8 Checked and fine (no change)

- Dark-mode contrast: `k.muted` on `k.surface`, tekhelet chips with `k.onAction` text, badges and the stripe colours
  all read clearly on the owner's device class; disabled buttons at 0.6 opacity are intentionally dim.
- Sign-in (he and en), Me, phone list, M3 and Compose layouts match P1–P4 and M3/M4 apart from the icon and
  channel-name items above. No horizontal page scroll at 390 px on any screen checked.
- Not checked: management screens beyond the tab bar, native Android/iOS rendering of `Icon` (verify once on a dev
  build: `expo-image` SVG data URI), real (non-fixture) channel data.

## 12. Message types

Added 2026-10-27 for `docs/superpowers/specs/2026-10-27-message-types-design.md`. Mazal tov and condolence are no
longer channels: they are message types in the one main channel ("הודעות הקהילה"), with a per-Kehila rule a gabbai
sets. Frames: `design/mockups/frames/P17.html` (types, Messages filter) and `P18.html` (role tags, 12.6), index section "ה". Like the
P frames, they draw the shipped kit; build 1:1. GD3 (desktop draft) is updated to match: the "שמחות" row is gone and a
"סוגי הודעות" table sits under the channel table. P16 carries a note that its chip row is superseded here.

### 12.1 One label per type

The app had three names for some types (Compose "שמחה", push texts "מזל טוב"; Compose "השתתפות בצער", push texts
"הודעת אבל", channel "אבלות"). From now on there is one user-facing label per type, used in Compose, the Messages
meta line and the gabbai settings:

| type | he | en | stripe |
|---|---|---|---|
| `general` | הודעה | Message | `tekhelet` |
| `weekly` | עדכון שבועי | Weekly update | `gold` |
| `event` | אירוע | Event | `tekhelet` |
| `celebration` | מזל טוב | Mazal tov | `pomegranate` |
| `condolence` | השתתפות בצער | Condolence | `ash` |

**Condolence = "השתתפות בצער"**: it is what Compose already says, it matches the reply button ("משתתף בצער"), and it
is gentle; "ניחומים" appears nowhere in the app, and "אבל"/"אבלות" alone reads as a heading for mourning itself
rather than a notice. The push-text editor keeps "הודעת אבל" (it names a push template, not a type). `general` shares
tekhelet with `event`: the stripe carries the register (joy, grief, Shabbat, neutral), the label carries the type.

Order everywhere: general, weekly, event, celebration, condolence (`TYPES` in Compose).

### 12.2 Gabbai: "סוגי הודעות" in the Channels screen (P17 phone 1 and the first two panels; GD3 on desktop)

**Where:** `admin/Channels.tsx` (the screen built for mobile and web; GD3 is its desktop draft), after the channel
cards. A section header (`Txt serif size="heading"`), one intro line, then:

1. **Card "מזל טוב"** (`Card edgeColor={k.pomegranate}`), **Card "השתתפות בצער"** (`edgeColor={k.ash}`). Each:
   `Txt bold` "מי מפרסם", two `Choice` rows (from `admin/shared.tsx`, radio semantics): "ההנהלה בלבד" (note: "חברים
   עם הרשאת שליחה יפרסמו הודעה רגילה בלבד") and "הנהלה וחברים עם הרשאת שליחה" (note: "ברירת המחדל"); then
   `Toggle` "מתפללים אורחים רואים הודעות מזל טוב / השתתפות בצער" (default off), then a constant `Txt small muted`
   line: "חל גם על הודעות שכבר פורסמו. חברים וגבאים רואים אותן תמיד." (not `offNote`: it applies in both states).
2. **Card "שאר הסוגים · קבוע"**, read-only: one row per fixed type, the label in bold and one muted line
   "מפרסמים: … · רואים: …". No controls, no disabled switches: fixed rules are text, so they never look editable.
3. Closing muted line: "חברים רואים את כל סוגי ההודעות."

**Interplay with the channel:** if the main channel's `postPolicy` is `management`, an info `Banner` at the top of the
section: members cannot post any type there; the choices below are kept and apply once the channel is opened.

**Saving:** each tap saves at once (`PATCH` of `settings.typeRules`), Toast "ההגדרה נשמרה". On error the control
returns to its previous value and an error `Banner` shows at the top of the section (`useAdminErrText`). No Save
button: two small settings, each change is one decision, as with the broadcast-permission toggle in Members.

### 12.3 Compose (P17 phones 2 and 3, panels "סוג אחד" and "403")

- The type cards (today's stripe cards, two per row, `flexBasis: '47%'`) list only `postableTypes` of the chosen
  channel, in the 12.1 order. Typical member with broadcast permission: הודעה, מזל טוב, השתתפות בצער. Gabbai: all five.
  Default selection: the first postable type.
- **One type:** the "סוג ההודעה" label and cards are not rendered at all.
- **One channel:** the "ערוץ" chip row is not rendered either; the audience line ("יישלח לערוץ הודעות הקהילה") still
  says where it goes. Both rows come back when there is more than one option.
- Family picker (P14) unchanged; shown for mazal tov and condolence only.
- Type cards: `accessibilityRole="radio"` inside a `radiogroup` labelled "סוג ההודעה", `accessibilityState={{ selected }}`
  (today they are buttons with `selected`; radio is correct for one-of-many).
- **Refused (403 `forbidden` on publish):** the rule changed while composing. Compose keeps title, body and image,
  refreshes channels, and shows an error `Banner` above "פרסום" (Compose shows errors in a Banner, not a toast: the
  text must stay while the person decides, and it carries an action). If `general` is still postable the Banner has
  the action "שינוי להודעה רגילה": it selects `general` and clears the family; the person presses "פרסום" again
  (never auto-publish). If nothing is postable any more, the Banner is `compose.refusedAll` with no action.
  A 403 for another reason (role removed) keeps today's `errors.forbidden` text.

### 12.4 Messages: channel row, search and type filter (P17 phone 4 and the Messages panels)

Owner, spec item 8a: "the message types become a filter on channel. So allow filter by free text or message type,
where MT is a multi select". This overrides the first draft's "no type filter".

**Header, top to bottom** (part of the list header, so it scrolls away with the list; `gap: 12`, one 16 px start
edge, as §11.2):

1. Title row: "הודעות" only. **The search icon button goes.**
2. ~~`Segmented` שלי / הכול (unchanged).~~ Removed by §12.8: the switch "להציג גם הודעות מושתקות" in the type list.
3. **Search field, always visible.** A `TextInput` in the Field style (48 high, radius 10, `k.line` border,
   `k.surface`), `Icon search` 20 `k.muted` at the start, placeholder "חיפוש בהודעות"; when not empty, a 44×44
   `Icon x` button at the end ("ניקוי החיפוש"). Filters as you type (200 ms debounce). Matches title, body and names,
   the same matcher the Search screen uses today, and once there is text it runs over the whole on-device archive
   (older messages too), with today's "הארכיון עדיין נטען ({n} הודעות עד כה)" line while it loads.
4. Channel chips, **only when the person sees more than one channel** (`channels.length > 1`), single select, as §11.2.
5. *Superseded by §12.8: one "סוג הודעה" control opening a list with counts.* **Type chips, multi-select.** `Chip size="filter"` in a bleeding scroller (wraps on web ≥ 600 like the channel
   row). Unselected: an 8 px dot in the type's stripe colour before the label. Selected: ink fill (as §11.2) and
   `Icon check` 16 in place of the dot, so "several can be on" is visible and status is not colour alone. No "all
   types" chip: none selected means all. The row lists only types the person can see (a listener does not get
   מזל טוב / השתתפות בצער while the gabbai keeps them hidden), in the 12.1 order.
6. When any filter is active (text, a type, or a channel other than "all"): a count line, `Txt small muted`
   "{n} הודעות" with the link "ניקוי הסינון" at the end (48 touch). Not shown without filters.

**Logic:** mode (mine/all) AND channel AND text AND (type₁ OR type₂ …). All on the device, over what the person may
already see. "ניקוי הסינון" clears text, types and channel, not mine/all (that is a view, not a filter). Filters
live while the Messages tab is mounted; switching Kehila clears them. Chat channel chips still open the chat.

**Empty result:** centred `Txt` "לא נמצאו הודעות שמתאימות לסינון." and a secondary `Button` "ניקוי הסינון". In
"שלי", if "הכול" has matches, one more line: "יש {n} הודעות מתאימות ב„הכול“." with the link "הצגה ב„הכול“"
(switches the Segmented, keeps the filters).

**Decision: merge the Search screen into Messages.** Two places that search the same messages with different
controls would confuse; a field behind an icon would hide the very filter the owner asked for. So the text field
is always visible, and `Search.tsx` (and the `search` route) goes: anything that opened it now opens Messages with
the field focused. The `search.*` keys are replaced by the `messages.*` keys below and can be removed. Cost: about 60 px more header than
§11.2 on a phone. Accepted because the header scrolls away.

**Meta line** of `MessageRow` and M3: the type label replaces the channel name, which used to carry the type
("שמחות · 14:50"): `{type} · {time}`, and `{type} · {channel} · {time}` when the person sees more than one channel.
Chat messages keep the channel name.

**A11y:** the field has `accessibilityRole="search"` and label "חיפוש בהודעות"; the type row is a group labelled
"סינון לפי סוג" whose chips are `checkbox` with `checked`; channel chips stay `tab`-like single select with
`selected`. The count line is a polite live region, so each change announces "{n} הודעות".

### 12.5 Copy

New or changed keys (`src/i18n/he.json` / `en.json`). Existing keys reused unchanged are not listed
(`admin.channels.policyOpt.*` supplies the two choice labels).

| Key | Hebrew | English |
|---|---|---|
| `compose.types.general` (new) | הודעה | Message |
| `compose.types.celebration` (changed) | מזל טוב | Mazal tov |
| `compose.types.condolence` (unchanged he; en kept) | השתתפות בצער | Condolence |
| `compose.refused` | ההגדרות השתנו ואין לכם עוד הרשאה לפרסם הודעה מהסוג הזה. מה שכתבתם נשמר. | The settings changed and you can no longer post this type of message. What you wrote is kept. |
| `compose.refusedAll` | אין לכם כרגע הרשאה לפרסם בקהילה. מה שכתבתם לא נשלח. | You can't post in this community right now. Your message was not sent. |
| `compose.asGeneral` | שינוי להודעה רגילה | Change to a regular message |
| `messages.search` | חיפוש בהודעות | Search messages |
| `messages.searchClear` | ניקוי החיפוש | Clear search |
| `messages.typesLabel` | סינון לפי סוג | Filter by type |
| `messages.count` | {n} הודעות | {n} messages |
| `messages.countOne` | הודעה אחת | 1 message |
| `messages.clearFilters` | ניקוי הסינון | Clear filters |
| `messages.emptyFiltered` | לא נמצאו הודעות שמתאימות לסינון. | No messages match your filters. |
| `messages.inAll` | יש {n} הודעות מתאימות ב„הכול“. | {n} matching messages in Everything. |
| `messages.showAll` | הצגה ב„הכול“ | Show in Everything |
| `messages.archiveLoading` (was `search.loading`) | הארכיון עדיין נטען ({n} הודעות עד כה) | The archive is still loading ({n} messages so far) |
| `admin.types.title` | סוגי הודעות | Message types |
| `admin.types.intro` | כל ההודעות מתפרסמות בערוץ הודעות הקהילה. כאן קובעים מי מפרסם מזל טוב והשתתפות בצער, והאם מתפללים אורחים רואים אותן. | All messages go to the Announcements channel. Here you choose who may post mazal tov and condolence messages, and whether guests see them. |
| `admin.types.postLabel` | מי מפרסם | Who may post |
| `admin.types.noteManagement` | חברים עם הרשאת שליחה יפרסמו הודעה רגילה בלבד | Members with broadcast permission can post regular messages only |
| `admin.types.noteDefault` | ברירת המחדל | Default |
| `admin.types.listeners.celebration` | מתפללים אורחים רואים הודעות מזל טוב | Guests see mazal tov messages |
| `admin.types.listeners.condolence` | מתפללים אורחים רואים הודעות השתתפות בצער | Guests see condolence messages |
| `admin.types.listenersNote` | חל גם על הודעות שכבר פורסמו. חברים וגבאים רואים אותן תמיד. | Applies to messages already posted too. Members and gabbaim always see them. |
| `admin.types.fixedTitle` | שאר הסוגים · קבוע | Other types · fixed |
| `admin.types.rowPost` | מפרסמים: {who} | Posted by: {who} |
| `admin.types.rowSeen` | רואים: {who} | Seen by: {who} |
| `admin.types.seenAll` | כולם, כולל מתפללים אורחים | Everyone, guests included |
| `admin.types.membersSeeAll` | חברים רואים את כל סוגי ההודעות. | Members see every message type. |
| `admin.types.channelClosed` | בערוץ הודעות הקהילה רק ההנהלה מפרסמת, ולכן חברים לא יכולים לפרסם אף סוג. אפשר לשנות בעריכת הערוץ. | Only gabbaim post in the Announcements channel, so members can't post any type. You can change this by editing the channel. |
| `admin.types.saved` | ההגדרה נשמרה | Setting saved |

Fixed rows are built as `{label}` + `rowPost` (`policyOpt.management` or `policyOpt.broadcasters`) + " · " + `rowSeen`
(`seenAll`).

**A11y:** each Choice is a radio with its label; the two in a card sit in a `radiogroup` whose label is the card
title plus "מי מפרסם" (e.g. "מזל טוב, מי מפרסם"), so a screen reader knows which type it changes. The Toggle labels
name the type for the same reason. Fixed rows are plain text. The Toast "ההגדרה נשמרה" is announced
(`accessibilityLiveRegion="polite"` as for other toasts); the refused Banner uses `accessibilityRole="alert"`.

### 12.6 Role tags (P18)

Owner: "support from now a roles tag … the chips and the ability to assign roles to people in the Kehila are a good
foundation." Tags are Kehila-defined names (גבאי, רב, טכני, ועד שמחות), several per person, created and assigned by
gabbaim only. **Labels only:** they grant nothing; the access role (guest / member / gabbai) and broadcast permission
are unchanged. Up to 20 per Kehila, name 1–24 code points, unique within the Kehila (trimmed, case-insensitive).
Later they become the base for per-type permissions (spec "Later").

**Look:** `Tag` gets `tone="role"`: same size as `Tag` (min height 24, radius 12, 12.5 bold), `k.surface` fill,
`k.line` border, `k.ink` text. The access-role and class tags stay `plain` (stone fill, muted text). The difference
is deliberate: a role tag is a name, the access tag is what the person can do. Shown in a wrapping row, gap 6.

**Manage the list — Members screen** (`admin/Members.tsx`), secondary `Button` "תגיות תפקיד" (icon `edit`) under the
title. It opens a `Sheet` "תגיות תפקיד": intro line; one row per tag (name, people count `Txt caption muted`,
48×44 icon buttons `edit` and `trash`); counter "n מתוך 20"; `Field` "תגית חדשה (עד 24 תווים)" + `Button` "הוספה";
"סגירה". Rename turns the row into a `Field` with "שמירה" / "ביטול". Delete is the inline confirm pattern (info
`Banner` with the count, danger "כן, למחוק", secondary "ביטול"). Add, rename and delete save at once with a Toast.
Chosen over GD3 because tags are about people: the gabbai creates a tag where they assign it.

**Starter set (empty list):** the Sheet shows "עדיין אין תגיות. אפשר להתחיל מאלה:" and eight dashed suggestion chips
(`Chip size="filter"` with `icon="plus"`, dashed tekhelet border, tekhelet text, so they read as "add", not as a
selection): גבאי, רב, חזן, בעל קורא, גזבר, ועד הקהילה, ועד שמחות, טכני. One tap adds that tag (in the UI language,
stored as text like any typed tag) and removes the chip. The suggestions disappear once the Kehila has any tag.

**Assign — member card:** under the family line, the person's role tags (or "אין תגיות", muted) and a link-style
pressable "עריכת תגיות" (48 touch). It opens a `Sheet` "התגיות של {name}" with one `Check` per Kehila tag, the link
"ניהול רשימת התגיות" (opens the manage Sheet), the muted note that tags grant nothing, and footer "שמירה" / "סגירה"
(the discard-confirm of the channel sheet applies). If the Kehila has no tags: "אין עדיין תגיות בקהילה." and the
manage link only. On wide screens (`WIDE`) the members table gets a "תגיות" column with the same row of tags.

**Where tags show:**

| Place | Shown | Why |
|---|---|---|
| Members admin list (and its wide table) | yes | where they are assigned |
| Me, Profile card, current Kehila | yes, if any: "התפקידים שלי בקהילה" + note "הגבאים מעדכנים את התגיות." | a person should see what the Kehila calls them |
| Phone list (P1) row, under the adult's name | yes | finding the treasurer or the rabbi is the main reason to open the list; only people who chose to appear |
| Message row / M3 author line | no | rows do not show an author today, and a tag beside a message would read as authority it does not have |
| Join, switcher, Kehila info (P13) | no | not about one person |

Listeners can be tagged like anyone in the Members screen; they see their own tags in Me (they have no phone list).

| Key | Hebrew | English |
|---|---|---|
| `admin.tags.button` | תגיות תפקיד | Role tags |
| `admin.tags.title` | תגיות תפקיד | Role tags |
| `admin.tags.intro` | שמות לתפקידים בקהילה, כמו רב או טכני. התגיות מוצגות ליד השם ולא נותנות הרשאות. | Names for roles in the community, such as Rabbi or Tech. Tags show next to a name and grant no permissions. |
| `admin.tags.listTitle` | התגיות בקהילה | Tags in this community |
| `admin.tags.count` | {n} מתוך 20 | {n} of 20 |
| `admin.tags.people` | {n} אנשים | {n} people |
| `admin.tags.emptyStart` | עדיין אין תגיות. אפשר להתחיל מאלה: | No tags yet. You can start with these: |
| `admin.tags.suggest` | גבאי, רב, חזן, בעל קורא, גזבר, ועד הקהילה, ועד שמחות, טכני | Gabbai, Rabbi, Chazan, Torah reader, Treasurer, Committee, Simchas committee, Tech |
| `admin.tags.suggestA11y` | הוספת התגית {name} | Add the tag {name} |
| `admin.tags.newField` | תגית חדשה (עד 24 תווים) | New tag (up to 24 characters) |
| `admin.tags.add` | הוספה | Add |
| `admin.tags.renameA11y` | שינוי השם של {name} | Rename {name} |
| `admin.tags.renameField` | שינוי שם | Rename |
| `admin.tags.deleteA11y` | מחיקת התגית {name} | Delete the tag {name} |
| `admin.tags.deleteConfirm` | למחוק את התגית "{name}"? היא תוסר מ־{n} אנשים. | Delete the tag "{name}"? It will be removed from {n} people. |
| `admin.tags.deleteConfirmNone` | למחוק את התגית "{name}"? אף אחד לא מסומן בה. | Delete the tag "{name}"? Nobody has it. |
| `admin.tags.deleteYes` | כן, למחוק | Yes, delete |
| `admin.tags.cancel` | ביטול | Cancel |
| `admin.tags.save` | שמירה | Save |
| `admin.tags.close` | סגירה | Close |
| `admin.tags.required` | נא להזין שם | Enter a name |
| `admin.tags.duplicate` | כבר יש תגית בשם הזה | A tag with this name already exists |
| `admin.tags.limit` | אפשר עד 20 תגיות. מחקו תגית כדי להוסיף חדשה. | Up to 20 tags. Delete one to add another. |
| `admin.tags.added` | התגית נוספה | Tag added |
| `admin.tags.renamed` | השם עודכן | Name updated |
| `admin.tags.deleted` | התגית נמחקה | Tag deleted |
| `admin.tags.member.none` | אין תגיות | No tags |
| `admin.tags.member.edit` | עריכת תגיות | Edit tags |
| `admin.tags.member.editA11y` | עריכת התגיות של {name} | Edit {name}'s tags |
| `admin.tags.member.list` | תגיות: {list} | Tags: {list} |
| `admin.tags.assign.title` | התגיות של {name} | {name}'s tags |
| `admin.tags.assign.manage` | ניהול רשימת התגיות | Manage the tag list |
| `admin.tags.assign.empty` | אין עדיין תגיות בקהילה. | This community has no tags yet. |
| `admin.tags.assign.saved` | התגיות נשמרו | Tags saved |
| `admin.tags.note` | תגיות לא נותנות הרשאות. מה שאדם יכול לעשות נקבע בתפקיד שלו ובהרשאת השליחה. | Tags grant no permissions. What a person can do is set by their role and broadcast permission. |
| `admin.tags.column` | תגיות | Tags |
| `me.tags.label` | התפקידים שלי בקהילה | My roles in the community |
| `me.tags.note` | הגבאים מעדכנים את התגיות. | The gabbaim set these tags. |

`admin.tags.suggest` is one comma-separated string per language, split in code, so translators see the set whole.

**A11y:** a row of tags is one text element labelled `admin.tags.member.list` ("תגיות: רב, טכני"), not one stop per
tag. Suggestion chips are buttons labelled `suggestA11y`. The icon buttons carry `renameA11y` / `deleteA11y`. Tag
names are user text: `Txt content` (§11.5), so an English tag in a Hebrew UI keeps its own direction.

### 12.7 Verification

Frames written by hand, not screenshot-checked (no browser run on this machine for this change): check P17, P18 and
GD3 at 1440 and 390 before building. Not checked: dark mode of the new frame helpers (they use only `--k-*`
variables), English rendering beyond the English panels, real device fonts. Names in frames are invented.

### 12.8 Filter redesign (owner, 2026-10-28)

Frame: `design/mockups/frames/P40.html` (index section "ה"). **Supersedes** the `Segmented` שלי / הכול (§6 item 5,
§11.2 item 1 for Messages, §12.4 item 2) and the type chip row (§12.4 item 5). Everything else in §12.4 stands:
the always-visible search field, the channel chips when there is more than one channel, the meta line, the merge of
the Search screen, and the filter logic.

Owner feedback on the dev build (phone photo): (1) nobody understands "שלי" and "הכול"; (2) search is good, but types
should be one control, "סוג הודעה", that opens a multi-select list and summarises the choice on itself; (3) the chip
row does not fit a phone ("מזל טוב" clipped, "השתתפות בצער" off screen); (4) show how many messages each type has.

**Decision on שלי / הכול: the Segmented goes.** The list always opens as "שלי" did (subscribed channels and types,
members not muted). "הכול" survives as one switch with a self-explaining name, "להציג גם הודעות מושתקות", at the
bottom of the type list, with the number of muted messages it would add. Reasons: the two words named a rule the
person had to learn (what is mine?); the switch names the actual difference (muted things), sits next to the other
"what do I see" choices, and costs no header row. The behaviour is unchanged: when on, muted items appear in place
with the dotted edge, lighter title and the "מושתק" tag; the unread count and badges never include muted items.
The switch is remembered on the device per Kehila, as the Segmented was.

**Header, top to bottom** (scrolls away with the list, `gap: 12`, one 16 px start edge):

1. Title "הודעות".
2. Search field (§12.4 item 3, unchanged).
3. Channel chips, only when the person sees more than one channel (§12.4 item 4, unchanged).
4. **Type control** (new kit `SelectButton`, below).
5. Count line when a filter is active (§12.4 item 6, unchanged): "{n} הודעות" and "ניקוי הסינון".

About 50 px shorter than §12.4 (no Segmented; one 48 px control instead of a 36 px chip row plus its gap). Fits 360
with no horizontal scroll.

**`SelectButton`** (`src/kit/components.tsx`): `SelectButton({ icon, label, summary, count, active, open, onPress,
accessibilityLabel })`. Full width, `minHeight: TOUCH` (48), `borderRadius: 10`, `k.surface`, `borderWidth: 1`
`k.line`, `paddingStart: 12, paddingEnd: 8`, `gap: 8`, row: `Icon sliders` 20 `k.muted` / text `flex: 1`,
`numberOfLines={1}` / count badge / `Icon chev` 20 `k.muted` (rotated 180° while open).
- **Nothing selected:** `Txt bold` "סוג הודעה" + `Txt muted` " · הכול".
- **Selected:** `Txt bold` "סוג: אירוע, מזל טוב" (names in the §12.1 order, not tap order). Border 2 px `k.ink`,
  icon `k.ink`, and a badge with the number selected (24 high, radius 12, `k.ink` fill, `k.stone` text, caption
  bold). State is carried by the text and the badge, not by colour.
- **Summary rule:** up to two names joined with ", " if the joined text is at most 22 characters; otherwise
  "{first} ועוד {n}" ("סוג: הודעה ועוד 2"). Ellipsis is only a safety net.
- A11y: `accessibilityRole="button"`, label "סוג הודעה: {summary}. {n} הודעות", hint "פתיחת רשימת הסוגים";
  `accessibilityState={{ expanded: open }}`; on web `aria-haspopup="dialog"`.

**The type list.** Phone (width < 600): the kit `Sheet`, title "סוג הודעה". Wide (≥ 600, web): a popover anchored
under the control, end-aligned, width 340, `k.surface`, radius 12, shadow, no title and no Close button; closes on
outside click or Esc, focus moves to the first row on open and back to the control on close. Contents, both forms:

1. Hint (`Txt small muted`, sheet only): "אפשר לבחור כמה סוגים. המספרים לפי החיפוש והתצוגה הנוכחיים."
2. A `Card` (padding 0 16, rows divided by `k.line`) of `Check` rows, 48 high: first **"כל הסוגים"** with the total,
   then one row per type the person may see (§12, §12.4 item 5: a listener does not get מזל טוב / השתתפות בצער
   while the gabbai keeps them hidden), in the §12.1 order. Each type row: box / 8 px dot in the type's stripe colour /
   label / count at the end (`Txt small bold muted`, tabular figures). Selected rows: label bold.
   "כל הסוגים" is checked when no type is selected; tapping it clears the type selection. Selecting all types
   one by one is the same as none (the selection collapses to "all").
3. **Muted section:** a line, then `Toggle` "להציג גם הודעות מושתקות" and a constant `Txt caption muted` line
   "מערוצים, סוגים וחברים שהשתקתם בהעדפות ההתראות ({n} הודעות). הן אף פעם לא נספרות כלא נקראו." Hidden entirely
   when the person has muted nothing.
4. Sheet only: the Close button reads "הצגת {n} הודעות" (`closeLabel`; "הצגת הודעה אחת"; "סגירה" when 0).

Changes apply at once (the list behind updates live); the button only closes. No Cancel: every tap is cheap to undo.

**Counts.** Faceted: each type's count is the number of messages that pass mode (muted switch) AND channel AND text,
ignoring the type selection, so each row says what you would get by selecting it. "כל הסוגים" = sum of the rows
(one type per message). The Close label and the count line use the full filter (types included). Counts run over
the same set the filtered list uses: the whole on-device archive, which opening the list starts loading (as typing
does); while it loads, the rows update and the sheet shows the existing "הארכיון עדיין נטען ({n} הודעות עד כה)"
line under the card. A type with 0 is shown (rows do not jump), its `Check` is `disabled` (opacity .6, "0" in
text) unless it is already selected, so a selection can always be undone. Muted messages count only while the
switch is on.

**Logic** (unchanged from §12.4 apart from the mode): (muted switch ? all : not muted) AND channel AND text AND
(type₁ OR type₂ …). "ניקוי הסינון" clears text, types and channel, **not** the muted switch (a remembered view
setting, like the Segmented before). Types and text live while the tab is mounted; switching Kehila clears them.

**Empty result:** "לא נמצאו הודעות שמתאימות לסינון." and the secondary Button "ניקוי הסינון". If the switch is off
and muted messages match: "יש {n} הודעות מתאימות בין ההודעות המושתקות." with the link "הצגת המושתקות" (turns the
switch on, keeps the filters). Replaces `messages.inAll` / `messages.showAll`.

**End of list:** after the last loaded message, when the switch is off and muted messages match the current filters,
one row: `Icon belloff` + "{n} הודעות מושתקות לא מוצגות" + link "הצגה" (48 touch). When the switch is on:
`Icon bell` + "מוצגות גם הודעות מושתקות" + link "הסתרה". This is where someone scrolling back notices that
something is hidden, without a permanent header row.

**A11y:** the list is a `group` labelled "סוג הודעה"; each row is a `checkbox` with `checked` and `disabled`, label
"{type}, {n} הודעות" (count read with the name); the switch keeps `switch` semantics. The count line stays a polite
live region. Status is never colour alone: checks, bold, the summary text and the badge carry it. All targets 48.

**English:** mirrored; "Message type · All", "Type: Event, Mazal tov", "All types", "Also show muted messages",
"Show 8 messages" (P40 English panel).

**Copy** (`src/i18n/he.json` / `en.json`). Remove `messages.filterMine`, `messages.filterAll`, `messages.inAll`,
`messages.showAll`, `messages.typesLabel`. Keep `messages.muted` ("מושתק") for the tag.

| Key | Hebrew | English |
|---|---|---|
| `messages.type.control` | סוג הודעה | Message type |
| `messages.type.all` | הכול | All |
| `messages.type.summary` | סוג: {list} | Type: {list} |
| `messages.type.more` | {first} ועוד {n} | {first} +{n} |
| `messages.type.allRow` | כל הסוגים | All types |
| `messages.type.hint` | אפשר לבחור כמה סוגים. המספרים לפי החיפוש והתצוגה הנוכחיים. | Pick one or more. Numbers follow your current search and view. |
| `messages.type.a11y` | סוג הודעה: {summary}. {n} הודעות | Message type: {summary}. {n} messages |
| `messages.type.a11yHint` | פתיחת רשימת הסוגים | Opens the type list |
| `messages.type.rowA11y` | {type}, {n} הודעות | {type}, {n} messages |
| `messages.type.show` | הצגת {n} הודעות | Show {n} messages |
| `messages.type.showOne` | הצגת הודעה אחת | Show 1 message |
| `messages.mutedToggle` | להציג גם הודעות מושתקות | Also show muted messages |
| `messages.mutedNote` | מערוצים, סוגים וחברים שהשתקתם בהעדפות ההתראות ({n} הודעות). הן אף פעם לא נספרות כלא נקראו. | From channels, types and members you muted in notification settings ({n} messages). They never count as unread. |
| `messages.mutedHidden` | {n} הודעות מושתקות לא מוצגות | {n} muted messages hidden |
| `messages.mutedHiddenOne` | הודעה מושתקת אחת לא מוצגת | 1 muted message hidden |
| `messages.mutedShown` | מוצגות גם הודעות מושתקות | Muted messages are shown |
| `messages.mutedShow` | הצגה | Show |
| `messages.mutedHide` | הסתרה | Hide |
| `messages.inMuted` | יש {n} הודעות מתאימות בין ההודעות המושתקות. | {n} matching messages are muted. |
| `messages.showMuted` | הצגת המושתקות | Show muted |

**Verification:** P40 checked in headless Chromium (Playwright 1.47.2) at 1400 and 390, light and dark: no horizontal
scroll at 390, no clipped summary text, check marks visible in both themes. Screens: 390×844 PNGs (closed, sheet
with counts, active filter; light and dark). Not checked: real device fonts, RN `Modal` sheet height on small
Android phones (the sheet with five types plus the muted section is about 600 px; it scrolls inside the kit `Sheet`
if needed), screen-reader output. Names are invented.

## 13. Bug reports (alpha)

Added 2026-10-27 for `docs/superpowers/specs/2026-10-27-bug-reports-design.md` §1. Frame:
`design/mockups/frames/P19.html` (index section "ה"). Kit-drawn like the P frames.

### 13.1 The button

- **Look:** a pill, height 32 (`hitSlop` to 48), radius 16, `k.ink` fill, `k.stone` text, `Txt size="caption" bold`
  "אלפא · דיווח על תקלה", soft shadow. Ink, not tekhelet: it is not an app action and must not compete with
  "הודעה חדשה". No bug icon (it reads as an error state). At its end, separated by a hairline, a 28-wide `Icon x`
  16 segment, "הסתרה לעכשיו".
- **Collapsed:** "✕" turns it into a 14 px `k.ink` dot with a 3 px `k.stone` ring, same spot, 48 touch. Tapping the
  dot brings the pill back (it does not open the sheet: a stray tap on a dot should not start a report). Collapsed
  state lasts for the app session (memory only, not stored).
- **Where, phone and narrow web (< 1024):** bottom-**start** corner (right in Hebrew, left in English), 16 from the
  start edge, 16 above the tab bar; on screens without a tab bar (sign-in, sign-up, profile setup, gates) 16 from
  the bottom. The compose FAB is on the end side (§11.7), so the two never meet: at 360 the FAB (~160) and the
  pill (~140) leave a gap of about 30.
- **Where, wide (≥ 1024, desktop and admin console):** bottom-**end** corner of the window, 16 inset, outside the 680
  content column and away from the start-side admin sidebar.
- **Hidden** while: the keyboard is open, any `Sheet` or modal is open (its own sheet included), the image viewer is
  open, and on the chat screen (its composer sits at the bottom). Every scrolling screen adds 56 px of bottom
  padding when the button shows, so a last primary button ("פרסום", "שמירה", "כניסה") can always scroll clear of it.
- Mounted once at the root (`App`/`Main`), above navigation, so it is on every screen, signed in or not. A build
  flag (`config.bugReports`) removes it.
- **A11y:** the pill is a button labelled "דיווח על תקלה (גרסת אלפא)"; the ✕ is its own button "הסתרה לעכשיו"; the dot
  is a button "הצגת כפתור הדיווח". It comes after the screen's own content in focus order.

### 13.2 The report sheet

`Sheet` "דיווח על תקלה":

1. Intro `Txt small`: what happened and what you expected; it goes to the development team only, not to gabbaim
   (true per spec §2, and it makes people comfortable describing a message).
2. `Field` multiline "מה קרה?", `maxCodePoints={2000}`, counter under it; required.
3. **Picture (signed in only):** two secondary Buttons in a row, "צילום המסך הזה" (only where the platform can
   capture: the capture is taken *before* the sheet opens, so it shows the screen being reported) and "בחירת
   תמונה" (the existing image picker). Once attached: a 56×96 thumbnail, its name, the warning "בדקו שאין בו משהו
   שלא תרצו לשלוח.", and a `trash` icon button "הסרת התמונה". One picture.
4. **"יצורף אוטומטית"** `Card`: one muted line with the real values: version (build), platform and OS version,
   screen name, UI language, Kehila (shown by name; the id is what is sent). Then: "לא נשלחים תוכן הודעות, סיסמאות
   או פרטים של אנשים אחרים."
5. Footer: primary "שליחה" (disabled until there is text and while over 2000; busy while sending), secondary "ביטול".
   "ביטול" with text typed asks first (the channel sheet's discard pattern).

**Signed out** (sign-in, sign-up, verification): same sheet, no picture row, a muted line "בלי חשבון אפשר לשלוח
טקסט בלבד.", the details card without a Kehila.

**After sending:** the sheet closes, the text is cleared, Toast "תודה, הדיווח נשלח". No status screen in this version.

**Errors** (Banner above the footer, text kept): network/5xx (error tone), 429 signed in (info, "tomorrow"), 429
anonymous (info, "in an hour"), image too large (error; the picture is removed, the text stays).

### 13.3 Copy

| Key | Hebrew | English |
|---|---|---|
| `bug.button` | אלפא · דיווח על תקלה | Alpha · Report a bug |
| `bug.buttonA11y` | דיווח על תקלה (גרסת אלפא) | Report a bug (alpha version) |
| `bug.hide` | הסתרה לעכשיו | Hide for now |
| `bug.show` | הצגת כפתור הדיווח | Show the report button |
| `bug.title` | דיווח על תקלה | Report a bug |
| `bug.intro` | מה קרה, ומה ציפיתם שיקרה? הדיווח מגיע לצוות הפיתוח בלבד, לא לגבאים. | What happened, and what did you expect? Your report goes to the development team only, not to the gabbaim. |
| `bug.text` | מה קרה? | What happened? |
| `bug.screenshot` | צילום המסך הזה | This screen |
| `bug.pick` | בחירת תמונה | Choose a picture |
| `bug.picNote` | בדקו שאין בו משהו שלא תרצו לשלוח. | Check it shows nothing you'd rather not send. |
| `bug.removePic` | הסרת התמונה | Remove the picture |
| `bug.autoTitle` | יצורף אוטומטית | Attached automatically |
| `bug.auto` | גרסה {version} · {platform} · מסך: {screen} · שפה: {lang} | Version {version} · {platform} · Screen: {screen} · Language: {lang} |
| `bug.autoKehila` | קהילה: {name} | Community: {name} |
| `bug.autoNot` | לא נשלחים תוכן הודעות, סיסמאות או פרטים של אנשים אחרים. | Not sent: message content, passwords or other people's details. |
| `bug.signedOut` | בלי חשבון אפשר לשלוח טקסט בלבד. | Without an account you can send text only. |
| `bug.send` | שליחה | Send |
| `bug.cancel` | ביטול | Cancel |
| `bug.discard` | לסגור בלי לשלוח? מה שכתבתם יימחק. | Close without sending? What you wrote will be lost. |
| `bug.discardYes` | סגירה בלי שליחה | Close without sending |
| `bug.sent` | תודה, הדיווח נשלח | Thanks, your report was sent |
| `bug.error` | הדיווח לא נשלח. בדקו את החיבור ונסו שוב. מה שכתבתם נשמר. | The report wasn't sent. Check your connection and try again. What you wrote is kept. |
| `bug.limitUser` | שלחתם הרבה דיווחים היום. אפשר לשלוח שוב מחר. | You've sent a lot of reports today. You can send again tomorrow. |
| `bug.limitAnon` | נשלחו הרבה דיווחים מהרשת הזאת. נסו שוב בעוד שעה. | Many reports came from this network. Try again in an hour. |
| `bug.tooBig` | התמונה גדולה מדי. נסו תמונה אחרת או שלחו בלי תמונה. | The picture is too large. Try another one or send without it. |

`{screen}` is a translated screen name (`bug.screens.<route>`, e.g. הודעות / Messages, כניסה / Sign in); the raw
route name is what is sent. Values in `bug.auto` (version, OS) are LTR inside isolates (§11.5).

### 13.4 Verification

Not screenshot-checked (no browser run on this machine). Check P19 at 390 in both directions and in dark mode, and
the 1440 placement in the admin console, before building. The screenshot mechanism per platform is the builder's.

## 14. Prayer schedule

Added 2026-10-27 for `docs/superpowers/specs/2026-10-27-prayer-schedule-design.md` (incl. §3a, two formats).
Frames: `P20.html` (gabbai editor, desktop and narrow), `P21.html` (Home), `P22.html` (full schedule and Print),
`P23.html` (sheet template "Classic two columns"), index section "ו". Kit-drawn like the P frames; the printed sheet
uses its own fixed palette. Styles: `shared.css`, block "§14 Prayer schedule". All names and the logo are invented
placeholders; times are illustrative (Petah Tikva, week of Vayera 5787), the shared calculation decides the real ones.

### 14.1 Terms the screens rely on

- **Schedule week** = Friday through the following Thursday: "שבת פרשת X" plus the Sun–Thu weekday times after it.
  This is what the Kehila's paper sheet means (its weekday column is for the coming week; it matters in DST-switch
  weeks). Editor, Home, full schedule and sheet all use it. Weeks are named by their parasha.
- **"This week only"** (override) is always marked three ways, never by colour alone: gold dashed outline or tag
  with words ("השבוע", "מוסתר השבוע", "נוספה לשבוע הזה"), the usual value shown struck or in words, and on paper
  an asterisk with the footnote "* שינוי לשבוע זה".
- **Next** = the next row in time across today's weekday rows and this week's Shabbat rows (text-only rows and
  candle lighting are never "next"; candle lighting has its own line).

### 14.2 Gabbai editor (P20)

**Entry:** Overview → card "זמני התפילות" (and on desktop a sidebar item when the console has one). Full-width
page, not capped at 680: the 680 cap is for member screens.

**Desktop (≥ 1024, designed at 1280–1440):**

| Part | Spec |
|---|---|
| Top band | `k.band`, 56 high: back "ניהול", title (serif 19), Kehila name. |
| Toolbar | `k.surface`, hairline under it. Week picker (prev / current ▾ / next, 44×44 arrows, current 300 min wide with `cal` icon), Tag "השבת הקרובה" when it is; at the end: unsaved count (8 px gold dot + "n שינויים שלא נשמרו"), secondary "ביטול השינויים", primary "שמירה", secondary "שיתוף ▾". Share is disabled while there are unsaved changes ("שומרים קודם, ואז משתפים"). |
| Editor column | flex 1, padding 20/24, scrolls. One **section card** per section (`Card` with `edgeColor`: gold Shabbat, tekhelet weekdays; later sections tekhelet): header 52 (grip, serif 19 name, Tag with row count, override count tag, rename `edit`, collapse `chev`). Collapsed header shows a one-line summary (Shabbat: candles and Shabbat end). |
| Row | grid `24 / 1fr / auto / 64 / 40`, min height 52: grip, label (bold) + note (12.5 muted), **formula pill** (28 high, radius 14, `sliders` icon + short summary, or `clock` "שעה קבועה", or "טקסט בלבד"), computed time (17 bold tabular, LTR isolate), `more` menu (rename, duplicate, move up/down, hide this week, delete). Selected: `k.stone` fill + 2 px tekhelet inset. Hidden this week: struck through + tag. Override rows: gold tag + faint hatching. |
| Add | under each section: "+ שורה", "+ שורת טקסט", "+ שורה לשבוע הזה בלבד" (gold). Under the last section: "+ מקטע" and the **"בגיליון השבוע"** card (mazal tov checklist, pinned image, candle-lighting cities, template). |
| Preview column | 600 wide, `k.surface`, hairline start border. Header: Segmented "טלפון / גיליון"; for sheet a second segmented "A4 / ריבוע לוואטסאפ"; for phone "בית / כל הזמנים" and a simulated "as if now" day + time. Body: the real component scaled to fit (sheet at ~0.86). The row in edit is highlighted in the preview (3 px tekhelet outline). Caption: draft vs saved. |

**Formula builder** (expands inline under the selected row; `k.stone` background):

1. Label (he) and label (en, optional) `Field`s side by side; note `Field` (optional).
2. "השעה": 3-way segmented **שעה קבועה / לפי זמן היום / בלי שעה** (fixed / formula / text-only).
3. Formula, read as a sentence, controls 44 high:
   **זמן ▾** (anchor) · **של איזה יום ▾** · **דקות** stepper (− n +) · **לפני / אחרי** · **עיגול ▾** (בלי / למטה /
   למעלה / לקרוב) + **ל־ ▾** (1 / 5 / 10 / 15; hidden for "בלי") · optional **לא לפני** / **לא אחרי** (Check + time).
   Offset is a number plus before/after, not a signed number: gabbaim say "15 לפני השקיעה", not "−15".
4. **Result box** (live): big time (34, tekhelet), the plain-language summary, the calculation step by step
   ("יום ה׳ 16:48 ← פחות 15 = 16:33 ← עיגול = 16:30"), and for earliest/latest the anchor for each of Sun–Thu with
   the chosen day outlined.
5. **Warnings** (info `Banner`, do not block saving, one-tap fix): a row that ends after shkia on any day although
   it is "before" shkia; Shabbat end or tzeit rounded down; candle lighting rounded up; a bound that wins every day
   ("the formula never applies").
6. **"שינוי לשבוע הזה בלבד"** box (gold dashed): Check; on → segmented "שעה אחרת / הסתרה השבוע", time, week note.
   Shows the usual value. Comes back by itself next week.
7. Footer: duplicate, delete (danger, inline confirm), hint line with keys, "סגירה".

**Anchor list** (grouped, each with its time on the chosen day, type-to-filter): בוקר: עלות השחר, משיכיר, הנץ החמה,
סוף זמן ק״ש מג״א, סוף זמן ק״ש גר״א, סוף זמן תפילה גר״א · צהריים: חצות היום, מנחה גדולה, מנחה קטנה, פלג המנחה ·
ערב: שקיעה, הדלקת נרות (n דק׳, Fridays), צאת הכוכבים, צאת השבת (Shabbat). Link at the end: Kehila zmanim settings.

**Day source per section:** Shabbat section: יום שישי / שבת. Weekday section: המוקדם בימים א׳–ה׳ / המאוחר בימים
א׳–ה׳ (with hints "טוב למנחה" / "טוב לערבית"). "The row's own day" appears only for single-day sections (holidays,
later).

**Saving:** explicit "שמירה" (not save-per-tap as in §12.2): a formula change moves times on every member's Home,
and a gabbai tries things. Preview shows the draft. Leaving with unsaved changes asks (the channel sheet's discard
pattern). Toast "זמני התפילות נשמרו".

**First time:** empty state card "עוד אין זמני תפילות" with "התחלה מהמבנה הקלאסי" (Shabbat + weekday rows with
common formulas, each marked "לבדיקה" until opened) or "התחלה מדף ריק".

**Narrow (< 1024, phone):** management band, segmented "עריכה / תצוגה", week picker, section cards with rows
(label, formula summary under it, time, chevron). Tapping a row opens the builder in a `Sheet` (same controls stacked,
result box, "ביטול / אישור"). Save and Share sit in a sticky footer ("שמירה · n").

**Share** menu (saved state): תמונה לוואטסאפ (1080×1080), תמונה A4 (PNG), PDF להדפסה, the pinned notice as a
separate image, copy link to the schedule. Desktop downloads; phone opens the system share sheet.

### 14.3 Member Home (P21)

Order: greeting, P7/P15 one-time cards, **schedule card**, **zmanim card (collapsible)**, phone list, latest.

- **Shabbat mode (Thursday 00:00 until one hour after Shabbat end, or after the last Shabbat row if later):**
  `Card edgeColor=gold`: overline "זמני התפילות" (12.5 bold muted), serif heading "שבת פרשת X", Hebrew date ·
  date; candle-lighting line (`flame` gold, the sheet's two cities, tabular); **next block** (2 px tekhelet border,
  radius 12: label "התפילה הבאה" 12.5 tekhelet bold, row name heading, countdown caption, time 28 tekhelet); up to 4
  following rows (40 high, hairline); link "לכל הזמנים" (48). On Thursday the next block can be today's weekday
  prayer ("התפילה הבאה · היום").
- **Weekday mode:** `edgeColor=tekhelet`, overline "זמני התפילות · היום", next block, up to 3 more of today, a line
  "שבת פרשת X · נרות ביום שישי {time}" (replaces the old "לקראת שבת" card), link. After the last row of the day:
  overline "· מחר", next = tomorrow's first, caption "מחר, יום ראשון" (no countdown).
- **Countdown:** minutes, updated each minute, only within 6 hours; "בעוד 40 דק׳", "בעוד שעה ו־5 דק׳", "בעוד
  שעתיים ו־51 דק׳", "בעוד 3 שעות ו־10 דק׳". Not a live region.
- **Overrides:** Tag "השבוע" after the row name; in the next block the caption says "השבוע בלבד · בדרך כלל 13:15".
- **Zmanim card:** `Card` with a pressable header (min 56): "זמני היום · {city}" bold, caption "הבא: {zman} {time}",
  `chev` 20 muted, rotates when open. Body: today's list unchanged. State remembered on the device; default closed;
  when the Kehila has no schedule it is open and the old "לקראת שבת" card stays.
- **States:** loading = quiet skeleton in the card; offline with a stored schedule = info Banner in the card
  ("נשמרו במכשיר ב־9:02"); error without one = error Banner + retry. Guests see the same card.

### 14.4 Full schedule and Print (P22)

- Back "בית", title "זמני התפילות" with a secondary **Button "הדפסה"** (`print` icon, auto width, 48) at the end of
  the title row; week switcher (current and next week only; 44×44 arrows; title "שבת פרשת X", dates, "השבוע").
- One section `Card` per section (same edges), header serif 19 + days caption. Rows: name, note line (12.5 muted),
  time (bold tabular, end). Text-only rows full width, 14 muted. Override: Tag "השבוע", usual time struck under the
  new one, the week note. Hidden rows: one muted line at the end "השבוע אין: …". Next row: 2 px tekhelet outline,
  caption "הבאה · בעוד …". Past rows today: muted. From Thursday Shabbat comes first; otherwise weekdays first.
- Footer caption: city and "עודכן בידי הגבאים ב־{date}".
- **Print (spec §3a), everyone who can see the schedule:** web (any browser) opens the print page in a new tab and
  calls the print dialog; the print page is exactly P23's A4 sheet (`@page { size: A4; margin: 0 }`, nothing else on
  the page). Phone app: Button busy ("מכין להדפסה") → PDF → system share sheet (print, WhatsApp, save). Prints the
  week on screen. Guests: mazal tov block omitted unless guests may see mazal tov (the gabbai's sheet ticks do not
  override this). Works offline from the stored schedule (template and logo are cached with it). Error: Banner +
  retry.

### 14.5 Sheet template "Classic two columns" (P23)

Recognisable to the Kehila (same order: Shabbat right, weekdays left, mazal tov and a notice picture below; big blue
"שבת פרשת **X**"; "name … time"), refreshed with the app's own marks.

| Part | A4 (595×842 pt) | Square (1080², drawn 540) |
|---|---|---|
| Frame | inner hairline at 12, padding 34/36/26 | hairline at 8, padding 22/24/16 |
| Header | logo slot 66×66 (start, `contain`, white), title serif 38 weight 500 with parasha 800, tekhelet; Hebrew + civil date 12.5; Kehila name 10 at the end | logo 44, title 28 |
| Tallit rule | double tekhelet line under the header (2 + 1 + 2) | same |
| Columns | `1fr 22 1fr`; spine = double line with three diamonds | same |
| Column head | serif 17 800 tekhelet; candle band (pale tekhelet, 12.5, times 15 bold) / weekday dates band | 14 |
| Row | 14.5, dotted leader, time 15 bold tabular; group gap 7; text row 12.5 centred muted; override time tekhelet + "*" | 12.5 / 13 |
| Bottom | pinned image under Shabbat (4:3, tekhelet border), mazal tov under weekdays (13, centred, family name 800 pomegranate, small icon per notice, dotted separators); ornament = line + three diamonds | no image (sent as a second picture); mazal tov in one band, shortened |
| Footer | "* שינוי לשבוע זה" · "שבת שלום ומבורך", 9.5 | same |

Fixed colours (paper never goes dark): paper `#FCFCF9`, ink `#151A33`, tekhelet `#2A3F94`, pale `#E7EBF6`, line
`#C3CADF`, pomegranate `#A32A47`. Fonts embedded: Noto Serif Hebrew, Heebo.

**Fitting:** never a second page and never a clipped row. Steps: mazal tov to 12 → pinned image down to 30% of
the height → row font down to 12.5 → editor Banner "הגיליון ארוך מעמוד אחד" with "hide rows" suggestions. No logo:
the Kehila initial in a tekhelet tile with tallit lines. No mazal tov: a verse from the parasha or an ornament;
no image: mazal tov spans both columns.

### 14.6 Accessibility and keyboard (editor)

- Sections are `list`s, rows `listitem`s with one tab stop each (roving focus). **↑/↓** move between rows, **Enter**
  opens the builder, **Esc** closes it and returns focus to the row, **Alt+↑/↓** moves the row (also in its `more`
  menu: "הזזה למעלה / למטה"; drag is never the only way), **Alt+Shift+↑/↓** moves a section, **Ctrl/⌘+S** saves,
  **Ctrl/⌘+Z** undoes the last change in the draft, **Delete** on a row asks to delete.
- Builder controls in sentence order. Selects are listboxes with type-ahead (Hebrew letters). Stepper: **↑/↓** ±1,
  **Shift+↑/↓** ±5, digits type. Time fields accept "830", "8:30", "08:30"; ↑/↓ ±5 minutes.
- The result box is a polite live region: after a change it announces "16:30. 15 דקות לפני השקיעה המוקדמת…".
  Warnings are part of it. The unsaved count is polite. Moving a row announces "מנחה הועברה למקום 5 מתוך 8".
- Grip has a label ("גרירה לשינוי הסדר"); preview is `aria-hidden` except the segmented controls (the editor
  holds the same data). Focus ring 2 px tekhelet on every control; all targets ≥ 44 on desktop, 48 on phone.
- Member side: next block reads "התפילה הבאה: מנחה וקבלת שבת, 16:45, בעוד שעה ו־5 דקות"; override rows read
  "השבוע בלבד, 12:45, בדרך כלל 13:15"; the zmanim header is a button with `aria-expanded`; Print is a button
  ("הדפסת זמני התפילות").

### 14.7 Components

Reused: `Card` (+`edgeColor`), `Txt`, `Button`, `Field`, `Segmented`, `Check`, `Tag`, `Banner`, `Sheet`, `Toast`,
`Icon`. New, and why:

- **`ScheduleCard`** (Home): the mode logic (Shabbat/weekday/tomorrow) and the next block belong together; used on
  Home and in the editor's phone preview.
- **`ScheduleRow`** (member): name/note/time/override/next/past in one row; used by ScheduleCard and P22.
- **`CollapsibleCard`** (kit): `Card` with a pressable header, `title`, `summary`, `open`, `onToggle`. Generic; Home
  zmanim first.
- **`FormulaBuilder`**, **`TimeField`**, **`Stepper`**, **`Select`** (listbox with groups and side values): the
  kit has no select or stepper today; the editor needs them and they are reusable.
- **`WeekPicker`**: prev / current ▾ / next with parasha names and DST/override markers; editor and (arrows only) P22.
- **`SheetClassic`**: the template; one component renders the editor preview, the print page, PNG and PDF.
- Icons to add to `Icon.tsx`: `grip`, `clock`, `share`, `image`, `eyeoff`, `copy`, `print`, `flame`, `minus`,
  `star`, `cal`, `sliders`, `more`, `edit`, `trash`, `down` (some exist in the frames' sprite only).

### 14.8 Copy

| Key | Hebrew | English |
|---|---|---|
| `schedule.title` | זמני התפילות | Prayer times |
| `schedule.today` | זמני התפילות · היום | Prayer times · today |
| `schedule.tomorrow` | זמני התפילות · מחר | Prayer times · tomorrow |
| `schedule.shabbatOf` | שבת פרשת {parasha} | Shabbat {parasha} |
| `schedule.candles` | הדלקת נרות | Candle lighting |
| `schedule.candlesFriday` | שבת פרשת {parasha} · נרות ביום שישי | Shabbat {parasha} · candles on Friday |
| `schedule.next` | התפילה הבאה | Next prayer |
| `schedule.nextToday` | התפילה הבאה · היום | Next prayer · today |
| `schedule.inMin` | בעוד {m} דק׳ | in {m} min |
| `schedule.inHour` | בעוד שעה ו־{m} דק׳ | in 1 h {m} min |
| `schedule.inTwoHours` | בעוד שעתיים ו־{m} דק׳ | in 2 h {m} min |
| `schedule.inHours` | בעוד {h} שעות ו־{m} דק׳ | in {h} h {m} min |
| `schedule.tomorrowDay` | מחר, {day} | Tomorrow, {day} |
| `schedule.full` | לכל הזמנים | Full schedule |
| `schedule.thisWeek` | השבוע | This week |
| `schedule.usually` | השבוע בלבד · בדרך כלל {time} | This week only · usually {time} |
| `schedule.notThisWeek` | השבוע אין: {list} | Not this week: {list} |
| `schedule.updated` | הזמנים מחושבים ל{city}. עודכן בידי הגבאים ב־{date}. | Times are for {city}. Updated by the gabbaim on {date}. |
| `schedule.print` | הדפסה | Print |
| `schedule.printA11y` | הדפסת זמני התפילות | Print the prayer times |
| `schedule.printing` | מכין להדפסה | Preparing to print |
| `schedule.printError` | לא הצלחנו להכין את הקובץ להדפסה. | We couldn't prepare the file for printing. |
| `schedule.offline` | זמני התפילות נשמרו במכשיר ב־{time}. אולי יש עדכון. | Prayer times saved on this device at {time}. There may be an update. |
| `schedule.error` | לא ניתן לטעון את זמני התפילות. | Couldn't load the prayer times. |
| `home.zmanimNext` | הבא: {zman} {time} | Next: {zman} {time} |
| `editor.title` | זמני התפילות | Prayer times |
| `editor.weekPrev` / `weekNext` | השבוע הקודם / השבוע הבא | Previous week / Next week |
| `editor.upcoming` | השבת הקרובה | This coming Shabbat |
| `editor.dstWeek` | מעבר שעון | Clock change |
| `editor.unsaved` | {n} שינויים שלא נשמרו | {n} unsaved changes |
| `editor.discard` | ביטול השינויים | Discard changes |
| `editor.save` | שמירה | Save |
| `editor.saved` | זמני התפילות נשמרו | Prayer times saved |
| `editor.share` | שיתוף | Share |
| `editor.shareSaveFirst` | שומרים קודם, ואז משתפים | Save first, then share |
| `editor.shareSquare` | תמונה לוואטסאפ | Image for WhatsApp |
| `editor.shareA4` | תמונה בגודל A4 | A4 image |
| `editor.sharePdf` | PDF להדפסה | PDF for printing |
| `editor.shareNotice` | ההודעה הנעוצה כתמונה נפרדת | The pinned notice as a separate image |
| `editor.addRow` / `addText` / `addWeek` / `addSection` | שורה / שורת טקסט / שורה לשבוע הזה בלבד / מקטע | Row / Text row / Row for this week only / Section |
| `editor.rowName` / `rowNameEn` / `rowNote` | שם השורה / שם באנגלית (לא חובה) / הערה (לא חובה) | Row name / English name (optional) / Note (optional) |
| `editor.kind` | השעה | Time |
| `editor.kindFixed` / `kindFormula` / `kindNone` | שעה קבועה / לפי זמן היום / בלי שעה | Fixed time / From a zman / No time |
| `editor.anchor` / `day` / `minutes` | זמן / של איזה יום / דקות | Zman / Which day / Minutes |
| `editor.before` / `after` | לפני / אחרי | before / after |
| `editor.round` / `roundTo` | עיגול / ל־ | Rounding / to |
| `editor.roundNone` / `Down` / `Up` / `Nearest` | בלי עיגול / למטה / למעלה / לקרוב | None / Down / Up / Nearest |
| `editor.notBefore` / `notAfter` | לא לפני / לא אחרי | Not before / Not after |
| `editor.dayFriday` / `dayShabbat` | יום שישי / שבת | Friday / Shabbat |
| `editor.dayEarliest` / `dayLatest` | המוקדם בימים א׳–ה׳ / המאוחר בימים א׳–ה׳ | Earliest Sun–Thu / Latest Sun–Thu |
| `editor.summary` | {n} דקות {before/after} {anchor}{day}, מעוגל {dir} ל־{step}{bounds}. | {n} minutes {before/after} {anchor}{day}, rounded {dir} to {step}{bounds}. |
| `editor.summaryExact` | בדיוק ב{anchor}{day}. | Exactly at {anchor}{day}. |
| `editor.weekOnly` | שינוי לשבוע הזה בלבד | Change for this week only |
| `editor.weekOnlyNote` | הנוסחה נשארת לשבועות האחרים. | The formula stays for other weeks. |
| `editor.weekOther` / `weekHide` | שעה אחרת / הסתרה השבוע | Different time / Hide this week |
| `editor.tagWeek` / `tagHidden` / `tagAdded` | השבוע · במקום {time} / מוסתר השבוע / נוספה לשבוע הזה | This week · instead of {time} / Hidden this week / Added this week |
| `editor.warnAfterSunset` | השעה אחרי השקיעה: {row} יוצאת {time}, והשקיעה ב{day} ב־{sunset}. | After sunset: {row} comes out at {time}, and sunset on {day} is {sunset}. |
| `editor.warnEarlyEnd` | מוקדם מצאת השבת: העיגול מקדים ל־{time} (במקום {exact}). | Before Shabbat ends: rounding moves it to {time} (instead of {exact}). |
| `editor.sheetTitle` | בגיליון השבוע | On this week's sheet |
| `editor.sheetGuestsHidden` | אורחים לא רואים מזל טוב בקהילה. בגיליון רק אם מסמנים. | Guests don't see mazal tov here. On the sheet only if ticked. |
| `editor.tooLong` | הגיליון ארוך מעמוד אחד. אפשר להסתיר שורות לשבוע הזה. | The sheet is longer than one page. You can hide rows for this week. |
| `editor.emptyTitle` | עוד אין זמני תפילות | No prayer times yet |
| `editor.startClassic` / `startBlank` | התחלה מהמבנה הקלאסי / התחלה מדף ריק | Start from the classic layout / Start blank |
| `sheet.changed` | * שינוי לשבוע זה | * Changed this week |
| `sheet.footer` | שבת שלום ומבורך | Shabbat shalom |

Zman names (he / en): עלות השחר / Dawn · משיכיר / Misheyakir · הנץ החמה / Sunrise · סוף זמן ק״ש (מג״א / גר״א) /
Latest Shema (MA / GRA) · סוף זמן תפילה (גר״א) / Latest Shacharit (GRA) · חצות היום / Midday · מנחה גדולה / Mincha
Gedola · מנחה קטנה / Mincha Ketana · פלג המנחה / Plag HaMincha · שקיעה / Sunset · הדלקת נרות / Candle lighting · צאת
הכוכבים / Nightfall · צאת השבת / Shabbat ends.

### 14.9 Open points for the spec owner

- **Week boundary** is not in the spec; this design assumes Friday→Thursday (the paper sheet's meaning). Confirm.
- **"Row's own day"** contradicts "one weekly time per row" for weekday rows; offered only for future single-day
  sections.
- **Draft vs live:** the spec doesn't say when edits reach members; this design uses explicit Save.
- **Countdown & Shabbat mode window** (Thursday 00:00 → Shabbat end + 1 h) are design choices to confirm.
- Not in the spec but drawn: halachic-direction warnings, "start from the classic layout", overflow rules.

### 14.10 Verification

Frames written by hand, not screenshot-checked (no browser run on this 2 GB machine). Check P20 at 1280 and 1440,
P21/P22 at 390 in light and dark, and P23 printed to PDF from a browser before building. Tag balance of the four new
frames was checked with a parser.

## 15. Seat release

Added 2026-10-27 for `docs/superpowers/specs/2026-10-27-seat-release-preview-design.md` (including "Two formats" and
"Running beside the old method"). Frames: `design/mockups/frames/P24.html` to `P27.html` (index section "ז").
Kit-drawn like the P frames; frame-only helper styles sit in each frame's `<style>` (nothing added to `shared.css`).
**P25 replaces M9** (M9 now carries a "replaced" note). All names and numbers are invented.

### 15.1 The hall layout (data)

The first Kehila's hall, shape only, from `~/work/gabay/design/mockups/phase2-seat-map.html`: 26 columns, rows 0–13,
five blocks `R` ימין (x 21, 5 wide), `CR` מרכז ימין (x 16, 4), `C` מרכז (x 11, 4; seats in rows 4, 10–12; bimah rows
6–8), `CL` מרכז שמאל (x 6, 4), `L` שמאל (x 0, 5); 205 seats. Shown to people as **row = index + 1** (1–14). **Seats
have no numbers anywhere people look** (owner: "they mean nothing, at least in our Kehila") — a seat id is internal only;
see §15.9. The ark is drawn above row 1. *P24–P27 still draw this 205-seat shape (P28–P30, §16, draw the real hall); the real hall (225 seats, 6 blocks,
ark at the front) is in the spec.*
Blocks are always listed right to left (ימין → שמאל), as they stand.

### 15.2 Home reminder card (P24)

*Redrawn 2026-10-28: the card, its one-tap "לא מגיעים השבת", the push actions and the audience (the male head of each member family, computed) are in §15.10.13. Timing and the Home order below still hold.*


- **Who / when:** seat holders for the coming Shabbat (א household heads with an allocation), from the gabbai's reminder
  time (default Thursday 12:00) to the deadline (default Friday 12:00). Nobody else ever sees it. *§21 (2026-10-28):
  opening Thursday 08:00, deadline Friday 14:00, the card stays in its final state until Shabbat ends, and a bottom row
  on Home reaches the form all week.*
- **Where (Home order):** greeting → test-build card (P15, owner's test build only) → **seat card** → the one P7
  one-time card → prayer schedule card (§14, P21) → zmanim. The seat card is outside the P7 queue (like P15) and comes
  before it because it has a deadline; it sits above the schedule card, which P21 already places under P7.
- **Component:** `Card edgeColor={k.tekhelet}`, the P7 pattern: title row (`Txt bold heading` + preview `Tag`), the
  question, a muted deadline line, primary `Button` "כן, כולם מגיעים" (one tap = no change, saves "all needed" for both
  prayers), secondary `Button` "עדכון מקומות" → seat page. The yes-answer is primary, as in P7.
- **Answered:** the card collapses to `Card edgeColor={k.olive}`: `Icon check` + title, a "תודה" line with the state,
  and a `klink`-style "שינוי" → seat page. It stays until the deadline, then disappears. If a gabbai (or the uploaded
  file) set the state, the line says "הגבאי עדכן…" instead.
- **Push** at the reminder time, same wording, generic (counts only, no names), `data: {kehila, screen: 'seats'}`,
  opens the seat page in that Kehila (switching Kehila if needed). Not sent to someone who already answered. After the
  deadline the tap opens the page in its closed state. Designed now, not sent in the preview.

### 15.3 Seat page, "part of the block" (P25)

- **Layout (top to bottom):** back, `ktitle` "מקומות בשבת" + preview `Tag`, Shabbat line, segmented control
  ערבית · ליל שבת / שחרית · שבת בבוקר, a words summary ("ערבית: 2 מגיעים · 1 פנוי לאחרים"), the block `Card`, legend.
  A fixed footer above the tabs holds the deadline line and primary "שמירה", so Save is always visible.
- **Block card:** heading "<block> · שורות a–b", then the **frame**: only the person's block, his row ±2 (clipped at
  the hall's edges), "↑ לכיוון ארון הקודש" inside it, row numbers on the start side (his row in bold tekhelet).
- **The member never sees the whole hall** (owner, binding): no mini-map, no other blocks, nothing beyond the cut.
  The full hall exists only on gabbai screens (P26, P27).
- **Seats in the frame:** blocks are 4–5 wide, so at 360 each seat tile is ~55×48 and is tapped directly (no separate
  list). **His seat, needed:** tekhelet fill, "✓ מגיע" (no seat number, §15.9). **His seat, released:** surface fill, 2 px
  **dashed** tekhelet border, "לא מגיע". **Others' seats:** plain `line`-grey tile, no name, no state, hidden from
  screen readers. Bimah rows (block C): one hatched "בימה" bar. Status is shape + word, never colour alone.
- **Per prayer:** the two prayers are independent; each starts as "everyone coming". No automatic copy between them.
- **Zoom:** the frame fits the width by default; pinch zooms (web: Ctrl + wheel / trackpad pinch). Note under the map:
  "אפשר להגדיל ולהקטין בשתי אצבעות."
- **Split seats — decision:** seats in the same block whose rows are at most 4 apart (their ±2 windows touch) share
  **one frame** spanning from the first row − 2 to the last row + 2. Otherwise (other block, or farther apart)
  **one frame per group**, each its own `Card` with its own heading, in block order right → left, stacked. One frame spanning distant rows would shrink seats below 48 and show
  many strangers' seats.
- **States:** saved (Toast "נשמר. תודה!" and a "נשמר ביום … " line); unsaved changes on back → discard confirm (channel
  sheet pattern); updated by a gabbai (info `Banner`, no gabbai name); after the deadline (Banner "הדיווח נסגר… לשינוי
  פנו לגבאי", tiles read-only at .75 opacity, no Save); **no allocation** (`Card` "עוד לא הוקצו לכם מקומות" / "את
  המקומות בבית הכנסת מקצה הגבאי. לשאלות פנו לגבאי."); Kehila without a hall map → a list, one row per seat with two
  `Chip`s מגיע / לא מגיע, each row "<block> · שורה r · מקום k מתוך n" (also the screen-reader-friendly fallback); loading (spinner); error (Banner + retry).
- **A11y:** each own seat is a `switch`, label "מרכז ימין, שורה 7, מקום 1 מתוך 3, מגיע" (k = the family's own order).
- **English:** texts flip; the hall itself does not mirror (it is the same room).

### 15.4 Preview label

The clickable preview (spec step 4) shows the card always (no timer) with fixture data, to everyone on the dev web app.
Marker: `Tag` variant **"תצוגה מקדימה" / "Preview"** with a 1 px **dashed ink** border and transparent fill, at the end
of the card's title row and next to the seat page title — dashed so it never reads as a real status. Seat tiles toggle
locally; "כן, כולם מגיעים" and "שמירה" show Toast "בקרוב. זו תצוגה מקדימה." "עדכון מקומות" really navigates.

### 15.5 Gabbai hall map print (P26)

- **What:** the whole hall for the coming Shabbat, one page per prayer ("שתיהן" = two pages), A4 landscape. Web: from
  GD5 "הדפסה" → options → browser print / Save as PDF. Phone: GM5 gets "מפת האולם (PDF)" → same options in a `Sheet` →
  PDF to the share sheet.
- **Options:** prayer chips (ערבית / שחרית / שתיהן), `Check` "להדפיס עם שמות" — **off by default and not remembered**
  (the print may be posted in the hall), primary print/PDF.
- **Page:** title "מפת מקומות · שבת פרשת X", Hebrew date, Kehila; the prayer large; "מצב ביום … · הדיווח נסגר / פתוח
  עד …" and "הודפס ב…". Ark bar above row 1, block names over the blocks, row numbers on both sides, bimah hatched.
- **Seat marks (shapes, in every style):** **תפוס** 1 px line; **שוחרר** 2 px line + diagonal stroke ("אפשר לשבת");
  **פנוי** (not allocated) 1.2 px dashed line. Fills by the chosen style (§15.9). Legend at the bottom, drawn in the same
  style. Fixed paper colours, never dark mode. No seat numbers.
- **Counts:** one strip under the map: total, then each block right → left: תפוס · שוחרר · פנוי.
- **With names:** surname only, 9.5 pt inside the seat; released seats show the name struck through.
- On screen (not on paper), tapping an allocated seat opens "עדכון בשם" (§15.6) for that household.

### 15.6 Running beside the old method (P27)

**On behalf of a household.** From the gabbai seat screen (web table, phone list) and the map. Opens a side panel
(web) / `Sheet` (phone) "עדכון בשם <household>" with the same segmented control, frame and tiles as P25, an info
Banner when past the deadline ("גבאי יכול לעדכן גם עכשיו"), the line "יירשם 'עודכן על ידי גבאי'…", primary "שמירה בשם
המשפחה". No deadline for gabbaim. Stored with source `gabbai`, gabbai id and time; gabbaim see who, the household sees
only "הגבאי עדכן" (P24 card, P25 banner).

**Source column** on the gabbai screen: באפליקציה / עודכן על ידי גבאי / מקובץ התשובות / לא ענו · כל המקומות שמורים,
with filter chips by source. (GD5's table gains this column and the row action "עדכון בשם".)

**Responses file (web only;** the phone says "העלאת קובץ תשובות: באתר בלבד"). Three steps shown as a step row:
1. *Upload:* drop zone (CSV / Excel) for this Shabbat + "הורדת תבנית (Excel)".
2. *Match:* rows matched by phone, then by name; matched rows in a collapsed list to confirm; unmatched rows one card
   each with a household search, or "לדלג על השורה".
3. *Preview:* "ישתנו X · Y בלי שינוי · Z דולגו"; households that also answered in the app are listed with two chips
   **האפליקציה** (default) / **הקובץ**; rows asking for more seats than allocated are errors and not applied. Primary
   "החלת השינויים".

After applying: success Banner at the top of the seat screen with "ביטול ההעלאה" (undo), available until Shabbat ends.
Undo restores every household the file changed, except ones that changed in the app since. A second upload for the same
Shabbat first undoes the first.

**Template — superseded by §16.6** (the real Form columns); kept for history:

| Column | Meaning |
|---|---|
| שם משק בית | as the gabbai writes it; matched to a household |
| טלפון | optional; matched first |
| ערבית | seats needed (0 … allocated); empty = no answer |
| שחרית | same |
| הערה | ignored by the import |

### 15.7 Copy

| Key | Hebrew | English |
|---|---|---|
| `seats.title` | מקומות בשבת | Shabbat seats |
| `seats.preview` | תצוגה מקדימה | Preview |
| `seats.previewToast` | בקרוב. זו תצוגה מקדימה. | Coming soon. This is a preview. |
| `seats.card.question` (one / other) | השבת יש לכם מקום אחד. אתם מגיעים? / השבת יש לכם {n} מקומות. כולם מגיעים? | This Shabbat you have one seat. Are you coming? / This Shabbat you have {n} seats. Is everyone coming? |
| `seats.card.deadline` | מקום שלא צריך אפשר לפנות לאחרים. אפשר לעדכן עד {day} {time}. | A seat you don't need can go to someone else. You can update until {day} {time}. |
| `seats.card.yes` (one / other) | כן, מגיעים / כן, כולם מגיעים | Yes, coming / Yes, everyone's coming |
| `seats.card.update` | עדכון מקומות | Update seats |
| `seats.card.doneAll` | תודה. כל {n} המקומות שמורים לכם השבת. | Thanks. All {n} seats are kept for you this Shabbat. |
| `seats.card.doneSome` | תודה. {prayer}: {need} מגיעים, {free} פנוי לאחרים. | Thanks. {prayer}: {need} coming, {free} free for others. |
| `seats.card.byGabbai` | הגבאי עדכן את המקומות שלכם. | A gabbai updated your seats. |
| `seats.card.change` | שינוי | Change |
| `seats.push.title` | מקומות בשבת | Shabbat seats |
| `seats.push.body` | השבת יש לכם {n} מקומות. כולם מגיעים? אפשר לעדכן עד {day} {time}. | You have {n} seats this Shabbat. Is everyone coming? You can update until {day} {time}. |
| `seats.arvit` / `seats.shacharit` | ערבית · ליל שבת / שחרית · שבת בבוקר | Arvit · Friday night / Shacharit · Shabbat morning |
| `seats.summary` | {prayer}: {need} מגיעים · {free} פנוי לאחרים | {prayer}: {need} coming · {free} free for others |
| `seats.block` | {block} · שורות {from}–{to} | {block} · rows {from}–{to} |
| `seats.toArk` | ↑ לכיוון ארון הקודש | ↑ Toward the ark |
| `seats.coming` / `seats.notComing` | מגיע / לא מגיע | Coming / Not coming |
| `seats.seatOrder` | מקום {k} מתוך {n} | Seat {k} of {n} |
| `seats.legendOthers` | מקומות של אחרים | Other people's seats |
| `seats.zoom` | אפשר להגדיל ולהקטין בשתי אצבעות. | Pinch to zoom in and out. |
| `seats.split` | המקומות שלכם בשני מקומות באולם. | Your seats are in two places in the hall. |
| `seats.deadline` | אפשר לעדכן עד {day} {time} | You can update until {day} {time} |
| `seats.save` / `seats.saved` | שמירה / נשמר. תודה! | Save / Saved. Thanks! |
| `seats.closed` | הדיווח נסגר ב{day} {time}. לשינוי פנו לגבאי. | Updates closed {day} {time}. To change, ask a gabbai. |
| `seats.byGabbai` | הגבאי עדכן את המקומות שלכם ב{day} {time}. אפשר לשנות עד המועד האחרון. | A gabbai updated your seats on {day} {time}. You can change them until the deadline. |
| `seats.noneTitle` | עוד לא הוקצו לכם מקומות | You don't have seats yet |
| `seats.noneBody` | את המקומות בבית הכנסת מקצה הגבאי. לשאלות פנו לגבאי. | Seats are allocated by the gabbai. For questions, ask a gabbai. |
| `seats.a11ySeat` | {block}, שורה {row}, מקום {k} מתוך {n}, {state} | {block}, row {row}, seat {k} of {n}, {state} |
| `seats.print.*` | מפת מקומות · תפוס · שוחרר · אפשר לשבת · פנוי · לא מוקצה · להדפיס עם שמות · ההדפסה נתלית לפעמים בבית הכנסת. בלי שמות רואים רק תפוס, שוחרר ופנוי. | Seat map · Taken · Released · free to sit · Free · not allocated · Print with names · Prints are sometimes posted in the hall. Without names it shows only taken, released and free. |
| `seats.print.style*` | סגנון · ירוק לפנוי · ירוק ואדום · שחור־לבן · נשמר במכשיר הזה. הצורות נשארות בכל סגנון, גם במדפסת שחור־לבן. | Style · Green for free · Green and red · Black and white · Remembered on this device. The shapes stay in every style, even on a black-and-white printer. |
| `seats.print.legendTail*` | ירוק = אפשר לשבת · ירוק = אפשר לשבת · אדום = תפוס · צורות בלבד | Green = free to sit · Green = free to sit · Red = taken · Shapes only |
| `seats.gabbai.*` | עדכון בשם {household} · שמירה בשם המשפחה · עודכן על ידי גבאי · מקובץ התשובות · באפליקציה · לא ענו · העלאת קובץ תשובות · הורדת תבנית · לדלג על השורה · החלת השינויים · ביטול ההעלאה | Update for {household} · Save for the household · Updated by a gabbai · From the responses file · In the app · No answer · Upload responses file · Download template · Skip this row · Apply changes · Undo upload |

Block names: ימין / מרכז ימין / מרכז / מרכז שמאל / שמאל — Right / Center right / Center / Center left / Left.

### 15.8 Verification

Frames generated by a small script, not screenshot-checked (no browser run on this 2 GB machine); tag balance checked
with a parser, and the hall layout counts 205 seats. Check P24/P25 at 390 in both directions and dark mode, P26
printed to PDF (A4 landscape) in all three styles, once through a greyscale photocopy, and P27 at 1280 before building. Confirm the ark side and seat
numbering (§15.1) and the file template (§15.6) with the owner.

### 15.9 Print styles and no seat numbers (P26, P25)

Owner, 2026-10-27 (spec, end). **Seat numbers are internal ids.** Never on the print, never "כיסא n" to members. A
member's seat is its position in the frame; where text is needed (list fallback, screen reader, P27 panel) it is "מקום
k מתוך n" — k is the family's own order (the sheet's "<family>-1/-2…": block right → left, row front → back, then right
→ left in the row). P25/P27 tiles carry only the state ("✓ מגיע" / "לא מגיע").

**Style selector.** In the print options (web panel from GD5, phone `Sheet` from GM5), after the prayer chips: label
"סגנון", kit `Segmented` with three options **ירוק לפנוי** (default) / **ירוק ואדום** / **שחור־לבן**, a three-swatch
mini legend in the chosen style, and the hint "נשמר במכשיר הזה…". Stored per device (`localStorage`
`kehilot.seatPrintStyle` = `green` | `greenRed` | `bw`); names stay off and unremembered. The page sets
`print-color-adjust: exact` so browsers print the fills.

**Colours (fills; lines, diagonal and names always `#000000`):**

| State | ירוק לפנוי | ירוק ואדום | שחור־לבן | Shape (every style) |
|---|---|---|---|---|
| תפוס | `#EBEBEB` light grey | `#DB5B56` red | `#C8C8C8` grey | 1 px line |
| שוחרר | `#9ED8AA` light green | `#9ED8AA` | `#FFFFFF` | 2 px line + diagonal |
| פנוי | `#57B46C` green | `#57B46C` | `#FFFFFF` | 1.2 px dashed line |

- **Contrast, black name text on the fill** (with-names print, 9.5 pt): `#EBEBEB` 17.6:1, `#9ED8AA` 12.9:1, `#57B46C`
  8.2:1, `#DB5B56` 5.6:1, `#C8C8C8` 12.6:1 — all above 4.5:1. Fills are never the only boundary: every seat keeps its
  black line, so pale fills on white paper still read.
- **Greyscale photocopy (L\*):** ירוק לפנוי 93 / 81 / 66 (taken / released / free); ירוק ואדום 55 / 81 / 66; שחור־לבן
  81 / 100 / 100. Colour fills are at least 11 L\* apart, so a copy keeps three tones. **Released vs free** share a hue
  on purpose (both mean "you can sit here") and stay apart by tone (light vs mid green, 15 L\*) and by shape: released
  has the heavy line and diagonal, free a dashed line and no diagonal — which is all B/W and colour-blind readers need
  (red vs green is 11 L\* apart for deuteranopes, plus the shapes).
- **Legend per style:** the same three swatches drawn with the style's fills and shapes — "תפוס", "שוחרר · אפשר לשבת",
  "פנוי · לא מוקצה" — then at the end "ירוק = אפשר לשבת" (green), "ירוק = אפשר לשבת · אדום = תפוס" (green / red) or
  "צורות בלבד" (B/W), and "בלי שמות" / "עם שמות". The page title area does not repeat the style.
- P26 shows the default at 62% and the three styles side by side at 40%, plus a colour table panel. Not checked on paper.
- **Fourth state, pending (ממתין):** a family seat with no answer yet. It has its own fill and a black corner notch, see §16.12.4.

### 15.10 שחרור מקומות — טופס חבר, גרסה גרפית (P37–P39)

Added 2026-10-28 at the owner's request; revised the same day after his review (chair, colours, number circles,
answers to the open questions). Each week the member gets a push, "fill in the seats form". In the old Google Form he
typed how many seats he frees; the aisle seat stays with the head of the family, so seats are freed from the far side.
On the phone he wants the same form, but graphical: very simple, and a bit cool. Frames: `P37` (the screen, how the
map fits, sync rules, wizard versus one screen, entry), `P38` (states), `P39` (special event, **future**, and a 1280
view). They are drawn on the real hall's shape (6 blocks, rows קדמית + 1–13, bimah) and use only kit parts plus the
frame-only helpers in each frame's `<style>`. Nothing is added to `shared.css`. Names are invented.

**Relation to P25.** This becomes the member's seat screen and replaces P25's layout. P25's rules all still hold: his
block only, his row(s) ±2, no whole hall and no mini-map, others' seats nameless, no seat numbers, the split-seats rule
of §15.3, gabbai updates and the closed state. What is new: the compact map, the synagogue-chair glyph, red/green
upholstery, the aisle lane, the number circles, one Send for both prayers, and no tab bar.

#### 15.10.1 Wizard or one screen — recommendation: one screen

- **A · Wizard** (P37 panel): 1 ליל שבת → 2 שבת בבוקר → 3 summary and Send. One question per screen, big and plain.
  But the common case (the same answer for both prayers) takes 4 taps over 3 screens, and the map is drawn twice.
- **B · One screen (chosen)**: a two-part segment ליל שבת / שבת בבוקר, each part showing its own state; one map that
  follows the selected part; the number circles under it; and in the second part a **"כמו בליל שבת"** shortcut. The
  footer button leads you through: **"הבא: שבת בבוקר ‹"** until both parts are answered, then **"שליחה"**. So the
  second prayer can't be forgotten, without a wizard. Not coming at all = N · "כמו בליל שבת" · שליחה (3 taps). The P24
  card's "כן, כולם מגיעים" stays one tap for both prayers.

#### 15.10.2 Screen layout (P37, phone 390)

A stack screen opened from the push or the Home card. There is **no tab bar**, which saves 64 px. From top to bottom:

1. **Header** (56): back `›` at the start, `Txt` serif 19 "טופס מקומות לשבת", and under it in muted 12.5 "שבת פרשת X ·
   date".
2. **Prayer segments** (`Segmented`, 52 high per option): two lines in each option, the name (15 bold) and a state line
   (12) with an 8 px dot. An empty ring means "עוד לא ענית"; a filled dot means answered ("1 פנוי", "לא מגיעים",
   "כולם מגיעים"). The selected option has a surface fill, a tekhelet border and tekhelet text.
3. **Map card** (§15.10.3), collapsible.
4. In the second part only, a `Chip` with `Icon copy`: **"כמו בליל שבת · {state}"**. It copies the first part's count
   and seats. It is never applied automatically (P25 rule).
5. **Number circles** (§15.10.4): the question "כמה מקומות אתם מפנים בליל שבת?" (serif 17), circles 0…N, the end
   captions "0 = כולנו מגיעים" / "N = לא מגיעים", and one muted hint line.
6. **Fixed footer** (surface, top divider): a summary pill per prayer ("ליל שבת: 2 מגיעים · 1 פנוי"; the current one
   outlined in tekhelet), the primary button, and the deadline caption. Before anything is answered the button is
   disabled, and its caption says "עונים על שתי התפילות ושולחים…".

**Fit check at 390 × 844:** header 56, segments 60, map about 240 open (one row of his) or 60 folded, circles about 120,
footer 116. With one row of his it all fits on one screen; with two full rows (P38 ד) it still fits.

#### 15.10.3 The compact map (the owner's space concern)

- **His row(s) full size, the ±2 rows as tiny chairs.** Rows with his seats draw chairs **56 high** with the word
  under them (74 per row). The other rows in the window show the same glyph at **16 high** in grey, with no state, no
  touch, and hidden from screen readers. They are there to show where you are, not to read.
- **The ark marker** sits at the top: a small pill with `Icon ark` and "ארון הקודש", on a thin line across the width.
  When rows between the ark and the window are hidden, a muted "• • •" shows the gap. The ark is never inside the
  window: the window is still only his block and his rows ±2.
- **Aisle lane:** a vertical lane 18 wide with a dashed centre line and "מעבר" on the block's aisle side (both sides
  for a middle block). The hall is drawn as the room (LTR), as in P25, so the lane's side is the real side. This is
  what makes "from the far side" visible.
- **Row labels** at the start side, 34 wide: his row bold tekhelet 13, the others muted 11.5. Labels are the gabbai's
  own (קדמית, 1–13; CTO ruling 2).
- **Card header:** `Icon seat` and "{block} · שורה {r} · {n} מקומות" ("שורות 3–4" for two rows), and at the end a
  44-high text button **"הסתרה ⌃" / "הצגת המפה ⌄"**. Folded, the card shows **only his seats** as a strip of 38 × 44
  chairs (icon only, each with an accessibility label), in the same left-to-right order, plus the count ("1 פנוי"). The
  choice is remembered per device (`localStorage` `kehilot.seatMapCollapsed`). It is open on the first visit.
- **Seat size:** on a 5-wide block at 390, a cell is about 50 × 74; at 360 it is 44 × 74. A 2-wide block is capped at 72
  wide. Pinch zoom (P25) stays, but it isn't needed any more.

**The seat glyph: a synagogue chair** (owner, 2026-10-28; drawn from a photo he sent, as an original simplified glyph,
not traced). A front view in a 50 × 62 viewBox: two tall solid **wooden side panels** flaring slightly to **sled
feet**, a tall straight wooden back with an **upholstered back panel**, **wooden armrests**, an **upholstered seat
cushion**, a wooden stretcher below, and a small **padded book-rest** on top of the back (for the row behind). Build it
as one `react-native-svg` component, `SeatChair {state, icon, size}`, with each part its own shape. **The wood always
stays wood** (light `#B87A43` / shade `#8C5A2E` / line `#6B4321`; dark `#A86E3B` / `#7A4D27` / `#4A2E14`). **Only the
upholstery (book-rest, back panel, cushion) carries the state.** A 19 px icon sits on the back panel, and the word sits
under the chair (12, 800).

**Seat states (colour + icon + word + outline; colour is never the only signal):**

| State | Upholstery | Outline | Icon on the back · word under it | Light | Dark |
|---|---|---|---|---|---|
| **מגיע · תפוס** (kept) | **red** `#B8322E` / dark `#F0857F` | thin wood line, solid | `user` (someone sits here) · "מגיע" in red | icon `#FFFFFF` on red 5.9:1; word on stone 5.5:1 | icon `#10132A` on red 7.3:1; word 7.3:1 |
| **פנוי** (freed) | **green** `#9ED8AA` / dark `#6FC283` | 1.8 px **dashed** `#256B35` / `#8FD49C` on every upholstered part | `check` · "פנוי" in a dashed 6-radius box | icon `#1B4D27` on green 6.0:1; word 6.0:1 | icon `#0C2414` 7.6:1; word 10.5:1 |
| others' | grey glyph (the wood in `line` grey too) | surface seams | none, hidden from screen readers | — | — |
| read-only | as above | as above | `lock` replaces the icon | — | — |

Red and green are far apart in lightness (relative luminance 0.13 against 0.59), so they stay apart for colour-blind
readers and in greyscale, and the icon, word and dashed outline still say it. **Red = occupied everywhere** (owner),
the same as the print's "ירוק ואדום" style. Tekhelet stays the UI accent only (segments, selected circle, buttons).
**Use the same glyph elsewhere (not redrawn yet):** in the P26 print legend, and inside the print's seat boxes if it
stays readable at 32 × 24 (the line, diagonal, notch and dashed shapes of §15.9 / §16.12.4 stay on top). On the P24
Home card it would replace `Icon seat` in the title. Both are to be done when P24 and P26 are next redrawn.

**Motion ("cool", but quiet):** when a seat changes, it flips (scaleX 1 → 0 → 1, 150 ms) and the new upholstery colour
rises from the bottom, with a light haptic tick (`selection`). With reduce motion turned on, only the colour changes.

#### 15.10.4 Number circles and the map, always in sync (owner: like the old Excel form)

- **Question:** "כמה מקומות אתם מפנים {בליל שבת}?". It is followed by **one row of circles, 0…N**, where N = the
  family's seats on the gabbai's map (usually 2–4, at most 7). It is a `radiogroup`, and 0 sits at the start (right).
- **Size:** for N ≤ 5, 52 px circles with 12 gaps. For N = 6–7, 44 px circles spread over the full width: 8 × 44 = 352
  fits in 358 at 390. Each circle's touch target is at least 44.
- **Looks:** idle = surface with a `line` ring and the number at 18–20 / 800. Selected = tekhelet fill, on-colour
  number, 3 px halo. **The N circle is drawn as "all free":** a dashed green ring and a green number, and when selected
  a solid green fill. The end captions say **"0 = כולנו מגיעים"** and **"N = לא מגיעים"**. So "not coming" is simply the
  last circle. **The separate answer cards are dropped:** 0 is everyone coming, N is not coming.
- **Tap a number k:** k seats are freed automatically: first in the **rear row**, and in each row **from the far side
  of the aisle**. The rest are "מגיע". The map updates with the flip.
- **Tap a chair:** it toggles מגיע ↔ פנוי, and the selected circle moves to the number now free. If those chairs aren't
  the automatic order (P37 phone 4: the aisle chair freed), **the circle stays selected and the map stays as tapped**,
  with the hint "בחרתם כיסאות במפה. המספר מתעדכן לפיהם." (`Icon seat`). Tapping a number again goes back to the
  automatic order.
- **Hint line** under the circles: nothing chosen → "נוגעים במספר, או בכיסאות במפה."; 0 → "כל N המקומות שמורים לכם.";
  1…N−1 → "מפנים מהקצה הרחוק מהמעבר. אפשר גם לגעת בכיסא." (big family: "קודם מהשורה שמאחור, מהקצה הרחוק מהמעבר.");
  N → "לא מגיעים: כל N המקומות פנויים לאחרים."
- **A family with one seat:** two circles, 0 and 1.
- **"The aisle" in data:** the seat map knows aisle cells and block edges from the editor (§16: empty columns between
  blocks are aisles, and the hall's outer edges are walls). A seat's aisle distance = the number of seats between it and
  the nearest aisle in its row. **Automatic order:** rear row first, then the rows in front; within a row, the largest
  aisle distance first. The head's seat (the front row's aisle seat) is freed last. **In a middle block with aisles on
  both sides** (owner, 2026-10-28), "the aisle" is the one **closer to the bimah (תיבה)**: the head's seat is the
  family's seat next to that aisle, and automatic freeing starts from the side farthest from it. This also applies when a gabbai or
  the Form upload enters a count (it refines CTO ruling 4 from "−n first" to this order).

#### 15.10.5 Special event — future, not in this phase (P39)

**Owner: leave it as a gap.** P39 is marked "עתידי / לא בשלב זה" and kept as an unpolished sketch: for a festival or
the Megillah, the question flips to "כמה מקומות תצטרכו?", and all seats start free. It still uses the old answer cards
and stepper, and it won't be built now. Still open: whether there is an event form at all, which events get one, and
what happens to an unanswered family's seats. The 1280 view on the same page is valid for the Shabbat form.

#### 15.10.6 States (P38)

- **No answer = occupied (owner).** On a regular Shabbat, a family that doesn't send keeps **all its seats occupied**:
  freeing is voluntary. Until the deadline the print (P26) shows them as "ממתין"; after it, as "תפוס". After the
  deadline the member sees an info `Banner` "לא שלחתם השבת. כל המקומות נשמרו לכם. לשינוי פנו לגבאי." over the folded
  strip, all red (P38 panel).
- **א · נשלח:** the same stack screen. A 76 px olive check circle, "נשלח. תודה!" (serif 21), the line "המקומות שפיניתם
  יחכו למי שצריך. הגבאי רואה אותם במפה שלו.", then a `Card` with a row per prayer: state in words and the folded chair
  strip. Then "אפשר לשנות עד {day} {time}." and `Button`s **חזרה לבית** (primary) and **שינוי** (secondary, back to the
  form). The Home card (P24) turns olive "answered" as before. P26 now draws those seats as **שוחרר**.
- **ב · כבר עניתם (edit):** the form opens filled in, with a success `Banner` "שלחתם ביום {day} ב־{time}. אפשר לשנות
  עד …". The button is **"שליחת השינויים"**, disabled until something changes (caption "אין שינויים לשלוח"). If a gabbai
  set the state, an info `Banner` "הגבאי עדכן את המקומות שלכם ב{day} {time}." replaces it (§15.6), without a name.
- **ג · אחרי המועד:** an info `Banner` "הטופס נסגר ביום {day} ב־{time}. לשינוי פנו לגבאי." This is **text only, with no
  contact button** (owner). The segments still switch (to view only), the chairs show `lock`, the circles are dimmed
  with the sent number still selected and the hint "זה מה ששלחתם.", and there is no footer.
- **ד · משפחה גדולה (replaces "seats in two places", owner):** the rare real case is a whole row plus extra chairs in
  the row behind. **Both rows are drawn full size in one card** ("ימין · שורות 3–4 · 7 מקומות"), with ±2 rows around
  them. Circles 0…7. The automatic order frees **the rear row first, far from the aisle**, and only then the main row.
  §15.3's split rule (separate cards for distant groups) stays in the data model but gets no special frame.
- **ה · אין מקומות:** `Card` (tekhelet edge) "עוד לא הוקצו לכם מקומות" / "את המקומות בבית הכנסת מקצה הגבאי. לשאלות פנו
  לגבאי." / muted "כשיהיו לכם מקומות, הטופס יגיע אליכם כל שבוע בהתראה." No push and no Home card. It is reached only
  from "אני".
- **Loading / error:** as in P25 (a spinner in the map card; an error `Banner` with "נסו שוב"). **Kehila without a hall
  map:** the circles alone, with no map.

#### 15.10.7 Wide screen (P39, 1280)

The same content in a 1040 column: the title and Shabbat line at the start, the segments (420 wide) at the end of the
title row. Two equal columns under it: the **map card first (start side)** with 74-high chairs, always open; the circles
beside it; the summary and a 200-wide Send under them. Keyboard: arrows move between his chairs and Space toggles one;
in the circles, arrows move and Space picks.

#### 15.10.8 Entry and ties

- **Push** (§15.2, new copy): title **"טופס מקומות לשבת"**, body "יש לכם {n} מקומות בשבת פרשת X. מי מגיע? אפשר לענות
  עד {day} {time}." `data: {kehila, screen: 'seats'}` → this screen.
- **Home card P24:** the title becomes "טופס מקומות לשבת", the question is unchanged, and the secondary button becomes
  **"למלא את הטופס"**. "כן, כולם מגיעים" still answers both prayers in one tap (= 0 for both). P24's frame isn't
  redrawn; P37's panel shows the new copy.
- **Gabbai print P26 / on-behalf P27:** the result lands as before. Freed = שוחרר; no answer = ממתין until the deadline,
  then תפוס (§16.12.4).

#### 15.10.9 Accessibility

- Each own chair is a `switch`: "{block}, שורה {row}, מקום {k} מתוך {n}, ליד המעבר / {state}". The words "ליד המעבר"
  appear only for the head's seat. Context chairs and others' chairs are hidden.
- The circles are a `radiogroup`. Their names are "אף מקום, כולנו מגיעים", "{k} מקומות", and "{N}, לא מגיעים". The hint
  line is a polite live region. The segments are `tab`s whose names include the state ("ליל שבת, נענה, 1 פנוי").
- Targets: chair cells at least 44 × 74, circles at least 44, chips 48, the fold button 44.
- English: the text flips; the hall does not mirror (§15.3).

#### 15.10.10 Copy

| Key | Hebrew | English |
|---|---|---|
| `seats.form.title` | טופס מקומות לשבת | Shabbat seats form |
| `seats.form.count` | כמה מקומות אתם מפנים {בליל שבת / בשבת בבוקר}? | How many seats are you freeing {on Friday night / on Shabbat morning}? |
| `seats.form.count0` / `countAll` | 0 = כולנו מגיעים / {n} = לא מגיעים | 0 = we're all coming / {n} = not coming |
| `seats.form.hint.none` | נוגעים במספר, או בכיסאות במפה. | Tap a number, or the chairs on the map. |
| `seats.form.hint.zero` | כל {n} המקומות שמורים לכם. | All {n} seats are kept for you. |
| `seats.form.hint.some` / `someRear` | מפנים מהקצה הרחוק מהמעבר. אפשר גם לגעת בכיסא. / קודם מהשורה שמאחור, מהקצה הרחוק מהמעבר. | Freed from the far side of the aisle. You can also tap a chair. / Rear row first, from the far side of the aisle. |
| `seats.form.hint.all` | לא מגיעים: כל {n} המקומות פנויים לאחרים. | Not coming: all {n} seats are free for others. |
| `seats.form.hint.custom` | בחרתם כיסאות במפה. המספר מתעדכן לפיהם. | You picked chairs on the map. The number follows them. |
| `seats.form.hint.sent` | זה מה ששלחתם. | This is what you sent. |
| `seats.form.same` | כמו בליל שבת · {state} | Same as Friday night · {state} |
| `seats.form.unanswered` | עוד לא ענית | Not answered yet |
| `seats.form.next` / `send` / `sendChanges` | הבא: {prayer} ‹ / שליחה / שליחת השינויים | Next: {prayer} / Send / Send changes |
| `seats.form.foot` | אפשר לשלוח ולשנות עד {day} {time} | You can send and change until {day} {time} |
| `seats.form.sent` / `sentBody` | נשלח. תודה! / המקומות שפיניתם יחכו למי שצריך. הגבאי רואה אותם במפה שלו. | Sent. Thanks! / The seats you freed will wait for whoever needs them. The gabbai sees them on his map. |
| `seats.form.answered` | שלחתם ביום {day} ב־{time}. אפשר לשנות עד {day2} {time2}. | You sent this on {day} at {time}. You can change it until {day2} {time2}. |
| `seats.form.closed` | הטופס נסגר ביום {day} ב־{time}. לשינוי פנו לגבאי. | The form closed on {day} at {time}. To change it, ask a gabbai. |
| `seats.form.notSent` | לא שלחתם השבת. כל המקומות נשמרו לכם. לשינוי פנו לגבאי. | You didn't send this week. All your seats were kept. To change it, ask a gabbai. |
| `seats.form.hide` / `show` | הסתרה / הצגת המפה | Hide / Show map |
| `seats.form.ark` / `aisle` | ארון הקודש / מעבר | Ark / Aisle |
| `seats.form.kept` / `free` / `others` | מגיע · תפוס / פנוי לאחרים / של אחרים | Coming · taken / Free for others / Other people's |
| `seats.form.homeOpen` | למלא את הטופס | Fill in the form |
| `seats.form.noSeatsLater` | כשיהיו לכם מקומות, הטופס יגיע אליכם כל שבוע בהתראה. | When you have seats, the form will reach you every week by notification. |

#### 15.10.11 Owner decisions and what is still open

Decided (2026-10-28): synagogue chair, not a cinema seat · red = occupied, green = freed · no answer on Shabbat =
occupied · big family in two rows replaces "seats in two places" · rear row first, far from the aisle · number circles
0…N as in the old form · no "contact the gabbai" button after the deadline · special events left for later.

Still open:
1. **Special events** (P39, future): whether to have them, which events, the question wording, and the default for
   families that don't answer.
2. ~~Middle block with aisles on both sides~~ — **decided (owner, 2026-10-28):** the head's seat is the aisle seat
   **closer to the bimah (תיבה)**, see §15.10.4.

**Owner, 2026-10-29:** after "שליחה" succeeds the seat screen closes by itself and returns to Home, with the Toast
"נשמר" (the Home card/row then shows the new state). A failed send keeps the screen open with the error.

#### 15.10.13 One tap "לא מגיעים השבת" from Home and the push (P24, redrawn)

Owner, 2026-10-28: a real one-click. **"לא מגיעים השבת" frees all the family's seats for both ליל שבת and שבת בבוקר
at once.** Every other answer still goes through the form (P37). P24 is redrawn with the new card, the push and the
audience note. It replaces the older P24 card described in §15.2, which keeps its timing and its place in the Home order.

**Who gets it (rule).** *Superseded by §21.5 (owner, 2026-10-28): all the family's men, or its adult women when it has
no man; the push becomes the two scheduled reminders.* The card and the push go **only to the male head of each member family**: one person per
family. In this Kehila being a member means holding seats, so the audience is worked out from the family records.
There is no distribution list, and nothing for the gabbai to manage. Women, other adults in the family and guests
don't get them. For a family without an account, the gabbai answers on its behalf (P27). (P24 panel "למי זה הולך".)

**Card (Home, Thursday 08:00 → the deadline; §21.1, was 12:00):** `Card` with a tekhelet edge. The title row has the chair glyph and
"טופס מקומות לשבת". The question is "יש לכם {n} מקומות השבת. מגיעים?", and the muted line is "ליל שבת ושבת בבוקר · אפשר
לענות עד יום שישי 14:00" (§21.1: default deadline Friday 14:00, was 12:00). **The buttons are all one family** (owner: the main action must not look like a link):
- **"לא מגיעים השבת"** is the **primary** `Button`: full width, **56 high**, 17 bold, tekhelet fill. At the start is the **"going away"
  icon**: an original mini illustration in the figure-set palette (§17.13), 50 × 28 (viewBox 60 × 34). It shows a
  mustard car (`#E2A93B`) in side view with the trunk lid open and a green suitcase (`#5E8A3A`), an adult in teal
  (`#2E8C86`) with a brown package (`#A85A2A`), and a child in pomegranate (`#C0475F`), all with dark outlines
  (`#3A2A1A`). It keeps its colours in dark mode, and a 1.2 px white halo separates it from the tekhelet button. It
  replaces the freed chair and `Icon out` (owner: "a family with bags getting into a car"). Checked at button size in
  light and dark (`P24-btn-*.png`). It is the action most members need each week.
- Under it, two **secondary** `Button`s side by side (48 high, outlined tekhelet): **"כולם מגיעים"** (`Icon users`; = 0
  for both prayers, also one tap) and **"חלק מגיעים"** (`Icon seat`; opens P37).

No text links on the card. The P37 entry panel shows the same card. Inside the form (P37) there is no link-style
action: the circles, the "כמו בליל שבת" chip and the footer `Button` are already controls, and "הסתרה / הצגת המפה" is a
view toggle, not an answer.

**Confirm or undo → undo, 5 seconds, no extra screen.** Tapping "לא מגיעים השבת" changes the card in place right away:
the edge turns green, the folded strip shows all chairs green, with the line "פינית את כל {n} המקומות · ליל שבת ושבת
בבוקר". A dark inline bar says "נשלח בעוד {s} שניות…" with **"ביטול"** (44 high), and a 4 px green progress line runs
along the bottom of the card. The answer is sent when the 5 seconds end. "ביטול" puts the card back as it was. If the
app is closed during the 5 seconds, the answer is still sent. A confirm dialog would make it two taps, so undo is
better here.

**Card after sending** (olive edge, check): green strip and **"פינית את כל {n} המקומות לשבת"** / "ליל שבת ושבת בבוקר ·
תודה!", then `Button`s **"ביטול"** and **"עריכה ‹"**, and "אפשר לשנות עד …". "ביטול" deletes the answer, which goes
back to "no answer" = occupied, shows the Toast "התשובה בוטלה. כל המקומות שמורים לכם.", and brings the card back to
asking. "עריכה" opens P37 with N chosen for both prayers. Other answered states: "תודה. כל {n} המקומות שמורים לכם."
(red strip), the two-prayer summary, and "הגבאי עדכן…", each with "עריכה ‹". ~~The card disappears at the deadline.~~
§21.3: after the deadline it stays in a final state until Shabbat ends.

**Push** (to the same list, at the reminder time): title "טופס מקומות לשבת", body "יש לכם {n} מקומות בשבת פרשת X.
מגיעים? אפשר לענות עד שישי {time}."
- **Where notification actions exist** (Android, iOS long-press, Chrome web push): two actions, **"לא מגיעים השבת"**
  (iOS: destructive style, red) and **"למלא את הטופס"**. "לא מגיעים השבת" sends in the background without opening the
  app, then replaces the notification with **"פינית את כל {n} המקומות לשבת"** / "ליל שבת ושבת בבוקר. תודה! טעות? אפשר
  לבטל עד שישי {time}." with the actions **"ביטול"** and **"עריכה"**. That notification is the undo.
- **Where they don't** (for example Safari web push): tapping opens P37 with **N already chosen in both prayers** and an
  info `Banner` "לא מגיעים השבת? זה מוכן, רק לשלוח. מגיעים? בחרו מספר אחר." Nothing is sent without "שליחה".
- Tapping the body opens P37 as before. An action used after the deadline is not sent; a notification says "הטופס נסגר.
  לשינוי פנו לגבאי." The push is generic (counts only, no names) and isn't sent to someone who already answered.

| Key | Hebrew | English |
|---|---|---|
| `seats.card.q` | יש לכם {n} מקומות השבת. מגיעים? | You have {n} seats this Shabbat. Coming? |
| `seats.card.both` | ליל שבת ושבת בבוקר · אפשר לענות עד {day} {time} | Friday night and Shabbat morning · Answer by {day} {time} |
| `seats.card.allComing` / `notComing` | כולם מגיעים / לא מגיעים השבת | Everyone's coming / Not coming this Shabbat |
| `seats.card.some` | חלק מגיעים | Some are coming |
| `seats.card.undoIn` / `undo` | נשלח בעוד {s} שניות… / ביטול | Sending in {s} seconds… / Undo |
| `seats.card.freedAll` | פינית את כל {n} המקומות לשבת | You freed all {n} seats for Shabbat |
| `seats.card.undone` | התשובה בוטלה. כל המקומות שמורים לכם. | Answer cancelled. All your seats are kept. |
| `seats.card.edit` | עריכה | Edit |
| `seats.push.freedBody` | ליל שבת ושבת בבוקר. תודה! טעות? אפשר לבטל עד {day} {time}. | Friday night and Shabbat morning. Thanks! Mistake? You can undo until {day} {time}. |
| `seats.push.actNotComing` / `actForm` | לא מגיעים השבת / למלא את הטופס | Not coming this Shabbat / Fill in the form |
| `seats.form.preNotComing` | לא מגיעים השבת? זה מוכן, רק לשלוח. מגיעים? בחרו מספר אחר. | Not coming this Shabbat? It's ready, just send. Coming? Pick another number. |

**A member family with no male head** (for example a widow) — **ברירת מחדל — לאישור** (CTO default, the owner may
revise it): the woman who heads the family gets the card and the push and answers herself. The gabbai can still answer
on her behalf (P27). The frames follow the rule as given.

#### 15.10.12 Verification

P37–P39 were generated by a script and rendered with headless Chromium (Playwright 1.47.2): each phone at 390 × 844 in
light and dark, P37's and P24's panels, P24's three phones, and P39's 1280 view, saved to `/tmp/claude-1000/kehilot-shots-seats/`. No horizontal
scroll at a 390 viewport, and the 8 circles for N = 7 fit on one line. Contrast was computed (table above). Not checked:
a real device, the 360 width, the flip animation (not drawn), the glyph at print size, English, and screen readers.

## 16. Seating editor

Added 2026-10-27 for the seat spec's "Per-Kehila hall layout and households without accounts", "The real workbook" and
"Running beside the old method". Frames: `P28` (paste → check → match), `P29` (grid editing, assignments, effective
date, history, conflicts, phone view), `P30` (link on registration, holders without an account), `P27` refreshed for the
real Form columns (index section "ז"). Frames are generated from the spec's hall shape (225 seats, 6 blocks, bimah 4×3,
ark at the front); every family name is invented (בדיוני, דוגמה, ניסיון…). Frame-only helper styles sit in each frame's
`<style>`; nothing added to `shared.css`.

**Where:** web only, desktop-first (designed at 1440; usable from 1024). Entry: management sidebar / Overview card
"מפת המקומות", and from GD5 "עריכת המפה". Full-width page like P20 (`edk`: band 56, toolbar, body). **Phone: view
only** — the whole hall with pinch zoom (names appear when zoomed in), a "משפחות" list with counts, Banner "עריכה
באתר בלבד". Gabbaim only; members never reach this (§15.3: the member API returns only his block ±2).

### 16.1 Terms

| Term | Meaning |
|---|---|
| Cell | One grid position: **seat**, **aisle**, **bimah**, **ark** or **empty**. Bimah and ark are one merged cell of any size. |
| Block | A named rectangle of columns (auto-detected from empty columns; listed right → left as they stand). |
| Row label | Text per row, taken from the paste's number column (the real sheet: an unnumbered front row "ק" = קדמית, then 1–13). Editable. *Differs from §15.1's 1–14; the gabbai's own labels win.* |
| Household | A registered family (app account) **or a seat holder without an account** (gabbai-created: name, optional phone). Both hold seats, appear on the map, can be released on behalf, and are matched by the responses upload. |
| Count | A household's seats = the number of its cells. Seat ids are internal; never shown. |
| Version | A saved map with an **effective date** (a Shabbat). Past Shabbatot keep the version they had. |

### 16.2 Start (P28 frame 1)

Empty state: title "מפת המקומות של בית הכנסת" and two cards.
- **הדבקה מגיליון** (`Card edgeColor=tekhelet`, tag "מומלץ"): three numbered steps (open the Map tab · Ctrl/⌘+A,
  Ctrl/⌘+C · come back and Ctrl/⌘+V), a 150-high dashed **paste target** (focusable button; paste works anywhere on the
  page), and the cell grammar in one line. "Nothing is saved or linked until you confirm."
- **בנייה מאפס**: rows × columns `Field`s (default 14 × 29 when nothing else is known), "יצירת רשת ריקה". The grid
  opens in Layout mode (§16.4).

**Parsing (what the editor does with a paste):**
1. Read the clipboard's **HTML** flavour first (keeps merged cells: the bimah arrives as one 4×3 cell); fall back to
   tab-separated text (a lone "בימה" then grows into the empty rectangle around it, flagged for checking).
2. A cell is a **seat** if it matches `<family>[ <initial>.]-<n>` — also the bidi-flipped `<n>-` order the sheet shows —
   or is exactly `פנוי`. `בימה` = bimah. Blank = aisle/empty. A column of plain numbers next to the grid = row labels.
   Everything else (title, date, totals) is **ignored and listed** ("לא נקרא").
3. Household key = family + initial ("בדיוני" and "בדיוני ש." are two keys). `n` is only the family's order; a gap or
   duplicate is a **warning**, never a stop.
4. Quirks: two names in one cell ("דמה / אלמוני") → a matching decision; two grids in the paste (ערב שבת / יום שבת) →
   choose which is the map (ownership is one map; per-prayer state comes from releases), differing cells listed.
   Nothing found → error Banner ("no seat cells; maybe the Form Responses tab? that goes to P27").
5. Ark: not in the sheet → placed at the front, centred, labelled "ארון הקודש ?" until the gabbai confirms/moves it.

### 16.3 Check and match (P28 frames 2–3)

**Step row** (4 steps, `aria-current="step"`): הדבקה · בדיקת המפה · התאמת משפחות · שמירה.

**Check:** the hall at "fit" (≈30 px cells, shapes only), legend (seat / פנוי / bimah / לבדיקה = 2 px gold border).
Hover or focus a cell → the original cell text. Side panel 420: totals (seats, households, free, blocks, rows, bimah),
gold warnings Banner with "הצגה" (jumps and focuses the cell), ark note, **block names** (one `Field` per detected block,
right → left, placeholder "שם הגוש"), "לא נקרא (n)" disclosure. Primary "המשך להתאמת n משפחות".

**Match:** every distinct household key gets a decision. Nothing is linked silently — not even exact matches.
- Filter chips: הכול · להחלטה · התאמה מלאה · הצעות · לא נמצאו · לבדיקה; search.
- **Exact matches** (one registered household with the same surname and the head's first initial) sit in an olive
  Banner: "הצגת ה־n" (expands the rows) and **"אישור n ההתאמות"** — one deliberate act after seeing them.
- Table rows (min 52): **בגיליון** (the pasted text in a mono chip) · **מקומות** (count) · **איפה** (blocks · rows) ·
  **הצעה** (radio options with a 12.5 "why" line) · **החלטה** (אישור / אחר…; decided rows dim with an olive "אושר"
  tag and "שינוי").
- Suggestion rules: spelling variants (full/defective spelling, final א/ה, "משפחת" prefix, spaces, geresh), initial =
  first letter of the head's (or spouse's) first name; registered households that already hold seats rank lower.
  Several candidates → radios, none preselected unless one is clearly better.
- **Not found** → default radio "מחזיק מקום חדש בלי חשבון" with name (prefilled "משפחת <family>") and optional phone,
  or "קישור למשפחה רשומה…" (search). Same-surname siblings ("בדיוני" vs "בדיוני ש.") ask "same family?" — default
  separate. Two-names cell → "the seat of A / of B / mark פנוי".
- Side panel: the selected row's seats lit on a mini hall, the candidate's card (role, since, masked phone), "why".
- Toolbar: "נשארו n מתוך N להחלטה" (polite live region), "שמירה כטיוטה", primary **"שמירת המפה"** disabled until n = 0
  (`aria-disabled` + the count as its description). Saving goes through the save dialog (§16.5) with an effective date.

### 16.4 Editing (P29)

**Toolbar:** Segmented **שיבוץ משפחות / מבנה האולם** · effective-date button (gold outline, `cal`, "בתוקף מ־ שבת פרשת X ▾")
· "היסטוריה" · undo / redo (40×40) · zoom ("התאמה למסך", 100%, 150%) · unsaved count (gold dot) · "ביטול השינויים" ·
primary "שמירה". Band shows "גרסה n · נשמרה …".

**Canvas:** the hall drawn LTR as the room (never mirrored, also in English), ark bar at the top, block names over the
blocks (selected household's block in tekhelet), row labels both sides. Cells at 100%: 62×38, radius 7/4, 12.5 text:
- seat of a household: surface + 1 px muted line + surname[ initial];
- **פנוי**: 1.5 px dashed muted line + "פנוי";
- selected household: tekhelet fill, "✓ name", bold;
- picked (drag selection): 2 px dashed tekhelet outline;
- changed since last save: 7 px gold dot in the start corner;
- bimah / ark: merged, hatched / outlined, serif label. Aisle: faint vertical hatch, only in Layout mode.
At "fit" cells show shapes only; names on hover/focus and in the side panel. Wide halls scroll horizontally; the side
panel's mini hall shows the viewport rectangle.

**Assign mode** (default):
- Pick a household (side list or click one of its seats). Click a **free** seat → assign to it; click **its** seat →
  פנוי; click **another household's** seat → dialog "המקום של X" (move to the selected household / mark פנוי). No seat
  changes hands without that question.
- Drag-select (or Shift+arrows) → floating dark bar: "n מקומות נבחרו · שיוך ל־<selected> · שיוך ל… · סימון פנוי ·
  ביטול הבחירה".
- **Move a family**: "העברת המשפחה…" → pick k seats; old seats show dashed + struck through until "אישור ההעברה".
- Side panel 360: search, chips הכול · בלי מקום · בלי חשבון, household rows (count bubble 30, name, blocks; dashed bubble
  for 0; "בלי חשבון" tag = 1 px dashed gold), the selected household's card (registered/no account, count "(היו n)",
  pasted name, "העברת המשפחה…", "פינוי כל המקומות"), totals, mini hall.
- Counts only. No seat numbers anywhere (owner: they mean nothing). Where a seat must be named in text: "<block> · שורה
  <label> · מקום k מתוך n" (k = the family's own order, §15.9).

**Layout mode:** same grid, no names; palette מושב · מעבר · בימה · ארון · ריק (keys S/A/B/K/Delete); "+ שורה מקדימה /
מאחור", "+ עמודה", "הגדרת גוש…" (name a selected rectangle), "שם לשורה…". Turning an occupied seat into anything else
warns with the households that lose a seat.

### 16.5 Effective date, history, concurrency

- **Save dialog:** a one-line diff ("3 שינויים: …"), **"בתוקף מ־"** select of Shabbatot, optional version note, Save.
  Default = the first Shabbat **not yet open for release**. Picking a Shabbat that is open: info line "n households
  already answered; their counts move to the new seats in order". Past Shabbatot are never changed.
- **History** panel: versions newest first ("גרסה n · בתוקף מ־ … · when · who · n changes"; the draft on top).
  Opening one is read-only with a band "בתוקף מ… עד…"; "שחזור" creates a new version from it with its own date.
  Nothing is deleted. A scheduled future version shows a Banner on the editor ("יש גרסה מתוכננת מ־…").
- **Concurrency:** the save sends the version it started from. If newer exists → dialog (gold edge, `alert`): "<name>
  (גבאי) saved at 19:42, after you opened the map"; counts (theirs / yours / overlapping). Actions: primary **"החלת
  השינויים שלי על הגרסה החדשה"** (non-conflicting changes apply; overlapping cells listed for choice), "הצגת השינויים
  שלו/ה", danger-outline "שמירה בכל זאת (דריסה)" with a second confirm. Never a silent overwrite. Gabbai names are
  fine here (gabbai-only screen).
- Leaving with unsaved changes → the discard confirm (channel-sheet pattern). Drafts autosave locally per device.

### 16.6 Responses upload — the real Form (P27 refresh)

Replaces the provisional template in §15.6. The file is the Form's **responses tab** (CSV/XLSX; the whole tab is fine).
- **Step 1 Upload:** Segmented **"התשובות הן ל־" שבת <parasha> / חג / מגילה** (which columns count), drop zone, "הורדת
  תבנית (Excel)" = the same columns as the Form.
- **Step 2 Columns:** recognised by keywords; one confirm, remembered per Kehila:

| Form column (meaning) | Becomes |
|---|---|
| חותמת זמן | answer time; only answers since the last Shabbat ended count; the latest per household wins |
| שם | household (matched) |
| ערב שבת · seats I won't need | ערבית · **released** count |
| יום שבת · seats I won't need | שחרית · released count |
| חג · how many will be free | the חג event's released count |
| מגילה · how many will be free | the מגילה event's released count |
| נשים · בית הכנסת, גברים · אולם, נשים · אולם | **reservation requests** (counted areas, no map) |

  The Form asks what is **not** needed: the import stores released counts, applied to the household's seats in its own
  order (as the sheet does).
- **Step 3 Match:** by phone if present, then name (same rules as §16.3), **including holders without an account**
  (tag "בלי חשבון"). Duplicates: latest kept, earlier struck through. Older rows: "n older rows not read". A row that
  releases seats must match a household that holds seats; a **request-only** row may be matched or created as a holder
  without an account.
- **Step 4 Preview:** "ישתנו n (m בלי חשבון) · בלי שינוי · דולגו · שגיאות"; errors (released > held) are not applied;
  app-vs-file conflicts with chips **האפליקציה** (default) / **הקובץ**; a requests table per area (count, households).
  Primary "החלת השינויים".
- **Undo** until the Shabbat/event ends: restores every household the file changed (registered or not), removes its
  requests; holders created by the upload stay (delete in P30). App changes made since are kept. A second upload for the
  same event first undoes the first.

### 16.7 Holders without an account and linking (P30)

- **List** (editor tab "בלי חשבון · n"): table — household · phone (or —) · count · created (הדבקה / ידני / קובץ
  תשובות, date) · link suggestion · actions. `more`: edit name/phone · link to a registered household… · show on map ·
  delete record (seats return to פנוי; also used for a deletion request). "מחזיק מקום חדש" button.
- **Suggestions** appear when a registering/registered household matches: **same phone** (strong) or **surname + head
  initial** (weak, labelled "בלי טלפון להשוואה"). Shown in: the approval card (GM2/GD2, phone and web — a single
  decision, so allowed on phone), the Overview, and an info Banner in this tab ("n הצעות קישור").
- **Link panel:** both cards side by side (no account → registered), a "מה יקרה" Banner (seats move from now, including
  an open Shabbat since the count doesn't change; on-behalf/file answers stay; the holder record closes; history says
  "קושר"; the head gets a Home card), primary **"קישור והעברת המקומות"**, secondary "זו לא אותה משפחה" (hides that
  suggestion for good). Automatic only when certain and only on a gabbai's approval of the member (a unique match: the same adult's own surname + first initial, or phone + surname; no other row or person in the Kehila with that surname) — then a card "שובצו אוטומטית" with "ביטול" for 14 days; anything weaker stays a suggestion for the gabbai to confirm.
- Registered household already holds seats → choose "add (n+m)" or "link and free the holder's seats".
- After linking: olive Banner with "ביטול" (also from History); the member gets a one-time P7-queue card "המקומות שלכם
  בבית הכנסת" → seat page (no gabbai name).
- Privacy: holder records are personal data — gabbai-only, in deletion on request, never in pushes or logs. Phone shown
  masked except in this list and the link panel.

### 16.8 Components

Reused: `Card`, `Txt`, `Button`, `Field`, `Segmented`, `Tag`, `Banner`, `Sheet`, `Toast`, `Icon`, `Chip` (filter),
P20's `edk` page shell, P27's `ksrc`/step row. New:
- **`HallGrid`** — renders a layout (cells, merged bimah/ark, blocks, row labels) at a zoom, in modes `assign` /
  `layout` / `fit` / `readonly`; roving-focus grid; selection model (single, rectangle, Shift+arrows). Used by P28, P29,
  phone view, and later by P26 print and P25's cut (one renderer for the room).
- **`HouseholdList`** — searchable listbox with count bubble, tags, chips.
- **`MatchTable`** — rows with radio candidates, reasons and decision; bulk-confirm Banner.
- **`SelectionBar`** — floating actions for the current selection.
- **`EffectiveDatePicker`** — Shabbat select (parasha + Hebrew date), marks open-for-release and scheduled ones.
- **`VersionList`**, **`ConflictDialog`** (reusable for any versioned editor, incl. P20's 409).
- **`StepRow`** — shared by P28 and P27.
- Icons to add: `paste`, `undo`, `redo`, `hist`, `move`, `useradd`, `alert`, `zoom`, `link`, `chair`.

Sizes: band 56 · toolbar controls 40 (desktop) · side panel 360 (assign) / 420 (check, link) · cells 62×38 at 100%,
~30 at fit · household rows 52 · table rows ≥ 52 · count bubble 30 · paste target 150 high · focus ring 2 px tekhelet.
Desktop targets ≥ 40 with 44 hit area; phone 48.

### 16.9 Accessibility and keyboard

- The hall is a `grid` (`role="grid"`, rows = hall rows, `aria-rowindex` with the row label as row header, blocks as
  column-group labels). One tab stop; **arrows** move by cell (skipping nothing — aisles are focusable in Layout mode
  only), **Home/End** row start/end, **PgUp/PgDn** front/back of the block.
- Cell name: "ימין, שורה 3, בדיוני ש., מקום 2 מתוך 3" / "…, פנוי" / "בימה". Changed cells add ", שונה". Hidden from no
  one (gabbai screen), unlike P25's others' seats.
- **Space** toggles the cell in the selection; **Shift+arrows** extends a rectangle; **Enter** applies the primary
  action (assign to the selected household / free if its own); **Delete** = mark פנוי (Layout: empty); **M** move
  family; **Esc** clears selection, closes popovers, returns focus. Layout keys **S/A/B/K**.
- **Ctrl/⌘+Z / Ctrl/⌘+Shift+Z** undo/redo, **Ctrl/⌘+S** save (opens the dialog), **Ctrl/⌘+F** or **/** household
  search, **Ctrl/⌘+V** paste (start screen), **+ / −** zoom, **0** fit.
- Matching: rows are a list with roving focus; **↑/↓** row, **Enter** confirm the selected candidate, **1–9** choose a
  candidate, **N** new holder, **/** search.
- Live regions (polite): unsaved count, "נשארו n להחלטה", results of actions ("2 מקומות שויכו למשפחת דוגמה י.,
  עכשיו 5"). Dialogs trap focus and return it to the cell.
- Drag is never the only way (Shift+arrows, "העברת המשפחה…", menu actions). Status never by colour alone: dashed =
  free, ✓ + fill = selected household, gold dot + text "שונה" = unsaved, gold border + list = warning.
- English: texts flip, the hall does not.

### 16.10 Copy

| Key | Hebrew | English |
|---|---|---|
| `seatmap.title` | מפת המקומות | Seat map |
| `seatmap.empty` | עוד אין מפה לקהילה. אפשר להדביק את הטבלה שכבר יש לכם, או לבנות את האולם מאפס. | No seat map yet. Paste the chart you already have, or build the hall from scratch. |
| `seatmap.paste` / `.pasteHint` | הדבקה מגיליון / מדביקים כאן את כל הלשונית. כותרות, מספרי שורות ותאים ריקים לא מפריעים. | Paste from a sheet / Paste the whole tab here. Titles, row numbers and empty cells are fine. |
| `seatmap.pasteSteps` | פותחים את הגיליון בלשונית של המפה · בוחרים הכול ומעתיקים · חוזרים לכאן ומדביקים | Open the sheet at the map tab · Select all and copy · Come back and paste |
| `seatmap.grammar` | משפחה-1 או משפחה ש.-2 = מקום של המשפחה · פנוי = מקום בלי משפחה · בימה · תא ריק = מעבר | Family-1 or Family S.-2 = the family's seat · פנוי = free · בימה = bimah · empty = aisle |
| `seatmap.noLink` | שום דבר לא נשמר ושום משפחה לא מקושרת לפני שתאשרו. | Nothing is saved or linked until you confirm. |
| `seatmap.scratch` / `.createGrid` | בנייה מאפס / יצירת רשת ריקה | Build from scratch / Create empty grid |
| `seatmap.steps` | הדבקה · בדיקת המפה · התאמת משפחות · שמירה | Paste · Check the map · Match families · Save |
| `seatmap.found` | מה נמצא · מקומות · משפחות · פנויים · גושים · שורות · בימה | Found · seats · families · free · blocks · rows · bimah |
| `seatmap.checkWarn` | {n} תאים לבדיקה | {n} cells to check |
| `seatmap.gap` | "{family}-{k}" חסר. אולי חסר מקום? | "{family}-{k}" is missing. A seat missing? |
| `seatmap.twoNames` | שני שמות בתא אחד. בהתאמה תבחרו של מי המקום. | Two names in one cell. You'll choose whose seat it is when matching. |
| `seatmap.arkGuess` | ארון הקודש לא מופיע בגיליון. שמנו אותו מקדימה, באמצע. | The ark isn't in the sheet. We placed it at the front, centred. |
| `seatmap.notRead` | לא נקרא ({n}) | Not read ({n}) |
| `seatmap.nothing` | לא מצאנו מקומות בהדבקה | We found no seats in what you pasted |
| `seatmap.twoGrids` | נמצאו שתי מפות בלשונית. איזו מהן היא מפת המקומות? | Two maps in this tab. Which one is the seat map? |
| `seatmap.match.intro` | כל שם בגיליון צריך להיות משויך למשפחה בקהילה: משפחה רשומה, או מחזיק מקום בלי חשבון. שום דבר לא מקושר בלי אישור שלכם. | Every name in the sheet needs a household: a registered family, or a seat holder without an account. Nothing is linked without you. |
| `seatmap.match.exact` | {n} שמות תואמים בדיוק למשפחה אחת רשומה. עברו על הרשימה ואשרו אותם יחד. / אישור {n} ההתאמות | {n} names match exactly one registered family. Review and confirm them together. / Confirm {n} matches |
| `seatmap.match.left` | נשארו {n} מתוך {total} להחלטה | {n} of {total} left to decide |
| `seatmap.match.new` | מחזיק מקום חדש בלי חשבון | New seat holder without an account |
| `seatmap.match.link` | קישור למשפחה רשומה… | Link to a registered family… |
| `seatmap.match.same` | אותה משפחה: {household} / משפחה אחרת | Same family: {household} / A different family |
| `seatmap.saveDraft` / `.saveMap` | שמירה כטיוטה / שמירת המפה | Save draft / Save map |
| `seatmap.mode` | שיבוץ משפחות / מבנה האולם | Assign families / Hall layout |
| `seatmap.effective` | בתוקף מ־ {shabbat} | Effective from {shabbat} |
| `seatmap.selection` | {n} מקומות נבחרו · שיוך ל־{household} · שיוך ל… · סימון פנוי · ביטול הבחירה | {n} seats selected · Assign to {household} · Assign to… · Mark free · Clear |
| `seatmap.othersSeat` | המקום של "{household}" · להעביר ל־{selected} · לפנות | "{household}"'s seat · Move to {selected} · Free it |
| `seatmap.move` / `.moveConfirm` | העברת המשפחה… / אישור ההעברה | Move family… / Confirm move |
| `seatmap.freeAll` | פינוי כל המקומות | Free all seats |
| `seatmap.count` | {n} מקומות / מקום אחד / בלי מקום | {n} seats / One seat / No seat |
| `seatmap.noAccount` | בלי חשבון | No account |
| `seatmap.layoutTypes` | מושב · מעבר · בימה · ארון · ריק | Seat · Aisle · Bimah · Ark · Empty |
| `seatmap.occupiedWarn` | {n} מהתאים שבחרתם תפוסים. {households} יאבדו מקום. המשך? | {n} selected cells are taken. {households} will lose a seat. Continue? |
| `seatmap.saveDlg` | שמירת המפה · בתוקף מ־ · השבתות שכבר עברו נשארות כמו שהיו. · הערה לגרסה (לא חובה) | Save map · Effective from · Past Shabbatot stay as they were. · Version note (optional) |
| `seatmap.openShabbat` | {n} משפחות כבר ענו לשבת הזו. הספירה שלהן תעבור למקומות החדשים לפי הסדר. | {n} households already answered for this Shabbat. Their counts move to the new seats in order. |
| `seatmap.conflict` | יש גרסה חדשה יותר · {name} שמר/ה את המפה ב־{time}, אחרי שפתחתם אותה. | A newer version exists · {name} saved the map at {time}, after you opened it. |
| `seatmap.conflictActions` | החלת השינויים שלי על הגרסה החדשה · הצגת השינויים · שמירה בכל זאת (דריסה) | Apply my changes to the new version · Show their changes · Save anyway (overwrite) |
| `seatmap.history` | היסטוריה · גרסה {n} · בתוקף מ־{from} עד {to} · שחזור | History · Version {n} · Effective {from} to {to} · Restore |
| `seatmap.webOnly` | עריכת המפה באתר בלבד. | The map is edited on the website only. |
| `seatmap.holders` | מחזיקי מקומות בלי חשבון · מחזיק מקום חדש | Seat holders without an account · New seat holder |
| `seatmap.linkSuggest` | אולי זו "{holder}" מהמפה? אותו טלפון. / אותו שם משפחה ואות ראשונה. | Could this be "{holder}" from the map? Same phone. / Same surname and initial. |
| `seatmap.linkWhat` | מה יקרה · המקומות יעברו ל־{household} מהיום · דיווחים שכבר נעשו בשמם נשארים · הרשומה בלי חשבון תיסגר | What happens · The seats move to {household} from today · Answers already given for them stay · The no-account record closes |
| `seatmap.link` / `.notThem` | קישור והעברת המקומות / זו לא אותה משפחה | Link and move seats / Not the same family |
| `seatmap.linked` | קושר. המקומות עברו ל־{household}. ביטול | Linked. The seats moved to {household}. Undo |
| `seatmap.memberCard` | המקומות שלכם בבית הכנסת · הגבאי חיבר לחשבון שלכם {n} מקומות. מעכשיו אפשר לעדכן כאן אם מגיעים בשבת. · למקומות שלי | Your seats in the synagogue · A gabbai connected {n} seats to your account. You can now tell us here if you're coming. · My seats |
| `seats.upload.event` | התשובות הן ל־ · שבת {parasha} · חג · מגילה | These answers are for · Shabbat {parasha} · Holiday · Megillah |
| `seats.upload.columns` | זיהינו את העמודות. בדקו פעם אחת; נזכור לפעם הבאה. | We recognised the columns. Check once; we'll remember. |
| `seats.upload.released` | בטופס עונים כמה מקומות לא צריכים. זה מספר המשוחררים. | The Form asks how many seats aren't needed. That's the released count. |
| `seats.upload.window` | {n} שורות מהשבוע. {old} שורות ישנות יותר לא נקראו. | {n} rows from this week. {old} older rows weren't read. |
| `seats.upload.requests` | בקשות לשמירת מקומות · נשים · בית הכנסת · גברים · אולם · נשים · אולם | Seat requests · Women · synagogue · Men · hall · Women · hall |
| `seats.upload.requestOnly` | שורה עם בקשה בלבד אפשר לשייך למשפחה חדשה בלי חשבון. | A request-only row can go to a new household without an account. |

Block names in the frames (ימין, מרכז ימין, מרכז, מרכז שמאל, שמאל, ליד הקיר) are placeholders until the Kehila names
them in the editor.

### 16.11 Open points for the spec owner

1. **Block names** for the 6 real blocks (the 2-column far-left block is "ליד הקיר" in the frames).
2. **Row labels**: the sheet has an unnumbered front row + 1–13; §15.1 / P25 use 1–14. §16 keeps the gabbai's labels —
   P25/P26 should follow (data, not index + 1).
3. **Ark position** across the width (frames: centred over the middle block) — the sheet has no ark.
4. **Release order** within a family: which seats a released count frees first (frames: the family's order, as the
   sheet does — confirm which end).
5. **Two grids** in the Map tab (one per prayer) vs one: the real workbook shows one; P28 handles both.
6. **Counted areas** (נשים · בית הכנסת, גברים · אולם, נשים · אולם): capacities are unknown; P27 shows requests only.
7. Whether a gabbai may choose an **open Shabbat** as the effective date (frames: allowed, with the warning).
8. Linking when the registered family **already holds seats** (frames: ask add vs free).

### 16.12 Additions after build

Added 2026-10-28. Four seat screens were built before they had a design; this section gives them their look. They use
kit parts only (`Card`, `Txt`, `Button`, `Chip`, `Field`, `Segmented`, `Tag`, `Banner`, `Sheet`, `Toast`) and the
existing tokens. Nothing is added to `shared.css`. The only frame change is a new P26 panel for the pending state.

#### 16.12.1 On-behalf panel (`SeatBehalf`, on the print screen; refines §15.6)

- **Placement.** At ≥ 1100 px the print screen has two columns. The start column is 400 wide and holds the options
  `Card` with this panel under it, and it stays in place (sticky) while the pages scroll beside it. Below 1100 px
  they stack as built now (options, panel, pages, each up to 680 wide). On the phone, picking a household opens the
  panel in a `Sheet` titled "עדכון בשם {name}", with Save in the sheet footer.
- **Nobody picked yet.** `Card` with a `Txt bold heading` title "עדכון בשם משפחה" and a muted small sub line (new copy
  below). A `Field` "חיפוש משפחה" and a caption hint. Then the households as `Chip`s (regular size, 44 high), labelled
  "{name} · {count}", sorted by name. When there are more than 30, show "ועוד {n}. חפשו לפי שם." as a caption. An empty
  search shows "לא נמצאה משפחה בשם הזה.", and an empty hall shows `seats.behalf.none`.
- **A household picked.** Header row: `Txt bold heading` "עדכון בשם {name}", a plain `Tag` with the count, and at the
  end a `klink`-style text button "משפחה אחרת", which replaces the "סגירה" `Chip`.
  - On the map (screen only, never on paper), the household's seats get a **2 px tekhelet `#2A3F94` outline** offset
    by 1 px. A seat tapped on the map selects its household and scrolls the panel into view.
  - If past the deadline: an info `Banner`. Then `Segmented` ערבית · ליל שבת / שחרית · שבת בבוקר.
  - **Source line** (P27's `ksrc`, 12.5 bold muted; tekhelet when it is a gabbai): "עודכן על ידי גבאי" /
    "באפליקציה" / "לא ענו · כל המקומות שמורים". The third one shows when there is no answer yet, and it is the same
    family state the print draws as **pending**.
  - **Seat rows**, one per seat in the family's order. Each row is at least 52 high, with a 1 px `line` divider:
    `Txt small` "{block} · שורה {row} · מקום {k} מתוך {n}" at the start, and a pair of `Chip`s מגיע / לא מגיע at the
    end (the `kpair` pattern, 40 high on desktop and 48 on the phone). A released row's text turns muted. This list
    stands in for P25's frame on purpose: the whole map sits next to it.
  - Under the rows, the P25 summary in `Txt small bold`: "ערבית: 2 מגיעים · 1 פנוי לאחרים". It updates as chips change.
  - The caption `seats.behalf.note`, then a full-width primary `Button` "שמירה בשם המשפחה". It is **disabled until
    something changes**, with `noChange` as its accessibility hint. This replaces the "nothing to save" note.
- **After saving.** A `success` `Banner` (olive `#44652A` edge) "נשמר בשם {name}.", announced politely. The panel stays
  on the same household.
- **409 "changed".** An info `Banner` (tekhelet edge) with the `stale` copy and `accessibilityLiveRegion="polite"`. The
  rows reload to the new state and focus moves to the banner. Don't use an error tone: nothing failed, someone else
  answered first. Other failures use an error `Banner` with "נסו שוב".

#### 16.12.2 Print screen, no map yet (`SeatPrint` empty state)

The header stays as built (back link and title). Under it is one `Card edgeColor={k.tekhelet}` (`#2A3F94`; dark
`#8FA2F0`), up to 680 wide:
- An `Icon grid` in tekhelet, 28, at the start of the title row, then `Txt bold heading` "עוד אין מפת מקומות".
- A body `Txt` in muted: "כדי להדפיס, צריך קודם להכין את מפת המקומות: להדביק את הטבלה שכבר יש לכם, או לבנות את
  האולם מאפס."
- **Web:** a primary `Button` with `Icon grid`, "למפת המקומות", which opens the editor at its start screen (P28 frame 1).
- **Phone:** no button, since the editor is web only. Show the caption `seatmap.webOnly` "עריכת המפה באתר בלבד."
- No print options, no panel and no pages are drawn behind it.

#### 16.12.3 Member Home card after linking (`HomeCards` `seatLink`, per §16.7)

This is the one-time card from the P7 queue, in its built position (after "imported", before "terms").
- `Card edgeColor={k.tekhelet}`. Built with olive, but olive is P24's "answered/done" colour. This card asks for
  nothing yet, so it uses the plain P7 colour.
- Title row: `Icon chair` in tekhelet, 22 (it is not in the kit yet: add it as §16.8 lists, using the path from the frames' `chair` symbol), then `Txt bold heading` "המקומות שלכם בבית הכנסת".
- Body `Txt`: "הגבאי חיבר לחשבון שלכם {n} מקומות. מעכשיו אפשר לעדכן כאן אם מגיעים בשבת." For one seat: "הגבאי חיבר
  לחשבון שלכם מקום אחד. …". Never name the gabbai, and never count blocks or rows.
- A primary `Button` "למקומות שלי" dismisses the card and opens the seat page (P25) in this Kehila. A secondary `Button`
  "הבנתי" only dismisses. When seat release is off for the Kehila, only "הבנתי" shows, as the primary button.
- An error shows as an error `Banner` inside the card, as built.

#### 16.12.4 Print: the fourth state **pending / ממתין** (adds to §15.5, §15.9)

A pending seat is a family's seat for a family that hasn't answered this prayer yet. It is still kept for them, but
nobody has confirmed it. It must not read as taken (which is confirmed), as released, or as free.

**Shape (every style):** the 1 px solid black line, the same as taken, plus a **solid black right-triangle notch** in
the box's **top-left corner**. The hall is drawn LTR as the room, in both languages, so the notch is always top-left.
The notch legs are `round(cellH × 0.35)`, kept between 5 and 9 px: 8 px on the real hall's 32×24 cells and 6 px in
the 26×18 legend swatch. It sits apart from the released diagonal, which runs bottom-left to top-right, and from the
centred name. Names stay normal, not struck through. In RN, draw it as an absolute `View` at top 0 / left 0 with
`borderTopWidth: L, borderTopColor: #000, borderRightWidth: L, borderRightColor: transparent`, inside the box's
`overflow: hidden`. This replaces the built 1.5 px dotted line, which a photocopy loses.

| State | ירוק לפנוי | ירוק ואדום | שחור־לבן | Shape |
|---|---|---|---|---|
| תפוס | `#EBEBEB` | `#DB5B56` | `#C8C8C8` | 1 px line |
| **ממתין** | **`#E9B44C`** mustard | **`#E9B44C`** | **`#FFFFFF`** | 1 px line + black corner notch |
| שוחרר | `#9ED8AA` | `#9ED8AA` | `#FFFFFF` | 2 px line + diagonal |
| פנוי | `#57B46C` | `#57B46C` | `#FFFFFF` | 1.2 px dashed line |

- **Why mustard:** it is "waiting" without meaning "can sit" (green) or "taken" (grey or red). One hue in both colour
  styles. Black names on it have 11.1:1 contrast.
- **Greyscale L\*** (taken / pending / released / free): green-for-free 93 / 76 / 81 / 66; green/red 55 / 76 / 81 /
  66; B/W 81 / 100 / 100 / 100. Pending is 17 from taken in the default style and 21 in green/red, but only 5 from
  released. In B/W it has the same white as released and free. In every one of those cases **the shape separates
  them**: the solid notch against the heavy line plus diagonal, or against the dashed line. A black triangle survives
  any photocopy or toner level. In B/W, pending is white rather than grey so that grey always means "confirmed taken".
  This also avoids the `#e6e6e6` already used for taken in B/W prints with names.
- **Legend** (order תפוס · ממתין · שוחרר · פנוי, drawn in the style): "ממתין · לא ענו, שמור להם" / "Pending · no
  answer, kept for them". The style tails stay as they are. The pending colour isn't named in words, because the swatch
  and the notch carry it. **Count strip:** "תפוס n · ממתין n · שוחרר n · פנוי n". The options card's mini legend shows
  all four swatches.
- **Screen only:** each print-preview seat is a button labelled "{household}, {state}" (for example "בדיוני, ממתין").
- Frame: P26 has a new panel "מצב רביעי: ממתין" with the three legends, real-size cells with names, and these L\* values.
  The full P26 maps are not redrawn.

#### 16.12.5 Copy corrections (developer strings → kit tone)

Replace these in `he.json` / `en.json`. The keys stay the same unless a row says "new".

| Key | Built (he / en) | Use (he / en) |
|---|---|---|
| `seats.print.styleGreen` | ירוק לפנויים | ירוק לפנוי / Green for free |
| `seats.print.styleGreenRed` | ירוק / אדום · Green / red | ירוק ואדום / Green and red |
| `seats.print.styleBw` | Black & white | שחור־לבן / Black and white |
| `seats.print.styleNote` | …הצורות והכיתובים זהים בכל סגנון. | נשמר במכשיר הזה. הצורות נשארות בכל סגנון, גם במדפסת שחור־לבן. / Remembered on this device. The shapes stay in every style, even on a black-and-white printer. |
| `seats.print.namesNote` | …בלי שמות רואים רק תפוס, שוחרר ופנוי. | ההדפסה נתלית לפעמים בבית הכנסת. בלי שמות רואים רק את מצב המקומות. / Prints are sometimes posted in the hall. Without names it shows only each seat's state. |
| `seats.print.legendReleased` / `noteGreen` / `noteGreenRed` (en) | can be used | Released · free to sit / Green = free to sit / Green = free to sit · Red = taken |
| `seats.print.legendPending` | ממתין · עוד לא ענו | ממתין · לא ענו, שמור להם / Pending · no answer, kept for them |
| `seats.print.emptyTitle` | עוד לא נשמרה מפת אולם | עוד אין מפת מקומות / No seat map yet |
| `seats.print.emptyBody` | …להדביק או לצייר את מפת האולם בעורך המפה. | כדי להדפיס, צריך קודם להכין את מפת המקומות: להדביק את הטבלה שכבר יש לכם, או לבנות את האולם מאפס. / To print, first set up the seat map: paste the chart you already have, or build the hall from scratch. |
| `seats.print.emptyGo` | לעורך המפה / To the seating editor | למפת המקומות / Open the seat map |
| `seats.behalf.sub` | גבאי יכול לעדכן… גם אחרי המועד האחרון. | למשפחה שענתה לגבאי ולא באפליקציה. / For a household that answered a gabbai, not the app. |
| `seats.behalf.pastDeadline` | המועד האחרון עבר. אפשר לעדכן בכל זאת. | הדיווח נסגר. גבאי יכול לעדכן גם עכשיו. / Updates are closed. A gabbai can still update. |
| `seats.behalf.note` | …המשפחה תראה שהגבאים עדכנו. | יירשם "עודכן על ידי גבאי". המשפחה תראה "הגבאי עדכן", בלי שם. / Recorded as "updated by a gabbai". The household sees "A gabbai updated", without a name. |
| `seats.behalf.saved` | נשמר בשם המשפחה. | נשמר בשם {name}. / Saved for {name}. |
| `seats.behalf.stale` | המצב השתנה בינתיים… | מישהו עדכן את המשפחה הזו בינתיים. זה המצב העדכני, בדקו ושמרו שוב. / Someone updated this household meanwhile. This is the latest state; check and save again. |
| `seats.behalf.noChange` | אין שינוי לשמור. | אין שינויים לשמור. / No changes to save. (the disabled button's hint) |
| `seats.behalf.close` | סגירה / Close | משפחה אחרת / Another household |
| `seats.behalf.none` | אין משפחות עם מקומות. | עוד אין משפחות עם מקומות במפה. / No households have seats on the map yet. |
| `seats.behalf.noMatch` (new) | — | לא נמצאה משפחה בשם הזה. / No household by that name. |
| `seats.behalf.more` (new) | — | ועוד {n}. חפשו לפי שם. / {n} more. Search by name. |
| `seats.behalf.tapHint` | …על מקום תפוס במפה. | אפשר גם ללחוץ על אחד המקומות של המשפחה במפה. / Or tap one of the household's seats on the map. |
| `seats.behalf.noAnswer` (new) | — | לא ענו · כל המקומות שמורים / No answer · all seats kept |
| `seats.behalf.seatsCount` | {n} מקומות (also for 1) | one / other: מקום אחד / {n} מקומות · One seat / {n} seats |
| `cards.seatLink.title` | מקומות בבית הכנסת חוברו אליכם | המקומות שלכם בבית הכנסת / Your seats in the synagogue |
| `cards.seatLink.bodyOne` / `bodyOther` | …שהגבאי רשם בעבר על שמכם… בכל שבוע. | הגבאי חיבר לחשבון שלכם מקום אחד / {n} מקומות. מעכשיו אפשר לעדכן כאן אם מגיעים בשבת. / A gabbai connected one seat / {n} seats to your account. You can now tell us here if you're coming on Shabbat. |
| `cards.seatLink.open` (new) | — | למקומות שלי / My seats |
| `cards.seatLink.ok` | הבנתי / Got it | (keep) |

Unused key: `seats.behalf.pick`. Remove it, or use it as the `Field` placeholder.
Not copy, but in the same files: the print button "הדפסה / שמירה כ־PDF" uses `Icon send`. Change it to the kit's
`Icon print`.

#### 16.12.6 Editor fixes after the owner's test (2026-10-28)

The owner edited the map on a Wednesday: the editor opened the version in effect that day (from last Shabbat, read-only on
the server), so his save made a new version from this Shabbat, and on the next visit the editor opened the old one again
with a bare "יש גרסה מתוכננת מ־…" Banner. Changes, refining §16.4, §16.5 and §16.7:
- **Which version opens:** the one that governs the coming Shabbat (the latest from the current Shabbat or before; with
  only future versions, the first). Past versions open read-only from History as before.
- **Save default:** in place on the open version whenever the server still takes writes to it (not before the current
  Shabbat), even once that Shabbat is open for answers when only seat holders changed (the open-week warning shows;
  "open" now counts from the Thursday 08:00 opening, §21.1, and see §21.9). If
  the hall itself changed, the first Shabbat not yet open, as before. A past version always saves as a new version.
- **Scheduled note** (replaces the Banner): one compact line under the band, tekhelet edge: "מ־{later} נכנסת לתוקף גרסה
  אחרת של המפה. מה שתשנו כאן חל עד אז ולא יעבור אליה." · link "עריכת הגרסה מ־{date}" (asks before dropping unsaved
  changes) · `x` (dismissed on this device for that version; a new save of it brings the note back).
- **Selection bar:** a selected seat that is someone's names the owner ("המקום של X" / "n מקומות של X") and offers
  **"פנוי (פינוי המקום)"** first, drawn filled; "שיוך ל־X" is left out when it would change nothing. The panel hint says
  a seat can be assigned or marked free.
- **Holder actions in the families panel** (the selected holder without an account): "קישור למשפחה רשומה…" (the P30
  link confirm, same route), **"זה אני: קישור למשפחה שלי"** when the gabbai's own family has the holder's surname (and
  initial, if it has one), and "מחיקת המחזיק…": a confirm listing the seats it holds per version (past Shabbatot
  marked), "פינוי המקומות ומחיקה". Both write at once, so they ask to save or discard map changes first. The gabbai's own
  family carries a "המשפחה שלי" tag in the list.

### 16.13 Verification

Frames generated by a script from the spec's ASCII shape; the script asserts 225 seats, 80 invented households (1–6
seats), 27 free; tag balance checked with a parser. Not rendered (no browser on this machine): check P28–P30 at 1440
and 1280, dark mode, the phone view at 360, and P27's refreshed panels before building.

## 17. Family tree

Added 2026-10-28 at the owner's request: a family-tree illustration for updating personal details. Frames: `P31`
(the tree on the phone), `P32` (the person sheet), `P33` (wide), index section "ח. עץ המשפחה". Kit-drawn like §10;
styles in the "§17 Family tree" block of `shared.css`. All names are invented.

**Purpose.** Collect each relative's details once and build from them the names the Kehila uses: the **aliyah name**
("יוסף בן אברהם הלוי"), the **Mi Sheberach name** ("יוסף בן שרה") and the **memorial name** ("אברהם בן יצחק הלוי ז״ל"),
plus Hebrew birth dates (bar/bat mitzvah) and Hebrew dates of death (yahrzeit). A father's name is typed once, on the
father's figure, and every child's name uses it.

**Where.** Me › "המשפחה שלי" (P2) gets a secondary Button "עץ המשפחה ושמות לעלייה" (`tree` icon) with a 12.5 muted
line "n דמויות עם פרטים חסרים" when n > 0. It opens a full pushed screen (back "› חזרה"). Members and gabbaim only;
listeners have no family (§10) and no entry.

**Phone first.** Designed at 390 × 844 (iPhone 14/15 class); also fine at 360. Wide layout is secondary (§17.6).

### 17.1 What the tree shows (owner rule: a light tree)

The tree is for orientation and tapping. Each figure shows **only an icon and a first name**, plus at most:
- a **gold dot** (12 px) at the icon's top corner = something the names need is missing (see §17.3);
- a **memorial candle** badge (נר נשמה, 24 px, gold flame) at the icon's bottom corner **and "ז״ל"** after the name =
  deceased. The icon itself turns ash (`k.ash`). No red, no black frames.
- "אני" (11.5 bold tekhelet) under my own name.

No aliyah names, dates, tribes or warnings on the tree. All of that is in the sheet (§17.4). A one-line legend under
the title explains the dot and the candle ("● חסרים פרטים · 🕯 ז״ל · נר נשמה · לחיצה על דמות פותחת את הפרטים").

### 17.2 Layout (P31)

Top to bottom, one column, RTL:

1. Back, title "עץ המשפחה", Segmented **עץ / רשימה** (remembered on the device), legend.
2. **Parents row**: two small couple cards side by side (2 columns, gap 10): the husband's parents over the husband
   (right), the wife's parents over the wife (left). Each card: a 44-high link "▲ ההורים שלהם" and two figures
   (father right, mother left). A 2 px `k.line` wire runs from each card down to its child in our couple.
3. **Our couple**: one wide card, 2 px tekhelet border, radius 18, the family name in serif 17 ("יוסף ומרים ישראלי"),
   two big figures (icon 64). Husband right, wife left; "אני" on whoever is signed in.
4. A short wire and a pill "הילדים · n", then the **children grid**: 3 columns, gap 8, square tiles (≥ 104 high).
   **A married child takes one tile, the same size as any child** (owner: many families have mostly married children),
   with the couple figure and both first names ("נועה ואליהו", may wrap to two lines). Last tile: dashed "+ ילד/ה".
   Seven children = 3 rows; 5 children of whom 4 are married fit in one 390 × 844 screen with the parents and us
   (P34 test family). Nothing scrolls sideways, nothing shrinks.
5. Privacy line with a lock: "את העץ והפרטים רואים אתם, {partner} והגבאים של הקהילה." (owner decision 1, §17.11)

On a 390 × 844 screen the first view shows the parents, us and the first children row; the rest is plain vertical
scroll. Pinch-zoom is not used.

**Going up a generation.** "▲ ההורים שלהם" on a parents card moves the centre one level up (P31 phone 2): that couple
becomes the centre card, *their* parents fill the row above, and below is only the child we came from, as a couple
tile with a tekhelet ring ("מכאן באתם"). A breadcrumb "עץ המשפחה ‹ ההורים של יוסף", back "› עץ המשפחה" at the top
and a full-width "› חזרה ליוסף ומרים" button at the bottom. Each level up repeats the same pattern, so the screen never
holds more than three generations. Siblings are not recorded (note on the screen): only people whose names feed ours.

**Empty state (P31 phone 3, "just me").** Card `edgeColor=tekhelet` "מתחילים מכם" ("לחצו על דמות ומלאו את השם העברי.
שם האב עובר מעצמו לילדים, וכך נבנה השם לעלייה לתורה."). Only my parents' card (one card, centred), our couple with me
(gold dot until my name is complete) and an empty partner slot, and the "+ ילד/ה" tile. My partner's parents appear
once a partner exists.

**Empty slot.** The figure's own icon at 45% opacity in a dashed circle, a tekhelet "+" badge, the role as the name
("אבא", "אמא", "בת זוג"). Tapping opens the same sheet, empty.

**List view** (Segmented "רשימה"): the same people as `kli` rows by generation: name (with ז״ל), the relation and the
state in words ("אבא של יוסף · נפטר", "עוד לא מולא", "חסר שם האם"), and "פרטים ‹". For screen readers and anyone who
prefers lists.

### 17.3 Icons: age and gender read from the face

One inline-SVG line set, 32 × 32, stroke `currentColor` 1.6, soft parts (hair, beard, head covering) in
`currentColor` at 28% so it works on light and dark. Shown at 38 px in a 48 circle (52 in 64 for our couple).

| Icon | Who | Marks |
|---|---|---|
| `f-oldman` / `f-oldwoman` | parents' generation and up | glasses; long beard and kippah (man); head covering (woman) |
| `f-man` / `f-woman` | our couple, children's spouses | short beard and kippah (man); head covering (woman) |
| `f-boy` / `f-girl` | children, grandchildren | smaller, lower face, smile; kippah (boy); hair and two plaits (girl) |
| `f-couple` | married child | young man (kippah) and young woman (head covering), side by side |
| `candle` | deceased (badge) | glass memorial candle with a flame |

The icon follows the role (generation) and the gender field; an empty slot already shows the right face. Deceased =
the same icon in ash + candle + "ז״ל" (never the candle alone). The head-covering and kippah convention suits this
Kehila (owner decision 5: keep it). **Superseded (2026-10-28):** the line icons above are replaced by the illustrated
figures of §17.13. **Decision: direction B (head and shoulders in a disc) for every tree tile, the parents rows, list
rows and pickers; direction A (full body) only in the person-sheet header and the age-growth strip.** Both are drawn
from the same parts and palette, so they read as one family. P31–P33 are redrawn this way.

### 17.4 The person sheet (P32)

Tap a figure → bottom `Sheet` (up to 90% height, scrolls inside, grab handle, close 44). On wide screens the same
content is a side panel (§17.6).

1. **Header**: the icon, full name (with ז״ל), the relation in words ("אבא של יוסף", "אני · בעלה של מרים",
   "הבת שלנו ובן הזוג שלה").
2. **Computed name card** (tekhelet 6 px start edge): overline "השם לעלייה לתורה", the name in serif 21, and a line
   "למי שברך: יוסף בן שרה". Women (no aliyah name, owner 2026-10-28): overline "השם למי שברך", "נועה בת מרים" (the mother's name); no aliyah line. Deceased: ash edge, overline "השם לאזכרה",
   "אברהם בן יצחק הלוי ז״ל", and "נפטר בכ״ג בשבט תשע״ח".
   **Incomplete**: gold edge, overline "השם לעלייה לתורה · חסר שם האב", the missing part as a gold dashed blank
   ("יוסף בן ___"); same for "חסר שם האם" in the Mi Sheberach line. This is where "missing" is spelled out.
3. **Fields** (in this order):
   - שם פרטי עברי + שם משפחה (one row). Hint: "שם פרטי כמו שקוראים לתורה. שם כפול? כתבו את שניהם." The surname is
     prefilled from the father (children) or the husband (wife), editable.
   - שם האב / שם האם (one row). **When the parent's figure has a name, it is read-only** with a "מהעץ" link that opens
     that figure. When it is empty, it is a normal field ("השם העברי של אבא") with the note "השם יישמר גם בדמות של אבא
     בעץ": typing here fills the parent's figure, so there is one source of truth.
   - כהן, לוי או ישראל — men only (women: none, owner decision 2). Three Chips, **prefilled from the father's figure
     when the figure is created**, editable by hand afterwards ("נלקח מהאב כשהדמות נוצרה. אפשר לשנות.").
   - תאריך לידה: Hebrew day+month select and year select; the Gregorian date is computed and shown under it ("לועזי:
     24.6.1982"), and can be typed instead. Optional everywhere. Bar/bat mitzvah: see "Bar mitzvah" below.
   - **Status buttons** (owner, replaces the earlier "בחיים / נפטר/ה" Segmented): two small round icon buttons (44, on a
     row of their own right under the name card). **Memorial candle**: outline candle when off; label/tooltip "סימון
     כנפטר/ה" (long-press on phones, `title` on web, `aria-label` always, `aria-pressed`). Turning it on asks inline:
     "לסמן את {name} כנפטר/ה? יופיע נר נשמה ו״ז״ל״, ושדות תאריך הפטירה ייפתחו." with "כן, לסמן" / "ביטול"; then the
     candle is **lit** (orange flame with a soft glow) and "תאריך הפטירה (עברי)" (day, month, year selects, Gregorian
     under it) appears. **Ill** (§17.15): a heart-with-pulse button next to it. When either is on, a one-line caption
     follows the buttons: "נפטר · כ״ג בשבט תשע״ח" or "לרפואה שלמה". Turning the candle off (a mistake) needs no confirm.
     Date unknown is allowed (no dot for it). **No yahrzeit calculation** in this version (owner decision 4).
4. **Save** (primary). Remove only for children and spouses (inline confirm: "להסיר את {name} מהעץ? הפרטים יימחקו גם
   אצל {partner}." danger "כן, להסיר" + "השארה"). Parents' figures have "ניקוי הפרטים" instead (the slot stays).

**Short forms: only the fields that figure needs** (owner). Each figure opens its own small form:

| Figure | Fields (besides the computed name card) |
|---|---|
| Parents, grandparents and up | first name, surname, father's / mother's name (from the tree or typed), tribe (men), alive/deceased + date of death |
| Our couple | first name, surname, father's / mother's name, tribe (men), birth date, alive/deceased |
| Child | first name, birth date (+ bar/bat mitzvah), alive/deceased; the parents' names come from us — no fields; "נשוי/אה? הוספת בן/בת זוג" |
| Child's spouse | first name, surname, father's / mother's name (typed), tribe (men) |
| Grandchild | first name, son/daughter, birth date |

**Bar mitzvah (boys).** Once the birth date is in, the form suggests the **Shabbat of, or after, the 13th Hebrew
birthday** with its parasha and date — e.g. "שבת פרשת וישלח · י״ד בכסלו תשפ״ט · 2.12.2028" — in a card marked with a
Tag **"הצעה"** and a link "שינוי השבת ‹". **Changing it: the family picks the date itself** (owner) — no list of
suggested Shabbatot. A Segmented "תאריך עברי / תאריך לועזי" switches between a Hebrew picker (day, month, year selects)
and a Gregorian date picker. After picking, the chosen Shabbat's parasha and both dates show in a success Banner
("✓ שבת פרשת וישב · כ״א בכסלו תשפ״ט · 9.12.2028") and "קביעת השבת" saves it. If a weekday is picked, a Banner says so
and offers the Shabbat of that week ("זה יום ד׳ (י״ח בכסלו), לא שבת. השבת של אותו שבוע: שבת פרשת וישב … לקבוע
אותה?") with "כן, שבת פרשת {parasha}" and "בחירת תאריך אחר". A changed choice shows the Tag **"נקבע ידנית"** and
"חזרה להצעה: וישלח, 2.12.2028". If the birth date changes later, a manual choice is kept and a Banner asks whether to
take the new suggestion. Parashot follow the Israeli reading cycle. **Girls:** the bat mitzvah date (12th Hebrew
birthday) is shown as information only, no Shabbat picker (designer's call — flag: add a picker if the Kehila marks a
Shabbat for girls too).

**The feed, shown.** When a saved name is also someone else's father/mother name, the sheet says so before saving
(Banner "זה גם שם האב של 7 הילדים. בשמירה השמות שלהם יתעדכנו.") and after saving the toast names the count ("נשמר. השם
עודכן אצל 7 הילדים"). Every "מהעץ" field in a child's sheet is the visible link back to the parent.

**Married child (P32 phone 3).** Segmented "נועה | אליהו" at the top switches between the child and the spouse (a dot
on the spouse's tab when incomplete). Under the child's fields: "בן הזוג" (a row: icon, name, state, "פרטים ‹") and
"הילדים שלהם · n" — grandchildren as rows (name, computed name, "פרטים ‹") and "+ הוספת נכד/ה". Grandchildren are the
last level: first name, son/daughter and birth date only; their father's name comes from the son or from the
daughter's husband. The spouse's own parents are not drawn: the spouse sheet has free-text "שם האב" / "שם האם".

**Dates.** Hebrew first (selects), Gregorian computed. Checks: death before birth, birth in the future (error Banners).
**Exact Adar**: the month select lists the months of the chosen year; in a leap year it offers "אדר א׳" and "אדר ב׳"
(never a plain "אדר"), in a regular year one "אדר". The stored date keeps which Adar it was (birth and death alike).
Yahrzeit logic will be added later (owner: from "Noam"); it reads these exact dates.

### 17.5 Name rules (for the developer)

- Aliyah name = `hebrewFirst + (male ? " בן " : " בת ") + fatherHebrewFirst + (kohen ? " הכהן" : levi ? " הלוי" : "")`.
  Tribe suffix for men only.
- Mi Sheberach name = `hebrewFirst + בן/בת + motherHebrewFirst`.
- Memorial name = aliyah name + " ז״ל".
- Father's name = the father figure's `hebrewFirst` (all its words, e.g. "יוסף חיים"). A figure is **complete** when its
  first name and both parents' names exist (tribe for men if the father's is unknown). Incomplete → dot on the tree.
- Tribe of a man: copied from his father's figure when the figure is created; stored on the man and editable.
- Data: one `people` list per family (both adults edit it, like the children list in §10), each with `relation`
  (self, spouse, father/mother of a person id, child, child's spouse, grandchild), `gender`, `hebrewFirst`, `surname`,
  `fatherName`/`motherName` (only when no parent figure), `tribe` (men, when no father figure), `birth` (Hebrew +
  Gregorian), `deceased`, `death` (Hebrew; month stores אדר א׳ / אדר ב׳ in leap years), `ill` (boolean, living only;
  §17.15). The children list (P2/P3) and today's `torahName`,
  `barMitzvahParasha`, `children[].spouse*` fields migrate into it; deceased figures produce the yahrzeit entries
  (`relationship` gains `spouse`); yahrzeits for siblings stay in the manual "ימי זיכרון" list.
- Limits: 20 children (as §10), 20 grandchildren per married child, 6 generations up.

### 17.6 Wide layout (P33)

From 900 px: the tree in the middle (max 760), children in rows of 5, and a fixed **side panel** (400, inline-end =
left in RTL) instead of the bottom sheet; the selected figure has a 2 px tekhelet outline. Same generations and the
same "▲ ההורים שלהם" movement as the phone; no full-chart mode.

### 17.7 Accessibility

- Every figure is one `button`, ≥ 64 × 84 (child tiles ≥ 104 high); label = relation + name + state, e.g. "אבא של
  יוסף: אברהם זכרונו לברכה, נפטר/ה. פתיחת הפרטים" / "אמא של מרים: אמא, לא מולא". Generations are labelled groups,
  read top to bottom; the wires are decorative.
- Dot and candle are never alone: "ז״ל" is text, "חסר …" is spelled out in the sheet and the list view.
- Sheet: focus moves to its title, Esc / close returns to the figure. Wide: Tab through figures in reading order,
  Enter opens, Esc returns.
- Toasts and the "השמות יתעדכנו" result are polite live regions.

### 17.8 Components

New: **`FamilyTree`** (generation rows, couple card, children grid, focus-up state), **`Figure`** (icon + name + dot /
candle / empty / selected / path), **`FaceIcon`** (`oldman`, `oldwoman`, `man`, `woman`, `boy`, `girl`, `couple`),
**`PersonSheet`**, **`HebrewDateField`** (day+month and year selects, Gregorian under it; reusable for yahrzeits),
**`DerivedField`** (read-only value with a source link). Icons to add: `candle`, `up`, `tree`. Reused: `Sheet`,
`Segmented`, `Field`, `Chip`, `Banner`, `Button`, `Toast`, `Tag`.

### 17.9 Copy

| Key | Hebrew | English |
|---|---|---|
| `tree.entry` / `.entryMissing` | עץ המשפחה ושמות לעלייה / {n} דמויות עם פרטים חסרים | Family tree and aliyah names / {n} people with missing details |
| `tree.title` | עץ המשפחה | Family tree |
| `tree.view` | עץ / רשימה | Tree / List |
| `tree.legend` | חסרים פרטים · ז״ל · נר נשמה · לחיצה על דמות פותחת את הפרטים | Details missing · Of blessed memory · Tap a person to open their details |
| `tree.up` | ההורים שלהם | Their parents |
| `tree.crumb` / `.backTo` | ההורים של {name} / חזרה ל{couple} | {name}'s parents / Back to {couple} |
| `tree.kids` / `.kidsOf` | הילדים · {n} / הילדים שלהם בעץ | Children · {n} / Their children in the tree |
| `tree.addChild` | ילד/ה | Child |
| `tree.noSiblings` | אחים ואחיות לא נרשמים בעץ. רק מי שהשם שלו נחוץ לשמות שלכם. | Siblings aren't recorded. Only people whose names your names need. |
| `tree.start` / `.startBody` | מתחילים מכם / לחצו על דמות ומלאו את השם העברי. שם האב עובר מעצמו לילדים, וכך נבנה השם לעלייה לתורה. | Start with you / Tap a person and fill in the Hebrew name. A father's name passes to the children, building the aliyah name. |
| `tree.privacy` | את העץ והפרטים רואים אתם, {partner} והגבאים של הקהילה. | You, {partner} and the Kehila's gabbaim see the tree and details. |
| `tree.rel.*` | אבא של {name} · אמא של {name} · בעלה של {name} · אשתו של {name} · הבת שלנו · הבן שלנו · בן הזוג של {name} · נכד/ה | {name}'s father · mother · husband · wife · our daughter · our son · {name}'s spouse · grandchild |
| `tree.name.aliyah` / `.mi` / `.memorial` / `.her` | השם לעלייה לתורה / למי שברך: {name} / השם לאזכרה / השם למי שברך | Aliyah name / Mi Sheberach: {name} / Memorial name / Mi Sheberach name |
| `tree.missFather` / `.missMother` | חסר שם האב / חסר שם האם | Father's name missing / Mother's name missing |
| `tree.f.first` / `.firstHint` / `.surname` | שם פרטי עברי / שם פרטי כמו שקוראים לתורה. שם כפול? כתבו את שניהם. / שם משפחה | Hebrew first name / As called to the Torah. Two names? Write both. / Surname |
| `tree.f.father` / `.mother` / `.fromTree` / `.fillsParent` | שם האב / שם האם / מהעץ / השם יישמר גם בדמות של {אבא/אמא} בעץ. | Father's name / Mother's name / From the tree / Also saved on the {father/mother} in the tree. |
| `tree.f.tribe` / `.fromFather` | כהן, לוי או ישראל / נלקח מהאב כשהדמות נוצרה. אפשר לשנות. | Kohen, Levi or Yisrael / Taken from the father when this person was added. You can change it. |
| `tree.f.birth` / `.greg` / `.barMitzvah` / `.batMitzvah` | תאריך לידה / לועזי: {date} / בר מצווה: {hdate}, {day} {date} / בת מצווה: … | Date of birth / Gregorian: {date} / Bar mitzvah: … / Bat mitzvah: … |
| `tree.f.alive` / `.deceased` | בחיים / נפטר/ה | Living / Deceased |
| `tree.f.death` / `.diedOn` | תאריך הפטירה (עברי) / נפטר/ה ב{hdate} | Date of death (Hebrew) / Died on {hdate} |
| `tree.f.adar` / `.adarNote` | אדר א׳ / אדר ב׳ / בשנה מעוברת יש שני חודשי אדר, ושומרים בדיוק איזה מהם. | Adar I / Adar II / A leap year has two Adars; we keep exactly which one. |
| `tree.err.deathBeforeBirth` / `.future` | תאריך הפטירה מוקדם מתאריך הלידה. / התאריך לא יכול להיות בעתיד. | Date of death is before date of birth. / The date can't be in the future. |
| `tree.feedWarn` / `.feedDone` | זה גם שם האב של {n} הילדים. בשמירה השמות שלהם יתעדכנו. / נשמר. השם עודכן אצל {n} הילדים | This is also the father's name of {n} children. Their names will update. / Saved. Updated for {n} children |
| `tree.spouse` / `.grandkids` / `.addGrandkid` / `.grandkidsNote` | בן הזוג / בת הזוג · הילדים שלהם · {n} / הוספת נכד/ה / נכדים נרשמים כאן בשם, בן/בת ותאריך לידה. העץ לא ממשיך מתחתיהם. | Spouse · Their children · {n} / Add a grandchild / Grandchildren have a name, son/daughter and birth date. The tree stops there. |
| `tree.married` | נשוי/אה? הוספת בן/בת זוג | Married? Add a spouse |
| `tree.remove` / `.removeYes` / `.clear` | להסיר את {name} מהעץ? הפרטים יימחקו גם אצל {partner}. / כן, להסיר / ניקוי הפרטים | Remove {name} from the tree? It's removed for {partner} too. / Yes, remove / Clear details |
| `tree.save` / `.add` | שמירה / הוספה לעץ | Save / Add to the tree |
| `tree.bm.title` / `.suggested` / `.manual` | בר מצווה / הצעה / נקבע ידנית | Bar mitzvah / Suggested / Set by hand |
| `tree.bm.shabbat` / `.why` | שבת פרשת {parasha} · {hdate} · {date} / ההצעה: השבת שבה, או אחרי, יום ההולדת ה־13 העברי. משפחות מזיזות לפעמים; אפשר לשנות. | Shabbat {parasha} · … / Suggested: the Shabbat of or after the 13th Hebrew birthday. Families sometimes move it; you can change it. |
| `tree.bm.change` / `.pick` / `.reset` | שינוי השבת / באיזו שבת? / חזרה להצעה: {parasha}, {date} | Change Shabbat / Which Shabbat? / Back to the suggestion: … |
| `tree.bm.hebrew` / `.greg` / `.set` | תאריך עברי / תאריך לועזי / קביעת השבת | Hebrew date / Gregorian date / Set this Shabbat |
| `tree.bm.weekday` / `.useShabbat` / `.other` | זה יום {day} ({hdate}), לא שבת. השבת של אותו שבוע: שבת פרשת {parasha} · {hdate} · {date}. לקבוע אותה? / כן, שבת פרשת {parasha} / בחירת תאריך אחר | That's a {day} ({hdate}), not Shabbat. That week's Shabbat: … Set it? / Yes, Shabbat {parasha} / Pick another date |
| `tree.bm.afterBirthDate` | אחרי תאריך הלידה תופיע הצעה לשבת בר המצווה. | After the birth date, a bar mitzvah Shabbat is suggested. |
| `tree.batm.title` | בת מצווה | Bat mitzvah |

### 17.10 Decisions taken here (CTO to check)

1. The tree shows icon + first name only; the dot means "a name part is missing" (not optional birth dates).
2. One source per name: a parent's name lives on the parent's figure; the child's field is read-only "מהעץ". Typing a
   missing parent name in a child's sheet fills the parent's figure.
3. Upward navigation re-centres one generation at a time; no zoomed-out full chart, no pinch.
4. Married children: one level of grandchildren (rows inside the sheet), no deeper; the spouse's parents are free text.
5. No siblings in the tree (sibling yahrzeits stay in the manual list).
6. Visible to the family and to the Kehila's gabbaim (owner decision 1); listeners and other members see nothing.
7. Mi Sheberach uses the mother's name; memorial uses the father's name (+ ז״ל).
8. Women have no tribe field.

### 17.11 Owner decisions (2026-10-28)

1. **The gabbai sees the whole tree.** The details are collected for the gabbai. No family switch. Gabbai access is
   read-only, from the member's card in "חברים" (P11 family block gains "עץ המשפחה ›"). Copy: `tree.privacy`.
2. **No tribe for women** (no בת כהן / בת לוי).
3. **Kohen / Levi / Yisrael** defaults from the father when the figure is created; editable by hand.
4. **Yahrzeit calculation is out of scope** for now (the logic comes later from "Noam"). Collection must be exact: a
   date in a leap year records אדר א׳ or אדר ב׳.
5. **Keep the kippah and head-covering style** for the figures; the "without" variants stay available per figure.

Still open: the figure style direction and the figure options (§17.13).

**Changed by §18 (2026-10-28, owner round 4): the tree is the one place to edit.** My own figure's sheet starts
with "הפרטים שלי בקהילה" (app first/last name, phone with "הסרה", the phone-list Toggle with its on/off helper),
then the Hebrew-name fields; one save. Women have no aliyah name: their name card is "השם למי שברך" (P32 updated).
Partner linking lives in the tree: the empty partner slot (add / request sent / withdraw), a Banner at the top
(request received, declined, expired), and unlink in the partner's sheet. All of this is drawn in P31 panels 2–5 and
P32 panels 1–2, and listed in §18.2. Entries: the Me card button "צפייה ועריכה בעץ המשפחה ‹" and Kehila menu › "עץ
המשפחה". These replace "Where" above.

### 17.12 Verification

Rendered with headless Chromium (Playwright 1.47.2): P31 and P32 at 390 wide, light and dark; P31–P33 at 1280.
Checked: the 7-child family fits in three rows at 390, no horizontal scroll, sheets fit 844 high, dark contrast of
the dot, candle and icons. Not checked: real devices, 360-wide Android, English (LTR), screen readers, web fonts
(the shots may use fallback fonts if Google Fonts was not reachable). Hebrew dates in the frames were computed with
`Intl` (hebrew calendar); the copy needs a native editor.

### 17.13 Figure set (P34)

The owner wants this screen to be "very cool": warm, friendly illustrated people, not line icons (his reference is a
stock "family icon variations" set: smiling upper-body family members, three generations; we keep only its spirit, the
drawings are original). P34 "סט הדמויות" shows every figure in **two directions to choose from**, each figure at both
sizes (sheet header and the 390 tree tile) in light and dark:

- **A · דמויות מלאות**: a whole standing person, soft flat shapes, no outlines. Height and proportions tell the age;
  the tile crops to the figure so a toddler fills its square like an adult.
- **B · ראש ופלג גוף**: a big round head and shoulders inside a coloured disc ("chibi"). Faces stay readable at 52 px,
  which matters in the parents row.

**Palette.** Fixed illustration colours built from the app tokens (tekhelet, pomegranate, olive, gold, ash, stone) plus
three skin tones and five hair colours (brown, black, auburn, blond, grey/white). The art keeps its colours in dark
mode; only the tile, disc (`--disc`) and "stage" (`--spot`) behind it follow the theme.

**Children grow with age** (from the Hebrew birth date; no date → ילד/ה 4–8):

| Stage | Boys | Girls |
|---|---|---|
| תינוק/ת | 0–1, swaddled, tuft of hair | 0–1, swaddled, headband with a bow |
| פעוט/ה | 1–3, curls, waving | 1–3, curls and a hair band, waving |
| ילד/ה | 4–8, kippah and tzitzit from here, waving | 4–8, plaits with bows, waving |
| ילד/ה גדול/ה | 9–12 | 9–11, ponytail |
| נער/ה | 13–17 (from bar mitzvah) | 12–17 (from bat mitzvah), long hair, long skirt |
| בחור/ה | 18+, not married | 18+, not married |

**Adults** (our couple) and **older** (parents and up): three options each. Man: large knitted kippah and short beard
(default) · large black kippah and glasses · no kippah. Woman (our generation): long patterned tichel in fresh colours with a little hair showing at the forehead (default
for married) · tichel and glasses · wig (פאה: shoulder-length styled hair that looks natural) · no head covering. Older man: white beard, glasses, black kippah (default) · grey beard, knitted kippah · no kippah. Older
woman: large soft beret and glasses (default) · beret · grey bun, no covering.

**Kippah** (owner, 2026-10-28): the Kehila wears a large kippah. Drawn as a flat lens on the crown that follows the
head's curve and sits slightly back (about two thirds of the head's width, never a raised dome), knitted ones with a
contrasting ring. **Married women's head covering** (owner, references: a long illustrated-print headscarf, "לונג"). **Our generation
(the Kehila's women):** a long patterned tichel — a smooth wrap framing the face, a full rounded crown at the back, a
soft twisted band, the long end falling behind one shoulder, small printed motifs — in fresh colours (teal, coral,
blue, rose) with a little hair showing at the forehead for a younger look. **Grandmothers:** a large, soft beret with a
thin ribbon and a small flower, short hair showing below. No knot on top, no bandana tails. The option is stored per person ("איך להציג",
in the sheet); the default follows the person's generation and gender.

**Married child**: **one tile, the same size as a single child**, in his or her place among the siblings. Our child
stands **on the right, in front, slightly larger, on a tekhelet "stage"** (an ellipse under the feet, and a 3 px
tekhelet bar under our side of the figure); the spouse stands one step behind on the left, overlapping a little. In B
both busts share one disc. P34's compare view adds an older family (5 children, 4 married) in A and B to show it fits
one 390 screen. The name reads ours first ("אליעזר ותהילה"). Shown for a son with his wife and a
daughter with her husband (she in a tichel, he behind).

**Deceased**: the same figure in greyscale at 62% (no black, no red), the candle badge and "ז״ל". **Empty / add**: a
dashed outline (body in A, head-and-shoulders in a dashed circle in B) and the tekhelet "+".

**Chosen:** B in the tree, A in the sheet header and growth strip (see §17.3). Still open:
2. The default options per generation (as listed) — confirm, or change a default.
3. Default skin tone for a new family (three are drawn; each person can change it).
4. The children's age bands (bat mitzvah at 12 starts "נערה").

**Per-person figure ("הדמות שלי", P35).** Each person picks his own figure; an adult in the family or a gabbai can
set it for family members (children, parents, a spouse without an account). Entry: "הדמות ‹" under the name in the
person sheet (P32), or a tap on the header figure. A bottom sheet with a live preview at both sizes (sheet header and
tree tile) and at most five rows: **women** — head covering (מטפחת · כובע · פאה · בלי), its colour, skin tone, hair
colour, glasses; **men** — kippah (סרוגה גדולה · קטנה · קטיפה שחורה · בלי), beard (בלי · קצר · מלא), skin, hair,
glasses; **children** — skin, hair, glasses only, since the figure grows with age by itself (a strip shows the current
stage and the next, e.g. bar mitzvah). Defaults come from age, gender and generation; "חזרה לברירת המחדל" clears the
choice. Every option is a radio with ✓ and a text label; colour swatches have names for screen readers.
**Later:** a Kehila may set its own defaults (kippah type, women's covering) for new people; personal choices win.

**Build note.** One parametric `FamilyFigure` component (`react-native-svg`): `{ stage, gender, skin, hair, hairColor,
kippah: { style: 'large' | 'small' | 'velvet', colour, ring } | null, headCovering: { style: 'tichel' | 'beret' | 'wig',
colour, accent, fringe } | null, beard: null | 'short' | 'full' | 'long', glasses, clothes,
deceased, size }` → paths. Stage comes from the birth date and marital status; variant from the person's "איך להציג".
The frames generate every figure from such parameters, so the component can follow the same shapes.

Verification: P34 rendered with headless Chromium at 390 (light and dark) and 1280; no horizontal scroll at 390. Not
checked: real devices, the 360 width, and how small A reads in the parents row on a real phone.

### 17.14 Upcoming simchas for gabbaim (P36)

The bar mitzvah Shabbat (suggested or set by the family) and the bat mitzvah date (12th Hebrew birthday; information
only, no Shabbat for girls) feed the gabbaim's mazal-tov preparation. **Gabbai › Overview › "שמחות קרובות"**: the next
8 weeks, grouped by week (Shabbat, parasha, Hebrew and Gregorian date), one row per simcha: the child's B figure,
"בר מצווה · {first name}" / "בת מצווה · {first name}", "משפחת {surname}", and for bar mitzvahs the Shabbat's state
Tag ("הצעה" = the family kept the suggestion, "נקבע ידנית" = the family chose it); bat mitzvahs show their weekday
date. Filter Chips הכול / בר מצווה / בת מצווה. Weeks with nothing are listed in one muted line. A secondary Button
"הוספה למזל טוב בגיליון השבועי" marks this week's simchas in the weekly sheet (P23), where the gabbai confirms.
**Minimal data:** first name, surname and date only — no age, phone or other details; gabbaim only; never in a push.
Overview gets one card ("השבת: …", "ועוד n ב־8 השבועות הבאים", "לכל השמחות ‹"). Empty state: "אין בר או בת מצווה
ב־8 השבועות הבאים." Families without a birth date don't appear.

| Key | Hebrew | English |
|---|---|---|
| `simchas.title` / `.intro` | שמחות קרובות / בר ובת מצווה ב־8 השבועות הבאים, מעצי המשפחה. | Upcoming simchas / Bar and bat mitzvahs in the next 8 weeks, from family trees. |
| `simchas.bar` / `.bat` / `.family` | בר מצווה · {name} / בת מצווה · {name} / משפחת {surname} | Bar mitzvah · {name} / Bat mitzvah · {name} / The {surname} family |
| `simchas.none` / `.quietWeeks` | אין בר או בת מצווה ב־8 השבועות הבאים. / בלי שמחות: {parashot}. | No bar or bat mitzvahs in the next 8 weeks. / No simchas: {parashot}. |
| `simchas.toSheet` / `.privacy` | הוספה למזל טוב בגיליון השבועי / מוצגים רק שם פרטי, שם משפחה ותאריך. לגבאים בלבד. | Add to mazal tov in the weekly sheet / Only first name, surname and date. Gabbaim only. |

Verification (P31–P33 redraw, P36): rendered at 390 light and dark and at 1280. Not checked on devices.


### 17.15 חולה — מי שברך

Every figure collects its **father's name** (aliyah, blessings) and **mother's name** (Mi Sheberach for the sick).
For our children they come from the tree; for the parents' generation and up they are typed in the figure's sheet
(and fill that parent's figure, §17.4).

**The button.** In a living figure's sheet, next to the memorial-candle button (§17.4): a small round button with a
**heart and a pulse line** (soft rose `k.heal` — light #B8507A, dark #F2A6C0; never alarm red). Label/tooltip "סימון
כחולה · לרפואה שלמה" (long-press on phones). Turning it on asks lightly: "לסמן את {name} כחולה? השם יופיע במי שברך
לחולים." with "כן, לרפואה שלמה" / "ביטול"; on = filled heart on a pale rose disc, caption "לרפואה שלמה". Turning it off
needs no confirm. For a deceased figure the button is not shown.

**On the tree.** An ill figure keeps its colours and gets a small **heart-with-pulse badge** in a white circle with a
soft-rose ring (24 px, bottom corner of the disc — the place of the memorial candle, which it can never share) and the
word **"לרפואה"** under the name in the same rose. Calm, never alarm red; the text carries the meaning. (An olive leaf
was tried first; the owner found it unclear.) The memorial candle badge is now drawn **lit** (orange flame). Accessible label: "{relation}:
{name}, חולה, לרפואה שלמה". The legend line gains "♡ לרפואה שלמה" (the heart glyph). The person-sheet header (A figure) shows the same
badge and "לרפואה" after the name.

**In the sheet, when on.** The computed name card becomes the **Mi Sheberach name, prominent** (olive edge, overline
"השם למי שברך לחולים", name in serif 24: "{hebrewFirst} בן/בת {mother}") with a quiet line **"השם יישלח לגבאי למי שברך
לחולים (בקרוב)"**. If the mother's name is missing: the gold state (overline "… · חסר שם האם", "משה בן ___") and the
mother's-name field ("השם העברי של אמא", saved also on the mother's figure).

**Rules.** `ill` is for living figures only. Marking "נפטר/ה" clears `ill` and hides the heart button; going back to "בחיים"
does not turn it on again. Turning it off (recovery) removes the badge and the name from the sick list, silently — no
message to anyone. Same visibility as the rest of the tree (family and the Kehila's gabbaim, §17.11).

**Future (not now):** sending the names to the gabbai's Mi Sheberach list for the sick, its preview, and how long a
name stays. The M8 "מי שברך" tab and this flag will be joined then.

**Data.** `Person.ill: boolean` (default false; only when `deceased` is false). Mi Sheberach name =
`hebrewFirst + בן/בת + motherHebrewFirst` (§17.5).

| Key | Hebrew | English |
|---|---|---|
| `tree.ill.button` / `.confirm` / `.yes` | סימון כחולה · לרפואה שלמה / לסמן את {name} כחולה? השם יופיע במי שברך לחולים. / כן, לרפואה שלמה | Mark as ill · for a full recovery / Mark {name} as ill? The name will appear in the Mi Sheberach for the sick. / Yes, for a full recovery |
| `tree.dec.button` / `.confirm` / `.yes` / `.caption` | סימון כנפטר/ה / לסמן את {name} כנפטר/ה? יופיע נר נשמה ו״ז״ל״, ושדות תאריך הפטירה ייפתחו. / כן, לסמן / נפטר/ה · {hdate} | Mark as deceased / Mark {name} as deceased? A memorial candle and ז״ל will appear, and the date-of-death fields open. / Yes, mark / Deceased · {hdate} |
| `tree.ill.badge` / `.a11y` / `.legend` | לרפואה / חולה, לרפואה שלמה / לרפואה שלמה | For recovery / Ill, for a full recovery / For a full recovery |
| `tree.ill.nameTitle` / `.toGabbai` | השם למי שברך לחולים / השם יישלח לגבאי למי שברך לחולים (בקרוב) | Mi Sheberach name for the sick / The name will be sent to the gabbai for the Mi Sheberach (coming soon) |

Frames: P31 (שרה, the grandmother, is ill in the test family), P32 (her sheet with the heart on; Avraham's with the
candle lit; confirm panels for both; the missing-mother panel), P34 section 5 (both styles, light and dark, tile and header size).

## 18. Me and management — structure

Added 2026-10-28 after the owner used the dev build on his phone; revised the same day after his second round (one
details card with one edit, one details sheet shared with the tree, community things out of Me). Frames: `P41` (Me),
`P42` (management), index
section "ט. אני ומצב ניהול · מבנה". Kit-drawn like §10. The frames carry their own small style block, and nothing was
added to `shared.css`. All names are invented. This is an information-architecture pass: **no screen loses a
feature, and no flow changes.** Each existing card or screen gets one home, and the long pages become short lists
of grouped rows.

**What the owner said.** (1) Me › "המשפחה שלי" should be *one* link to the family tree (§17), with at most a short
status ("לא מולא" / "חסרים פרטים אצל 3" / "עודכן ב־12.10"), not partner linking and a children list on Me.
(2) "Management mode is a total mess… it starts with my profile, then edit name on its own, then the phone list,
then another edit on its own… why?" That sequence is the **gabbai's Me screen** as built (the "מצב ניהול" button, then
the profile card with a lone "עריכת שם", then the phone card with its own "עריכה"). The management overview has the
same problem: 14 blocks in build order. Both get fixed here.

### 18.1 Inventory (as built on `redesign`, 2026-10-28)

**Me (`src/views/Me.tsx`)**, top to bottom:

| # | Item today | Where today | Goes to (§18.2) |
|---|---|---|---|
| 1 | "מצב ניהול" primary Button (gabbai) | Me, above everything | **Kehila menu › ניהול הקהילה** (§18.2a); not on Me |
| 2 | Name + "עריכת שם" (lone Button) | Card "פרופיל" | Shown read-only in the **הפרטים שלי** card; edited in the tree, on my own figure (P32) |
| 3 | My role tags + note | Card "פרופיל" | הפרטים שלי card (chips); the note is dropped (tags are set by gabbaim, said in §12.6) |
| 4 | My phone number, "שינוי המספר" / "הסרת המספר" | Card "רשימת הטלפונים" (P4) | Shown in the card; edited and removed on my own figure in the tree (P32) |
| 5 | "הצגת הטלפון שלי ברשימה" toggle + privacy paragraph | same card | Card shows "ברשימת הטלפונים: מוצג לכולם / לגבאים בלבד"; the Toggle and its helper are on my figure in the tree |
| 6 | "פתיחת רשימת הטלפונים" Button | same card | **Kehila menu › רשימת הטלפונים** (→ P1); not on Me |
| 7 | Partner: add / sent / withdraw / confirm / decline / unlink | Card "המשפחה שלי" (P2) | **The family tree** (§17, P31). See the mapping below |
| 8 | Children list, edit, add (P3 sheet), "shared" note | same card | The family tree: child tiles, "+ ילד/ה", person sheet (P32) |
| 9 | Tree entry button (§17 "Where") | inside the P2 card | Me card button "צפייה ועריכה בעץ המשפחה ‹" with the family line, and Kehila menu › "עץ המשפחה" |
| 10 | Language chips | Card "שפה" | **התראות ושפה › שפה** (inline two-way switch in the row) |
| — | Kehila switcher sheet (M6): other Kehilot, "מצב ניהול" | Tap the Kehila name (only with 2+ Kehilot) | **Kehila menu** (§18.2a), always tappable |
| 11 | "הקבוצות שאני מנהל/ת" buttons | MyGroups, top | **שלי בקהילה › הקבוצות שלי** screen (top block) |
| 12 | Groups list, join / leave / request | MyGroups | same screen as 11 |
| 13 | "הזמנת מתפלל" + create link | Card | **Kehila menu › הזמנת מתפלל** screen |
| 14 | "הקישורים שלי" (share / revoke) | Card | same screen as 13 |
| 15 | "העדפות התראות" (lone Button) | between cards | **התראות ושפה › העדפות התראות** (row → M5) |
| 16 | Privacy contact, "על הקהילה", policy, data download | Card "פרטיות ונתונים" (P5) | Kehila's privacy contact → **Kehila menu › על הקהילה** (P13); policy + my data download → **החשבון › פרטיות ונתונים** |
| 17 | "יציאה מהקהילה" + confirm | Card | **החשבון** (action row, confirm in a Sheet) |
| 18 | "יציאה מהחשבון" | lone Button | **החשבון** |
| 19 | "מחיקת החשבון" | lone danger Button | **החשבון** (danger row → P10) |

**Management (`src/views/Main.tsx` tabs + `src/views/admin/Overview.tsx`).** Entered today from Me (#1), from the
Kehila switcher, from an approvals push, and from the Home terms card. Tabs: סקירה · אישורים · הודעות · חברים. The
overview today, top to bottom:

| # | Item today | Where today | Goes to (§18.3) |
|---|---|---|---|
| 1 | Pending requests count + "לבדיקה" | Overview card | **לטיפול עכשיו** row; and **חברים ומשפחות › בקשות הצטרפות** |
| 2 | Prayer schedule editor (§14.2) | Overview card | **תפילות וזמנים › עריכת זמני התפילות** |
| 3 | Seat map editor (§16) | Overview card "סידור מקומות" | **מקומות ישיבה › עריכת מפת המקומות** |
| 4 | Responses upload (§16.6) | same card, secondary | **מקומות ישיבה › העלאת קובץ תשובות מהטופס** |
| 5 | Holders without an account (§16.7) + hints Banner | same card | **מקומות ישיבה › מחזיקי מקומות בלי חשבון** (badge); hints also in **לטיפול עכשיו** |
| 6 | Privacy contact + inline edit (P12) | Overview card | **הגדרות הקהילה › איש קשר לפרטיות** (edit in a Sheet) |
| 7 | Terms accepted (P12) | Overview card | **הגדרות הקהילה › התנאים…**; unaccepted terms stay a gate (P8) and show in **לטיפול עכשיו** |
| 8 | Member and listener counts | Overview card | Status line of **חברים ומשפחות** |
| 9 | Listener cap + lone "שינוי התקרה" | Overview card | **הגדרות הקהילה › תקרת מאזינים** (value in the row, edit in a Sheet) |
| 10 | "קבוצות" | Button | **חברים ומשפחות › קבוצות** |
| 11 | "ערוצים" (channels + type rules at the bottom) | Button | **הודעות וערוצים › ערוצים** and **› סוגי הודעות** (two rows; the same screen may scroll to its section) |
| 12 | "ייבוא רשימה" | Button | **חברים ומשפחות › ייבוא רשימה** (last) |
| 13 | "טקסטים של התראות" | Button | **הודעות וערוצים › נוסח ההתראות** |
| 14 | "מפת האולם להדפסה" + behalf updates (§15.5–15.6) | Button | **מקומות ישיבה › מפת האולם להדפסה** and **› עדכון בשם משפחה** (opens the same screen at the behalf panel) |
| 15 | "הזמנה עם בחירת תפקיד" | primary Button | **חברים ומשפחות › הזמנות** (top of that screen) |
| 16 | All invite links, share / revoke | Overview list | same screen as 15 |
| 17 | Role tags management (§12.6) | lone "עריכת תגיות" Button on the Members tab | **חברים ומשפחות › תגיות תפקיד**; assigning stays on each member |
| 18 | Upcoming simchas (§17.14, designed, not built) | "Overview card" | **שמחות ועליות › שמחות קרובות**; this Shabbat's simcha is that group's status |
| 19 | Aliyot (future, separate design) | — | **שמחות ועליות › עליות לתורה** (reserved row) |
| 20 | New message (compose) | Messages tab FAB | stays; also **הודעות וערוצים › הודעה חדשה** |
| 21 | Bug report pill (§13) | every screen | unchanged. It is global and has no gabbai inbox, so it has no row. If an inbox is added, it goes in **הגדרות הקהילה** |

### 18.2 Me (P41)

**Me shows; the tree edits** (owner, round 4). Me holds only what is mine and is read-only: there is no edit sheet,
no family card, and no partner or children controls. Every personal and family edit happens in the family tree
(§17), the one place to edit. Me is one column of **list groups**: each group is a 14 bold muted label above one Card
of rows, and every row opens exactly one screen or one Sheet. Anything about the Kehila as a whole is in the Kehila
menu (§18.2a).

1. **הפרטים שלי** (one Card, read-only): avatar disc 56 (initials; later the P35 figure), name serif 21, role line
   ("חבר/ת קהילה", "גבאי", "מתפלל אורח"), my role tags as Tags. Then, after a hairline, a label/value list (14, label
   muted, value bold):
   - "טלפון" — the number (LTR isolate), or "לא הוזן" muted;
   - "ברשימת הטלפונים" — "מוצג לכולם" / "לגבאים בלבד" ("—" when there is no number);
   - the name from the tree, labelled by gender: men **"השם לעלייה לתורה"** ("דוד בן אברהם הלוי"), women **"השם למי
     שברך"** ("יעל בת רחל"). **Women never get an aliyah label.** An incomplete name shows in gold as "חסר שם האב / האם".
   Then, after another hairline, the **family line** (`tree` icon, "המשפחה שלי", one status, see the table) and **one
   secondary Button with the `tree` icon: "צפייה ועריכה בעץ המשפחה ‹"**. It opens the tree (P31). The card has no other
   action. Listener: name and role only, no phone, no tree, no button (§10).

   | Family status | Line | Mark |
   |---|---|---|
   | A partner request waits for me | "{name} ביקש/ה לקשר אתכם · לאישור" | pomegranate dot, bold pomegranate |
   | Some figures miss name details (§17.3) | "חסרים פרטים אצל {n}" | gold dot, bold gold |
   | Nothing filled except me | "לא מולא · מתחילים מכם" | muted |
   | My request is pending | "נשלחה בקשה ל{name}" | muted |
   | Complete | "עודכן ב־{d.m}" (last edit by either partner) | muted |

2. **שלי בקהילה**: הקבוצות שלי ("חבר/ה ב־{n} קבוצות", plus "· מנהל/ת את {group}" when I administer one).
3. **התראות ושפה**: העדפות התראות ("הכול פעיל" / "{n} מושתקים") · שפה, with a two-option switch inside the row
   (עברית | English, 40 high, selected = tekhelet border).
4. **החשבון**: פרטיות ונתונים (row → privacy policy and "הורדת הנתונים שלי", the P5 export) · יציאה מהקהילה · יציאה
   מהחשבון · מחיקת החשבון (danger). The last three are action rows: 52 high, weight 500, no chevron, each opens its
   existing confirm.

The gabbai's Me is the same screen. Management is reached from the Kehila menu.

**Editing myself: my own figure's sheet in the tree (P32, phone 1).** Tapping "אני" in the tree opens the §17.4
person sheet with a **"הפרטים שלי בקהילה"** block first, then "לעלייה לתורה" (or the Mi Sheberach name for women)
with the existing fields. One "שמירה" saves the whole sheet.
- שם פרטי + שם משפחה: the name shown in the app (one row). The Hebrew surname below is prefilled from it.
- טלפון (phone-pad, LTR), with a "הסרה" text link at the field's end. It removes the number on save; no separate
  confirm.
- Toggle **"המספר שלי ברשימת הטלפונים של {kehila}"**, disabled and off while there is no number. Helper under it:
  **on** "חברים וגבאים של {kehila} רואים אותו."; **off** "רק הגבאים של {kehila} רואים אותו."
  **Rule (owner, 2026-10-28): gabbaim always see a member's phone** (P11, §18.3). The switch decides only whether
  every member sees it in the phone list.
This block appears only on my own figure. A partner's figure never shows their phone or app name: each person edits
their own. A gabbai viewing a tree (read-only, §17.11) sees no edit controls.

**Listener (no tree).** A listener's name is edited in החשבון › פרטיות ונתונים › "השם שלי" (a small Sheet with the two
name fields). This is the only edit control outside the tree, because listeners have no tree.

### 18.2a The Kehila menu (P41 phone 3): one place for community-level things

**Pattern:** the Kehila name in the top bar (logo + name + chevron, §11) is always a button, on every screen and
with any number of Kehilot. It opens one Sheet, the **Kehila menu**, which replaces the M6 switcher:
1. Header: logo 44, the Kehila name (serif 21), my role.
2. One Card for **this Kehila**: ניהול הקהילה (gabbai only; band-coloured row with the pending count badge) ·
   **עץ המשפחה** (members and gabbaim, with the same family status; the second entry to the tree) · רשימת הטלפונים (members and gabbaim, → P1) · הזמנת מתפלל (members and gabbaim, invite + my links) · על הקהילה (P13:
   my role, the privacy contact, who holds the data).
3. **הקהילות שלי**: one row per Kehila with my role, the open one checked; "הצטרפות לקהילה נוספת".

When something waits for a gabbai, a 10 px pomegranate dot sits on the logo's corner. **Rule:** anything that is
about the Kehila and not about me (directory, inviting, the Kehila's info and privacy contact, management, switching)
goes in this menu. Me keeps personal things. Home may still show one-time cards that link into the same screens
(P7), but never a second permanent entry.

**Into the tree (P2, P4 → P31/P32).** The tree takes over everything the P2 card and the P4 phone card did (drawn in
P31 panels 2–5 and P32 panels 1–2):

| Function (P2 / P4 today) | Where it lives now |
|---|---|
| Add partner | P31: tap the empty "בן זוג" / "בת זוג" slot in our couple card. A small Sheet offers "בת/בן הזוג חבר/ה בקהילה" (→ the P2 member picker, send request) or "מילוי פרטים בלי חשבון" (→ P32) |
| Request sent | P31: the slot shows the name with Tag "ממתין לאישור" |
| Withdraw request | P31: tap that slot → Sheet with the P2 `sentBody` line and "ביטול הבקשה" |
| Request received: confirm / decline | P31: Banner at the top of the tree (under the title): "{name} ביקש/ה לקשר אתכם כמשפחה אחת." with "אישור" / "לא לאשר" and the decline note |
| Declined / expired | P31: Banner at the top with "סגירה"; the slot is empty again |
| Unlink | P32: bottom of the partner's figure sheet, "ביטול הקישור" with the P2 confirm |
| Children list, add, edit, remove | P31 child tiles and "+ ילד/ה"; the P3 fields live in the child's P32 sheet |
| "Children are shared" note | P31: the tree's privacy line |
| App name (was "עריכת שם") | P32: my own figure, "הפרטים שלי בקהילה" |
| Phone change / remove / list switch (P4) | P32: my own figure, same block |

The same states also show as the Me card's family line, and the received request also shows as the Home one-time
card (P7). The developer working in `src/tree/` owns these. Until they ship, the Me button can open the tree with
the old P2 card above it as a stopgap, so no state becomes unreachable.

### 18.3 Management (P42)

**The overview answers two questions only: what is waiting for me, and where things are.** It has no edit fields.

1. **לטיפול עכשיו** (Card, pomegranate start edge, shown only when something is waiting): one row per item, most
   urgent first: join requests ("{n} בקשות הצטרפות", badge) · terms not accepted · this week's schedule not published
   ("זמני שבת {parasha} עוד לא פורסמו", from Wednesday) · seat link suggestions ("{n} הצעות קישור למחזיקי מקומות") ·
   group join requests. When nothing is waiting: one muted line "אין משהו שממתין לכם." in place of the card.
2. **תחומים**: one Card of six 72-high rows (icon, title, one live status line, chevron). The order follows how often a
   gabbai uses each one:

| Group | Status line (example) | Rows inside, in order |
|---|---|---|
| **תפילות וזמנים** (weekly) | "שבת וירא · טיוטה" / "· פורסם ב־27.10" | עריכת זמני התפילות (§14.2) · הגיליון השבועי (§14.4–14.5) |
| **מקומות ישיבה** (weekly) | "השבת: 61 מתוך 84 משפחות ענו" | *השבוע:* מפת האולם להדפסה · עדכון בשם משפחה · העלאת קובץ תשובות מהטופס — *כל שבוע:* זמני הטופס והתזכורות (§21.6) — *הגדרת האולם:* עריכת מפת המקומות · מחזיקי מקומות בלי חשבון (badge) |
| **הודעות וערוצים** (most weeks) | "4 ערוצים · 2 סוגי הודעות" | הודעה חדשה · ערוצים · סוגי הודעות (§12.2) · נוסח ההתראות |
| **שמחות ועליות** (by the calendar) | "השבת: בר מצווה · הלל, משפחת דוגמה" | שמחות קרובות (§17.14) · עליות לתורה (reserved, separate design) |
| **חברים ומשפחות** (when people join) | "142 חברים · 38 מאזינים" | בקשות הצטרפות (badge) · ספר החברים (families, phones with call / WhatsApp, P11) · תגיות תפקיד · קבוצות · הזמנות · ייבוא רשימה |
| **הגדרות הקהילה** (rare) | "תקרת מאזינים, פרטיות, תנאים" | תקרת מאזינים (value "38 / 50" in the row) · איש קשר לפרטיות · התנאים בין הקהילה לבין קהילות |

**A group screen** (P42 phone 2) is pushed with back "› סקירה". It has an optional summary Card on top (seats: this
Shabbat's answers with a bar and the deadline), then list groups of rows. The rows open the screens that exist
today. Settings that were inline edits (cap, privacy contact) show their **value in the row**, and tapping the row
opens a Sheet with the field and "שמירה", so nothing is edited in the overview.

**Tabs stay** (סקירה · אישורים · הודעות · חברים, §11.4): approvals and the member book are daily tools and already
have badges. Inside management the Members tab and "חברים ומשפחות › ספר החברים" open the same screen. The Members
tab loses its lone "עריכת תגיות" button (now a row), and per-member tag assignment stays on the member.

**Wide (≥ 1024, P42 panel 4).** The tab row becomes a 272 start-side sidebar: סקירה, אישורים (badge), הודעות, חברים, a
divider, "תחומים" with the six groups, and "יציאה ממצב ניהול" at the end. The overview shows "לטיפול עכשיו" as one
row of up to three items, then the six groups as a 3-column grid of cards, each listing its rows. On a computer every
tool is one click from the overview. A group in the sidebar opens the same group screen in the content column.

### 18.4 Rules (for any new item)

- **Every new item names its group** in its spec. If it fits none, raise it with the designer. Do not append to
  the overview or to Me.
- An item that needs action shows in **לטיפול עכשיו** only while something is waiting, and **also** lives in its
  group.
- **No lone edit buttons.** A value is shown in its row, and editing happens in a Sheet or in the item's own screen.
- One row = one destination. A status line is one line (ellipsis at the end) and shows the live state, never a
  description of the feature.
- Personal things go on Me. Things about the whole Kehila that everyone uses go in the **Kehila menu** (§18.2a).
  Things only gabbaim do go in management. A gabbai's own details, family and notifications stay on Me.
- **Me never edits.** Personal and family edits live in the tree: my own figure for name, phone and list
  visibility, the partner slot for linking, tiles for children. The only exception is the listener's name (no tree).
- Women have no aliyah name: label their name "השם למי שברך".

### 18.5 Components

- **`ListGroup`** (new, `src/kit`): an optional label (`Txt size="small" bold`, muted, 4 start inset) above a Card with
  padding 0 and radius 12 whose children are rows separated by 1 px `k.line`.
- **`NavRow`** (new): min height 56 (72 for `big`), padding 8/16, gap 12. Parts: optional `Icon` 24 tekhelet; title 16
  bold; status `Txt size="small"` muted, one line; tone `warn` (gold, bold, with a 10 px gold dot) or `attention`
  (pomegranate, bold, dot or count badge); optional end value (14 bold muted); `ForwardIcon` 20 muted. Variant `action`:
  52 high, weight 500, no chevron. `danger` uses `k.danger`. The whole row is one `Pressable` with
  `accessibilityRole="button"` and label "{title}. {status}".
- **Manage row** (in the Kehila menu): a `NavRow` on a `k.band` background with white text and a count badge (same badge
  as the tabs).
- **`DetailsCard`**: Card with the profile header, a two-column label/value list (`Txt size="small"`, label muted,
  value bold; the tree name in serif), the family line, and one secondary Button to the tree. It has no edit controls.
- **Self block in the person sheet** (§17.4): the name row, the phone Field with an end text link, and the Toggle with
  its on/off helper. It is shown only for `me`.
- **Kehila menu**: `KehilaSwitcher` grows into it. TopBar's name button is no longer `disabled` when there is one
  Kehila.
- **Inline language switch**: the §11 segmented control, compact (40 high), inside a `NavRow` without a chevron.
- Existing pieces (PhoneCard, PrivacyCard, MyGroups, the invite card + MyLinks, CapCard, PrivacyContactCard,
  InviteList) become the bodies of their pushed screens or Sheets without changes to their contents.

### 18.6 Copy

| Key | Hebrew | English |
|---|---|---|
| `me.details.title` / `.phone` / `.inList` / `.toAll` / `.gabbaimOnly` / `.none` | הפרטים שלי / טלפון / ברשימת הטלפונים / מוצג לכולם / לגבאים בלבד / לא הוזן | My details / Phone / In the phone list / Shown to everyone / Gabbaim only / Not added |
| `me.details.aliyah` / `.mi` / `.family` / `.toTree` | השם לעלייה לתורה / השם למי שברך / המשפחה שלי / צפייה ועריכה בעץ המשפחה ‹ | Aliyah name / Mi Sheberach name / My family / View and edit the family tree › |
| `tree.self.title` / `.removePhone` / `.switch` / `.on` / `.off` | הפרטים שלי בקהילה / הסרה / המספר שלי ברשימת הטלפונים של {kehila} / חברים וגבאים של {kehila} רואים אותו. / רק הגבאים של {kehila} רואים אותו. | My details in the community / Remove / My number in {kehila}'s phone list / Members and gabbaim of {kehila} see it. / Only the gabbaim of {kehila} see it. |
| `tree.partner.slotSheet.member` / `.noAccount` | בת/בן הזוג חבר/ה בקהילה / מילוי פרטים בלי חשבון | My partner is a member / Fill in details without an account |
| `kehila.menu.tree` | עץ המשפחה | Family tree |
| `kehila.menu.about` / `.mine` / `.join` | על הקהילה / הקהילות שלי / הצטרפות לקהילה נוספת | About the community / My communities / Join another community |
| `me.groups.mine` / `.notify` / `.account` | שלי בקהילה / התראות ושפה / החשבון | Mine in the community / Notifications and language / Account |
| `me.family.request` / `.missing` / `.empty` / `.sent` / `.updated` | {name} ביקש/ה לקשר אתכם · לאישור / חסרים פרטים אצל {n} / לא מולא · מתחילים מכם / נשלחה בקשה ל{name} / עודכן ב־{date} | {name} asked to link with you · confirm / Details missing for {n} / Not filled in · start with you / Request sent to {name} / Updated {date} |
| `kehila.menu.manage` / `.waiting` / `.none` | ניהול הקהילה / {n} בקשות הצטרפות ממתינות / אין משהו שממתין | Manage the community / {n} join requests waiting / Nothing waiting |
| `admin.todo.title` / `.none` | לטיפול עכשיו / אין משהו שממתין לכם. | Needs attention / Nothing is waiting for you. |
| `admin.area.*` | תפילות וזמנים / מקומות ישיבה / הודעות וערוצים / שמחות ועליות / חברים ומשפחות / הגדרות הקהילה | Prayers and times / Seating / Messages and channels / Simchas and aliyot / Members and families / Community settings |
| `admin.area.label` | תחומים | Areas |

### 18.7 What this supersedes

- **M7 and the Me order in §10 (P2, P3, P4, P5)**: Me is read-only. P2/P3 move into the tree, P4's editing moves to
  my figure's sheet (P32) and its list link to the Kehila menu. P5's Kehila
  contact moves to "על הקהילה", and its export to החשבון.
- **M6 (Kehila switcher)**: grows into the Kehila menu (§18.2a).
  **P2 on Me** is replaced by the single family row. Its states move into the tree (table in §18.2).
- **§17 "Where"** (a secondary button inside the P2 card): replaced by the Me card button and the Kehila menu row.
- **§10 P11 "No phone numbers on this screen"**: reversed. Gabbaim see each adult's phone with call / WhatsApp and the
  list state (P11 updated). The privacy page and P13 must say that gabbaim see members' phones.
- **GM1 / the built overview, P12's "in the overview"**, the §14.2 editor card, the §16 seating card, and **§17.14's
  "Overview gets one card"**: replaced by the overview in §18.3. Their screens are unchanged.
- **§12.6** "עריכת תגיות" at the top of Members: now the row חברים ומשפחות › תגיות תפקיד.
- **§12.2** type rules at the bottom of Channels: also reachable as their own row.
- GD1–GD6's sidebar (old desktop sketches): the §18.3 wide sidebar is the current one.

### 18.8 Open points

1. Does "לטיפול עכשיו" flag an unpublished schedule from Wednesday (assumed), or should the gabbai set the day?
2. Should the seating group show the live answer count when no weekly release is running (the preview flag is off)?
   Assumed: status "אין שחרור פעיל השבוע", and the rows stay.
3. "מצב ניהול" is now only in the Kehila menu (plus pushes and the Home terms card), with a dot on the logo. Is that
   findable enough for gabbaim, or should Home get a permanent gabbai card?
4. Listener name editing sits in פרטיות ונתונים (no tree). Acceptable, or should listeners get a one-figure tree?

### 18.9 Verification

Rendered with headless Chromium (Playwright 1.47.2): P41 phones 1–3, P42 phones 1–2, P32 phone 1 and P11 phone 1 at
390 × 844, P31 panels, light and
dark; P42 panel 4 at 1280. Checked: no horizontal scroll at 390, no row title or status cut off (checked with
scrollWidth), and the badges, gold and pomegranate statuses in dark mode. Not checked: real devices, 360-wide
Android, English (LTR), screen readers, web fonts (the shots may use fallback fonts), and the tree-side partner
flows, which are only specified in the table in §18.2 and not drawn.

## 19. Message templates, the weekly sheet's items, and the Kehila logo

Added 2026-10-28 for three owner requests: (A) post an announcement from a template or as free text, (B) decide which
mazal tovs and events reach the weekly sheet and Home, and who approves them, (C) let gabbaim upload the Kehila logo
(until now only an admin tool could). Frames: `P43` (templates in Compose), `P44` (sheet items, Home card, A4, 1280),
`P45` (logo), index section "י. תבניות הודעה, הגיליון השבועי ולוגו". Kit-drawn like §18. The frames carry their own
style block, and nothing was added to `shared.css`. All names, texts and the logo are invented.

### 19.1 Terms

- **Template**: a fixed set of fields for one message type. From those fields the app builds the message title and
  body, and the line for the sheet. A message posted from a template stores `templateId` and `fields` next to the
  title and body it produced, so the sheet and Home can use the short form without parsing text.
- **Sheet item**: one line under the times on the weekly sheet (§14.5) and in Home's "השבוע בקהילה" card. It is either
  a message (mazal tov or event) or a **free item** that a gabbai typed for one week only. Each item has a **sheet
  line** (editable by the gabbai, the message itself does not change), a state (`in`, `pending`, `removed`) and an
  order.
- **Sheet week**: the schedule week of §14.1 (Friday to Thursday), named by its Shabbat.

### 19.2 Compose: template or free text (P43)

**Where:** Compose (M4, §12.3), after the type cards. Nothing else in Compose moves: channel row, family picker,
image, audience line and "פרסום" stay as they are.

1. **"איך כותבים"**, a `Segmented` with two options: **מילוי תבנית** (`tpl` icon) / **טקסט חופשי** (`pen` icon).
   Shown only when the chosen type has a template. Default: מילוי תבנית for אירוע, מזל טוב and השתתפות בצער. הודעה and
   עדכון שבועי have no template in v1, so the control is not rendered and the form is today's form.
2. **Template fields** (below). Required fields carry no mark; optional ones end with a muted "(לא חובה)". Chips are
   the kit `Chip size="filter"` in a wrapping row, radio semantics, 40 high with a 48 hit area; the selected chip is ink
   filled with a check (as §12.4).
3. **Live preview**, a `TemplatePreview` box (dashed `k.line` border, `k.stone`, label "כך תיראה ההודעה" with `eye`):
   the real `MessageRow` card exactly as members will see it, updated on each keystroke (no debounce needed; it is
   local). For mazal tov and event, a second label "בגיליון השבועי" with the sheet line drawn in the paper colours (§14.5)
   and one caption saying what will happen: "נכנס לגיליון מיד (פורסם בידי גבאי)" or "ייכנס לגיליון אחרי אישור
   הגבאים" (§19.3). On a phone the preview sits under the fields; at ≥ 1024 the form is 560 wide and the preview is a
   sticky column beside it.
4. **Missing required fields**: the preview shows a gold dashed placeholder with the field's name (`ymiss`, e.g.
   "שעות"), never colour alone. "פרסום" stays enabled; pressing it with something missing marks each missing field with
   the error line "צריך למלא {field}" (kit `Field` error), moves focus to the first one, and publishes nothing.
5. **Switching to free text** copies the built title and body into the free fields (only if they are still empty or
   untouched since the last copy) with an info `Banner`: "הנוסח מהתבנית הועתק לכאן. אפשר לערוך אותו חופשי." Switching
   back keeps the template fields as they were. Nothing is lost while Compose is open. Publishing uses the visible mode.
   A free-text message stores no `fields`; its sheet line is the title (with the picked family's surname in bold).
6. Draft saving (M4) covers the mode and the fields.

**Template fields, v1.** Text in "…" is what the app builds; {…} are fields.

| Type | Fields (order) | Built title / body | Sheet line |
|---|---|---|---|
| **אירוע** | שם האירוע · יום ותאריך (date picker; shown Hebrew first with the Gregorian in brackets, "ג׳, י״ב בחשוון (3.11)") · שעה · מקום · למי (chips: לכולם, גברים, נשים, נוער, ילדים; default לכולם) · מארגנים (לא חובה) · פרטים נוספים (לא חובה) | "{שם}" / "{יום}, {תאריך עברי} ({תאריך}), בשעה {שעה} · {מקום} · {למי}." + "מארגנים: …" + details | **{שם}** · {יום קצר} {שעה} · {מקום} |
| **מזל טוב** | השמחה (chips: הולדת בן, הולדת בת, בר מצווה, בת מצווה, אירוסין, חתונה, אחר → field "איזו שמחה") · המשפחה (P14 picker) · השמחה של (chips: ההורים, הסבים, אחר → free "של מי") · שם בעל/ת השמחה (label follows the occasion: "שם התינוק", "שם הנכדה", "שם החתן"…; לא חובה) · ההורים (only when "הסבים"; לא חובה) · שורת ברכה (prefilled per occasion, editable, can be emptied) | "מזל טוב למשפחת {surname}" / "ל{occasion phrase} {name}, {relation} ל{parents}. {blessing}" | "מזל טוב ל{adults' first names} **{surname}**" + new line "ל{occasion phrase} {name}" (+ ", בת/בן ל{parents}" for grandparents; blessing only if it fits, §19.3) |
| **השתתפות בצער** | **מה כוללת ההודעה** (first field, chips: פטירה בלבד · שבעה בהמשך · עם פרטי השבעה; default עם פרטי השבעה) · המשפחה (P14 picker) · הנפטר/ת (name, with ז״ל / ע״ה added if missing) · קרבה (free, "אביו של משה") · then **only for "עם פרטי השבעה"**: כתובת השבעה · ניחום אבלים בשעות (free, "10:00–13:00, 17:00–22:00") · השבעה עד (date) · זמני תפילה בבית האבלים (לא חובה) | "משפחת {surname}" / "אנו משתתפים בצערו/ה של … במות …." + by variant: (a) nothing; (b) "פרטי השבעה יימסרו בהמשך."; (c) "השבעה ב…, עד …. ניחום אבלים בשעות …. תפילות: …." — always ending "המקום ינחם אתכם בתוך שאר אבלי ציון וירושלים." | "משפחת **{surname}** · במות {הנפטר/ת}" + new line by variant: (b) "פרטי השבעה בהמשך"; (c) "השבעה ב{כתובת} עד {יום}" (CTO call, §19.9 item 1) |
| הודעה, עדכון שבועי | no template (free text) | — | title |

Default blessing lines: birth "שיזכו לגדלו/ה לתורה, לחופה ולמעשים טובים"; bar mitzvah "שיזכה לגדול בתורה
ובמצוות", bat mitzvah "שתזכה לגדול בתורה ובמעשים טובים"; engagement and wedding "שיזכו לבנות בית נאמן בישראל"; other: empty. Grammar (son/daughter, he/she,
singular/plural) follows the chosen chips; the developer keeps the phrases in the i18n file, not in code.

**Gabbai-managed templates (future, kept light).** v1 ships the templates above, fixed and the same for every Kehila.
Later: management › הודעות וערוצים › **תבניות הודעה**, a list of one row per type (P43 panel). A gabbai can hide an
optional field, change the default blessing and closing line, and duplicate a template under another name. When a
type has more than one template, Compose shows a "תבנית" select under "איך כותבים"; with one template it is not shown.
No free-form template editor.

**A11y:** "איך כותבים" is a `radiogroup`; chip rows are `radiogroup`s labelled by their field; the preview box is a
`region` labelled "תצוגה מקדימה", **not** a live region (it would read every keystroke); a "הקראת התצוגה" is not
needed because the fields carry the same data. Error lines are linked to their fields.

### 19.2a Updating a posted message: shiva details (P43 phones 5–7, owner 2026-10-28)

**The three condolence variants** (owner): (a) **פטירה בלבד**, no mention of a shiva at all; (b) **שבעה בהמשך**, the
line "פרטי השבעה יימסרו בהמשך."; (c) **עם פרטי השבעה**, address, hours, until and prayer times (P43 phone 4). The
variant is the first chip row of the template; switching hides or shows the shiva fields without clearing them.

**Update instead of a second message.** Families often know the shiva details hours after the first notice. The
details are added to the same message:

1. **Who:** the message's author, gabbaim, and the adults of the bereaved family the message names (owner,
   §19.9 item 4). Nobody else sees the action.
2. **Where:** on the message view (M3), under the card, a small `Card` "רק את/ה והגבאים רואים את זה" with a primary
   Button **"עדכון פרטי השבעה"** when the variant is (a) or (b), and the same action as "עדכון פרטי השבעה" (secondary)
   for (c), for corrections. Also in the message's `more` menu in Messages and in management's message list.
3. **The form:** Compose in update mode, full screen without the tab bar: back "ההודעה", title "עדכון פרטי השבעה", no type cards, no channel, no family
   picker change (family, deceased and relation stay prefilled and editable), variant preset to **עם פרטי השבעה**, the
   live preview, a `Toggle` **"להודיע לחברים על העדכון"** (on by default when shiva details are added for the first
   time, off for later corrections), and the primary Button **"שמירת העדכון"**. Required-field rules are as §19.2.
4. **The message after an update:** the same message id. The meta line reads "השתתפות בצער · **עודכן {time}**"
   (bold "עודכן", time; date when not today), and the card ends with one caption line, `Txt caption muted` above a
   hairline: "עודכן ב־{time}: נוספו פרטי השבעה · פורסם לראשונה ב־{time}". Replies ("משתתף בצער" count) stay with
   the message. No edit history is shown to members; the server keeps the previous text for gabbaim.
5. **How members learn of it (my call, respectful and quiet):** when the toggle is on, the message **moves to the top
   of the feed once** (sorted by its update time) and becomes unread again for those who had read it, and **one quiet
   push** goes to people who get condolence notifications and have not muted the type or the author: title
   "עודכנו פרטי השבעה · משפחת {surname}", and no body detail: the address and days show only inside the app (owner, 2026-10-28). No sound or vibration (Android low-priority
   channel, iOS `passive`). At most one such push per message per 12 hours; corrections with the toggle off change
   the text silently and do not move the message. Never a second message in the feed.

**Events: the same mechanism (owner question).** Proposed: "עדכון פרטי האירוע" on an event message (author, gabbai):
the event template prefilled; a changed time or place shows the old value struck next to the new one in the message
("בשעה ~~20:30~~ 21:00"), the meta line "שונה {time}", the same quiet push "שינוי ב{event}: {what changed}", and
the sheet line (§19.3) updates by itself. A cancelled event gets "בוטל" as a Tag on the card and on the sheet line.
Drawn as a P43 panel; adopted by the owner (§19.9 item 3).

**For the developer:** this needs a message update (author or gabbai) that keeps the id, stores `fields`, `updatedAt`
and the previous text, and takes a `notify` flag for the quiet push and the one-time move up. Not designed here.

### 19.3 What goes on the weekly sheet and Home (P44)

**The rule (CTO suggestion adopted, with one switch):**

| Posted by | Mazal tov, event | Condolence | General, weekly |
|---|---|---|---|
| Gabbai or management | **On the sheet automatically** | **On the sheet automatically** (owner, §19.9) | Not on the sheet |
| Member with broadcast permission | **Pending** until a gabbai taps "להוסיף לגיליון" | **Pending**, as mazal tov | Not on the sheet |

A Kehila setting, **"מה שחברים מפרסמים"**, switches the second row to "נכנס אוטומטית" (owner's alternative). Default:
"אחרי אישור של גבאי". Whatever the setting, the gabbai can always remove an item, edit its sheet line, reorder, and
add a free item for the week. Which week: an event goes to the sheet week its date falls in (free-text events: the
week they were posted); a mazal tov goes to the sheet week it was posted in, and one posted after Friday 12:00 goes to
the next week (the sheet is usually printed on Friday). A pending item not approved by the end of Shabbat leaves the
list; the message stays in Messages. The §14.4 guest rule still applies (mazal tov is left out of a guest's print
when guests may not see mazal tov).

**Trade-off, briefly.** Fully automatic is zero work and matches today's paper (two mazal tovs appear without anyone
deciding). But the sheet is printed, hung in the hall and sent as a WhatsApp image beyond the members, so a member's
typo, a wrong family or something a family wanted kept quiet goes out with the Kehila's name and logo on it. Approval
costs one tap per item, from the "לטיפול עכשיו" list the gabbai already opens, and if he does not tap, the item is
simply missing (the safe failure). Gabbai posts need no second look. The switch lets a Kehila that trusts its posters
choose automatic.

**Where the gabbai sees it.** Management › תפילות וזמנים › **הגיליון השבועי** (the row §18.3 already reserves). It
also replaces the "בגיליון השבוע" card in the §14.2 editor (that card now links here). Phone (P44 phones 1–3):

1. Back "תפילות וזמנים", title "הגיליון השבועי", caption "שבת פרשת {X} · {date} · מה שנכנס מתחת לזמנים".
2. **Fit card**: "נכנס בעמוד אחד" (olive check) or "{n} {items} לא נכנסים לגיליון" (gold alert), a link "תצוגה"
   (opens the P22 print preview), and three meters: מזל טוב "{n} מתוך 6", אירועים "{n} מתוך 3", תמונה נעוצה
   "יש / אין". Bars carry numbers; colour is never the only signal.
3. **ממתין לאישור** (pomegranate-edged list group with a count badge; only when something waits). Each item: type
   icon, the sheet line (surname bold), Tag "ממתין" + "פורסם בידי {name} · {when}", and two 40-high buttons:
   primary **"להוסיף לגיליון"**, secondary **"לא בגיליון"**. Either one moves the item at once and shows a Toast with
   "ביטול" ("נוסף לגיליון" / "לא ייכנס לגיליון").
4. **מזל טוב בגיליון · {n}** and **אירועים בגיליון · {n}**: one row per item in sheet order. Under the line, a source
   Tag: "אוטומטי" (olive; gabbai post), "אושר" (+ who approved), "נוסף בידי גבאי" (from §17.14 upcoming simchas),
   "פריט חופשי" (tekhelet), "לא נכנס" (gold dashed; over the limit, hatched row). A `more` button (44) opens the item
   Sheet; tapping the row does the same.
5. **תמונה נעוצה**: one row (the §14 pinned notice) → its existing picker.
6. Dashed button **"+ פריט לשבוע הזה"** → Sheet: Segmented מזל טוב / אירוע / הודעה, "שם המשפחה (מודגש)" (mazal tov
   only), "הטקסט", the line preview in paper colours, the note "לשבוע הזה בלבד. לא נשלחת הודעה ולא התראה.", and
   "הוספה לגיליון".
7. **כללים**: "מה שחברים מפרסמים" (value "אחרי אישור" / "אוטומטי"; Sheet with two `Choice` rows, saves on tap as
   §12.2) and "השתתפות בצער" (value "רק בהוספה"; read-only in v1, see open questions).

**Item Sheet** (P44 phone 3): "השורה בגיליון" `Field` (multi-line; the surname is kept bold: the field shows the
family as a separate bold token and the line is rebuilt around it), the paper-colour preview, "הזזה למעלה" / "הזזה
למטה" action rows (drag is never the only way), "פתיחת ההודעה" (to the message; hidden for free items), the danger
action **"הסרה מהגיליון"** (no confirm; Toast with "ביטול"), and "שמירה". A removed message item goes to a collapsed
"הוסרו השבוע ({n})" line at the end of its group, from which it can be put back.

**לטיפול עכשיו** (§18.3) gets one row while anything is pending: "{n} פריטים מחכים לאישור לגיליון" with the badge and
the caption "{types} · הגיליון של שבת {X}". It opens this screen scrolled to the pending group. The תפילות וזמנים row
in the 1280 sidebar shows the same badge.

**1280 glance** (P44 panel 5): sidebar as §18.3; the content column has the title with "הדפסה" and "שיתוף" buttons, the
lists on the start side, and on the end side a live A4 preview at 80% that redraws after each approve, remove, edit or
reorder.

**How the sheet shows them** (extends §14.5; A4 values, the square in brackets):

- **Order**: the gabbai's order; by default, mazal tov by posting time (oldest first, so early posters are not pushed
  out), events by date and time. Approving appends to the end.
- **Place**: mazal tov under the weekday column; events as tekhelet-bold lines under the pinned image in the Shabbat
  column. No pinned image: events head that column. No events and no image: mazal tov spans both columns (§14.5).
- **Line**: "מזל טוב ל{names} **{surname}**" / "ל{occasion} {name}" with the occasion icon (`heart`; `star` for bar/bat
  mitzvah), blessing as a third line when it fits. Event: "**{name}** · {day} {time} · {place}".
- **Max**: up to 6 mazal tov and 3 events on A4; with a pinned image, about 3 mazal tov fit in the weekday column (P44 A4 panel), and the fitting below decides (square: one band, up to 4 surnames: "מזל טוב: משפחת ניסיון · משפחת
  בדיוני · … ועוד 2"; events are not on the square, they go in the second picture with the pinned notice).
- **Fitting** (never a second page, never a clipped line). Before the §14.5 steps: (1) drop all blessing lines
  together; (2) the §14.5 steps (mazal tov 12, pinned image down to 30% of the height, rows 12.5); (3) items beyond
  the max or still not fitting are left out from the end of the order, and the last line reads "ועוד {n} ברכות
  באפליקציה" (9.5 muted). The gabbai sees those rows as "לא נכנס" and the gold fit card; he decides whether to remove,
  reorder or accept. Nothing is silently dropped.

**Home: "השבוע בקהילה"** (P44 phone 4). A `Card` under the schedule card (before the zmanim card): overline "השבוע
בקהילה · שבת {X}", the same items in the same order (mazal tov first, then events; up to 5 rows, then "ועוד {n}"),
each row tapping through to its message (free items have no target and are not buttons), and the link "הגיליון
להדפסה". It follows each viewer's visibility (a guest without mazal tov sees events only) and is hidden when empty.
Pending items never show. This is one list: the sheet and Home cannot disagree.

### 19.4 Kehila logo (P45)

**Where:** management › הגדרות הקהילה, first row **"לוגו הקהילה"** (72 high): the logo itself at 40 as the row's
icon (or the letter tile), status "הועלה ב־{date} · בסרגל, בגיליון ובהזמנות" or, in gold, "אין לוגו · מוצגת האות
{letter}". Tap → Sheet (phone) or a side panel (≥ 1024).

**The Sheet** (P45 phone 2): current logo at 112 on its white tile with "512×512 · 38KB" and "הועלה בידי {name} ב־
{date}"; **"איפה הוא מופיע"**, four small true-to-size previews: top bar in light and dark (32), the weekly sheet
header (66 on paper; also the WhatsApp square), the Kehila menu (44), and the invite landing (M11) and link preview;
then the rules box; footer: primary **"החלפת הלוגו"** ("העלאת לוגו" when there is none) and the danger text action
**"הסרת הלוגו"** with an inline confirm Banner ("…ובמקומו תוצג האות א. אפשר להעלות שוב בכל עת." / "הסרה" / "ביטול").
Without a logo the Sheet shows the letter tile at 96 and the line "בינתיים מוצגת האות הראשונה של שם הקהילה, על
תכלת."

**Upload flow.**
1. Source: phone → a small Sheet "מהתמונות" / "מהקבצים"; web → file chooser or drop on the panel's drop zone
   ("גוררים לכאן קובץ PNG או JPEG"). No camera.
2. **Crop** (P45 phone 3), full-screen on a dark backdrop: a 310 square frame with a rule-of-thirds grid over a
   checkerboard (shows transparency); drag to move, pinch or the zoom slider (with − / + buttons, 44) to scale,
   `rotate` 90°. Live previews at 32, 44 and 66 on white tiles. Caption "יישמר כ־PNG בגודל 512×512." Buttons "ביטול"
   / "שמירה". Keyboard (web): arrows move 1 px (Shift 10), +/− zoom, R rotates, Enter saves, Esc cancels.
3. On save the app crops, scales to 512 (or to the cropped side if it is smaller, never up-scales), and encodes PNG.
   If the PNG is over 64KB it retries at 384 and 256, then quantises colours; if still over, it shows an error.
4. Upload with the button busy ("שומרים"), then Toast "הלוגו עודכן. אצל כולם הוא יתחלף תוך כמה דקות." The new
   `logoVersion` invalidates `logoCache` on every device on its next Kehila fetch.

**Rules (from `server/cloud/logo.py`)**: the server accepts **PNG only, square, 64 to 512 px a side, at most 65,536
bytes**. The UI therefore accepts **PNG or JPEG** (owner's request; HEIC from iPhone arrives as JPEG through the
picker) up to 10MB as input, and always sends a square PNG within those limits. Rules box copy: "PNG או JPEG, עד 10MB
מהטלפון. חותכים לריבוע באפליקציה. נשמר כ־PNG ריבועי, 64 עד 512 פיקסלים, עד 64KB (מקטינים בשבילכם). הכי טוב: סמל
פשוט על רקע לבן או שקוף, בלי טקסט קטן."

**Display rule:** the logo always sits on a white rounded tile (`contain`, 2 px inset, `k.line` hairline), also in
dark mode, because most logos are drawn for white. Fallback everywhere is the existing tekhelet letter tile (§11,
§14.5).

**Errors** (error `Banner` in the Sheet; the previous logo stays): wrong format "אפשר להעלות PNG או JPEG." (+ what
was chosen); too small after crop "התמונה קטנה מדי…צריך לפחות 64×64"; too detailed "הלוגו מפורט מדי לגודל המותר…";
network/server "לא הצלחנו לשמור את הלוגו. הלוגו הקודם נשאר…". A server 400 maps to the matching message, not raw text.

**For the developer:** today the logo can only be written by the admin tool; this needs a gabbai-authorised write
(and delete) endpoint next to the existing `GET` in `server/cloud/routes_core.py`, validated by the same
`validate_logo`, bumping `logoVersion`. Not designed here.

### 19.5 Accessibility

- Compose: see §19.2. Template chips and Segmented are radios; required errors are announced on publish.
- Sheet items: pending buttons read "להוסיף לגיליון: מזל טוב למשפחת ניסיוני"; rows read "{line}. {source}. פריט {i}
  מתוך {n}"; moving an item announces "הועבר למקום {i} מתוך {n}"; the fit card is a polite live region (it changes
  after approve/remove). "לא נכנס" is a word, not only hatching.
- Logo: the crop area is labelled "אזור החיתוך. גוררים להזזה, צובטים להגדלה"; the slider has `accessibilityRole=
  "adjustable"` with increment/decrement; the previews are `aria-hidden` (the same image). The logo image has the
  label "לוגו {kehila}".
- All targets ≥ 48 on phone (chips 40 + hit slop to 48; item `more` 44 inside a 56 row).

### 19.6 Components

- **`TemplateForm`** (new, Compose): renders a template's fields from a small schema (`{ key, kind: text|date|time|
  chips|family, required, labelByOccasion }`) and returns `fields`; `buildMessage(templateId, fields, lang)` and
  `buildSheetLine(...)` are pure functions shared with the sheet and Home, unit-testable.
- **`TemplatePreview`** (new): the existing `MessageRow` in a dashed box + the paper-style sheet line.
- **Chip row that wraps** (kit `Chip size="filter"` in a wrapping row, radio): reused by templates.
- **`SheetItemRow`** (new, management): icon, line, source Tag, `more`, or the two pending buttons.
- **`FitCard`** (new): the meter rows; uses the §14.5 fitting result (`SheetClassic` must expose which items fit).
- **`WeekCard`** (new, Home): "השבוע בקהילה".
- **`LogoTile`** (kit): image on white tile or the letter fallback at any size; replaces the ad-hoc logo in TopBar,
  Kehila menu, sheet and invite.
- **`LogoCropper`** (new): pan/zoom/rotate square crop + export to PNG with the size loop.
- Reused: `Segmented`, `Field`, `Card`, `ListGroup`/`NavRow` (§18.5), `Sheet`, `Banner`, `Toast`, `Tag`, `Button`.
  Icons to add: `tpl`, `pen`, `image`, `eyeoff`, `zoomin`, `zoomout`, `rotate`, `undo` (frame sprite has them).

### 19.7 Copy

| Key | Hebrew | English |
|---|---|---|
| `compose.tpl.mode` / `.template` / `.free` | איך כותבים / מילוי תבנית / טקסט חופשי | How to write / Fill a template / Free text |
| `compose.tpl.optional` | (לא חובה) | (optional) |
| `compose.tpl.preview` / `.previewSheet` | כך תיראה ההודעה / בגיליון השבועי | How the message will look / On the weekly sheet |
| `compose.tpl.sheetAuto` / `.sheetPending` | נכנס לגיליון מיד (פורסם בידי גבאי) / ייכנס לגיליון אחרי אישור הגבאים | Goes on the sheet now (posted by a gabbai) / Goes on the sheet once a gabbai approves |
| `compose.tpl.required` | צריך למלא {field} | Please fill in {field} |
| `compose.tpl.copied` | הנוסח מהתבנית הועתק לכאן. אפשר לערוך אותו חופשי. הפרטים בתבנית נשמרים אם חוזרים אליה. | The template text was copied here. Edit it freely. Your template details are kept if you switch back. |
| `compose.tpl.choose` | תבנית | Template |
| `tpl.event.name` / `.date` / `.time` / `.place` / `.for` / `.organisers` / `.more` | שם האירוע / יום ותאריך / שעה / מקום / למי / מארגנים / פרטים נוספים | Event name / Day and date / Time / Place / For whom / Organisers / More details |
| `tpl.event.forAll` / `.men` / `.women` / `.youth` / `.kids` | לכולם / גברים / נשים / נוער / ילדים | Everyone / Men / Women / Youth / Children |
| `tpl.mazal.occasion` / `.whose` / `.name` / `.parents` / `.blessing` / `.other` | השמחה / השמחה של / שם {who} / ההורים / שורת ברכה / איזו שמחה | Occasion / Whose simcha / {who}'s name / Parents / Blessing line / Which simcha |
| `tpl.mazal.birthSon` / `.birthDaughter` / `.barMitzvah` / `.batMitzvah` / `.engagement` / `.wedding` / `.otherChip` | הולדת בן / הולדת בת / בר מצווה / בת מצווה / אירוסין / חתונה / אחר | Birth of a son / Birth of a daughter / Bar mitzvah / Bat mitzvah / Engagement / Wedding / Other |
| `tpl.mazal.parentsChip` / `.grandparentsChip` | ההורים / הסבים | Parents / Grandparents |
| `tpl.mazal.blessingHint` | הצעה לפי השמחה. אפשר לשנות או למחוק. | Suggested for this occasion. Change or delete it. |
| `tpl.mazal.title` | מזל טוב למשפחת {surname} | Mazal tov to the {surname} family |
| `tpl.condolence.deceased` / `.relation` / `.address` / `.hours` / `.until` / `.prayers` | הנפטר/ת / קרבה / כתובת השבעה / ניחום אבלים בשעות / השבעה עד / זמני תפילה בבית האבלים | The deceased / Relation / Shiva address / Visiting hours / Shiva until / Prayer times at the shiva house |
| `tpl.condolence.variant` / `.vOnly` / `.vLater` / `.vFull` / `.laterLine` | מה כוללת ההודעה / פטירה בלבד / שבעה בהמשך / עם פרטי השבעה / פרטי השבעה יימסרו בהמשך. | What the notice includes / Passing only / Shiva details later / With shiva details / Shiva details will follow. |
| `msg.update.only` / `.shiva` / `.event` / `.save` / `.back` | רק את/ה והגבאים רואים את זה / עדכון פרטי השבעה / עדכון פרטי האירוע / שמירת העדכון / ההודעה | Only you and the gabbaim see this / Update shiva details / Update event details / Save the update / The message |
| `msg.update.notify` / `.notifyHelp` | להודיע לחברים על העדכון / התראה שקטה אחת: "עודכנו פרטי השבעה · משפחת {surname}" | Let members know / One quiet notification: "Shiva details updated · {surname} family" |
| `msg.updated` / `.changed` / `.updatedLine` | עודכן {time} / שונה {time} / עודכן ב־{time}: נוספו פרטי השבעה · פורסם לראשונה ב־{first} | Updated {time} / Changed {time} / Updated {time}: shiva details added · first posted {first} |
| `push.shivaUpdated` / `push.eventChanged` | עודכנו פרטי השבעה · משפחת {surname} / שינוי ב{event}: {what} | Shiva details updated · {surname} family / Change to {event}: {what} |
| `msg.cancelled` | בוטל | Cancelled |
| `tpl.condolence.closing` | המקום ינחם אתכם בתוך שאר אבלי ציון וירושלים. | May the Almighty comfort you among the mourners of Zion and Jerusalem. |
| `sheetItems.title` / `.caption` | הגיליון השבועי / שבת פרשת {parasha} · {date} · מה שנכנס מתחת לזמנים | Weekly sheet / Shabbat {parasha} · {date} · what goes under the times |
| `sheetItems.fits` / `.over` / `.preview` | נכנס בעמוד אחד / {n} פריטים לא נכנסים לגיליון / תצוגה | Fits on one page / {n} items don't fit / Preview |
| `sheetItems.meter.mazal` / `.events` / `.image` / `.of` | מזל טוב / אירועים / תמונה נעוצה / {n} מתוך {max} | Mazal tov / Events / Pinned image / {n} of {max} |
| `sheetItems.pending` / `.add` / `.skip` | ממתין לאישור / להוסיף לגיליון / לא בגיליון | Waiting for approval / Add to the sheet / Not on the sheet |
| `sheetItems.added` / `.skipped` / `.undo` | נוסף לגיליון / לא ייכנס לגיליון / ביטול | Added to the sheet / Won't go on the sheet / Undo |
| `sheetItems.src.auto` / `.approved` / `.byGabbai` / `.free` / `.out` / `.postedBy` | אוטומטי / אושר / נוסף בידי גבאי / פריט חופשי / לא נכנס / פורסם בידי {name} | Automatic / Approved / Added by a gabbai / Free item / Doesn't fit / Posted by {name} |
| `sheetItems.groupMazal` / `.groupEvents` / `.groupImage` / `.removed` | מזל טוב בגיליון / אירועים בגיליון / תמונה נעוצה / הוסרו השבוע ({n}) | Mazal tov on the sheet / Events on the sheet / Pinned image / Removed this week ({n}) |
| `sheetItems.addFree` / `.freeNote` / `.freeSurname` / `.freeText` / `.addBtn` | פריט לשבוע הזה / לשבוע הזה בלבד. לא נשלחת הודעה ולא התראה. / שם המשפחה (מודגש) / הטקסט / הוספה לגיליון | Item for this week / This week only. No message or notification is sent. / Family name (bold) / Text / Add to the sheet |
| `sheetItems.item.title` / `.line` / `.lineHelp` / `.up` / `.down` / `.open` / `.remove` | פריט בגיליון / השורה בגיליון / משנה רק את הגיליון ואת "השבוע בקהילה". ההודעה עצמה לא משתנה. / הזזה למעלה / הזזה למטה / פתיחת ההודעה / הסרה מהגיליון | Sheet item / Line on the sheet / Changes only the sheet and "This week". The message itself stays. / Move up / Move down / Open the message / Remove from the sheet |
| `sheetItems.rule.members` / `.approve` / `.auto` / `.condolence` / `.onlyAdded` | מה שחברים מפרסמים / אחרי אישור / אוטומטי / השתתפות בצער / רק בהוספה | What members post / After approval / Automatic / Condolences / Only when added |
| `sheetItems.rule.approveNote` / `.autoNote` | ברירת המחדל. נגיעה אחת "להוסיף לגיליון" בלטיפול עכשיו. / כמו הודעות של גבאים. אפשר תמיד להסיר מהגיליון. | Default. One tap "Add to the sheet" in Needs attention. / Like gabbai posts. You can always remove an item. |
| `sheetItems.empty` | אין השבוע מזל טוב או אירועים בגיליון. | No mazal tov or events on the sheet this week. |
| `admin.todo.sheet` / `.sheetCaption` | {n} פריטים מחכים לאישור לגיליון / {types} · הגיליון של שבת {parasha} | {n} items waiting for the sheet / {types} · Shabbat {parasha} sheet |
| `sheet.more` | ועוד {n} ברכות באפליקציה | {n} more in the app |
| `home.week.title` / `.more` / `.print` | השבוע בקהילה · שבת {parasha} / ועוד {n} / הגיליון להדפסה | This week · Shabbat {parasha} / {n} more / Printable sheet |
| `logo.row` / `.rowSet` / `.rowNone` | לוגו הקהילה / הועלה ב־{date} · בסרגל, בגיליון ובהזמנות / אין לוגו · מוצגת האות {letter} | Community logo / Uploaded {date} · top bar, sheet and invites / No logo · showing the letter {letter} |
| `logo.current` / `.meta` / `.where` | הלוגו הנוכחי / הועלה בידי {name} ב־{date} / איפה הוא מופיע | Current logo / Uploaded by {name} on {date} / Where it appears |
| `logo.where.top` / `.sheet` / `.menu` / `.invite` | סרגל עליון / גיליון שבועי / תפריט הקהילה / הזמנה (קישור ודף ההצטרפות) | Top bar / Weekly sheet / Community menu / Invite (link and join page) |
| `logo.none` | בינתיים מוצגת האות הראשונה של שם הקהילה, על תכלת. | For now, the first letter of the community's name is shown. |
| `logo.upload` / `.replace` / `.remove` | העלאת לוגו / החלפת הלוגו / הסרת הלוגו | Upload a logo / Replace the logo / Remove the logo |
| `logo.rules` | PNG או JPEG, עד 10MB מהטלפון. חותכים לריבוע באפליקציה. נשמר כ־PNG ריבועי, 64 עד 512 פיקסלים, עד 64KB (מקטינים בשבילכם). הכי טוב: סמל פשוט על רקע לבן או שקוף, בלי טקסט קטן. | PNG or JPEG, up to 10MB. You crop it to a square here. Saved as a square PNG, 64 to 512 pixels, up to 64KB (we shrink it for you). Best: a simple mark on white or transparent, no small text. |
| `logo.source.photos` / `.files` / `.drop` | מהתמונות / מהקבצים / גוררים לכאן קובץ PNG או JPEG | From photos / From files / Drop a PNG or JPEG here |
| `logo.crop.title` / `.zoom` / `.rotate` / `.note` / `.area` | חיתוך לריבוע / הגדלה / סיבוב / יישמר כ־PNG בגודל {size}×{size}. / אזור החיתוך. גוררים להזזה, צובטים להגדלה | Crop to a square / Zoom / Rotate / Saved as a {size}×{size} PNG. / Crop area. Drag to move, pinch to zoom |
| `logo.saving` / `.saved` | שומרים / הלוגו עודכן. אצל כולם הוא יתחלף תוך כמה דקות. | Saving / Logo updated. Everyone will see it within a few minutes. |
| `logo.removeConfirm` | להסיר את הלוגו? הוא יוסר מהסרגל, מהגיליון ומההזמנות, ובמקומו תוצג האות {letter}. אפשר להעלות שוב בכל עת. | Remove the logo? It will be removed from the top bar, sheet and invites, and the letter {letter} shown instead. You can upload again any time. |
| `logo.err.format` / `.small` / `.big` / `.save` | אפשר להעלות PNG או JPEG. / התמונה קטנה מדי. צריך לפחות 64×64 פיקסלים אחרי החיתוך. / הלוגו מפורט מדי לגודל המותר. נסו גרסה פשוטה יותר (פחות פרטים, רקע אחיד). / לא הצלחנו לשמור את הלוגו. הלוגו הקודם נשאר. | Please upload a PNG or JPEG. / The image is too small: at least 64×64 pixels after cropping. / The logo is too detailed for the size limit. Try a simpler version. / We couldn't save the logo. The previous one stays. |

### 19.8 What this supersedes

- §14.2 editor's **"בגיליון השבוע"** card (mazal tov checklist, pinned image): its content moves to הגיליון השבועי
  (§19.3); the editor keeps a link and the candle-city and template choices.
- §14.5 **fitting**: the new first step (drop blessing lines) and the "ועוד {n}" line are added before/after it.
- §17.14 "הוספה למזל טוב בגיליון השבועי" now adds a gabbai item (source "נוסף בידי גבאי"), no separate confirm.
- §18.3 **לטיפול עכשיו** gains the sheet row; **הגדרות הקהילה** gains "לוגו הקהילה" as its first row.
- M4 / §12.3 Compose: unchanged apart from "איך כותבים", template fields, the preview and the update mode (§19.2a).
- M3 message view: gains the author/gabbai update card and the "עודכן" meta and caption line (§19.2a).

### 19.9 Open questions

Owner decisions (2026-10-28): approval default "אחרי אישור של גבאי" (gabbai posts automatic), Friday 12:00 cut-off,
logo on a white tile, template editor later. Second round, same day:

1. Condolences on the sheet: **a gabbai's condolence goes on automatically**, like his mazal tov and events; a
   member's condolence follows the approval setting like the rest of the second row (§19.3 table updated).
2. Shiva update: **yes**, the message moves to the top once and one quiet push goes out (as §19.2a).
3. Events: **yes**, "עדכון פרטי האירוע" (time/place change, cancel) is adopted as proposed in §19.2a.
4. **The bereaved family may update the shiva details too:** the adults of the family the condolence names
   (`targetFamilyId`) get the same "עדכון פרטי השבעה" action as the author and gabbaim. A condolence for a family
   picked without a registered family (free text) can be updated by the author and gabbaim only.

### 19.10 Verification

Rendered with headless Chromium (Playwright 1.47.2), one browser: P43 phones 1–4, P44 phones 1–4 and P45 phones 1–3 at
390 × 844, light and dark (PNGs in `/tmp/claude-1000/kehilot-shots-templates/`), and the P44 and P45 1280 glances
in both themes. Checked: no horizontal scroll at 390 (scrollWidth 390 on all three frames), crop square, previews,
meters and source tags readable in dark mode, and the A4 bottom does not run into the footer. Fixed during the
check: meter bars took the page header's `.bar` class (renamed), the A4 panel widened the page at 390, the logo
panel overflowed at 1280, bidi order of "38 / 50" and of the hours placeholder, and the A4 sample now shows 3 mazal
tov + "ועוד 3" (4 did not fit beside the pinned image). After the owner's second round, P43 phones 4–7 (variants, message view
with the update card, update form) were rendered the same way, light and dark. Not checked: real devices, 360-wide Android, English (LTR),
screen readers, web fonts (the shots may use fallback fonts), the Hebrew grammar of the built phrases (needs a
native editor), and the PNG size loop on real logos.

## 20. The "טכני" (Tech) role

> **Owner override (2026-10-28, binding; supersedes §20.1–§20.3, §20.5 rules 1–2 and 7 (tech may be given by invite and import; invites still never give gabbai), and §20.9):** "a tech is superman, he
> can do all things". A tech has **every permission a gabbai has**, including granting and changing the gabbai role,
> accepting the Kehila terms, removing messages and seeing phones, seat names and all personal data a gabbai sees. The
> only differences are display: the role is labelled "טכני" (Tech) wherever a role or attribution shows (§20.4, §20.6
> wording, §20.7 copy), and a tech is never shown to members as "גבאי". The last-manager rule becomes "at least one
> gabbai or tech remains". The hall map, management and every screen are the gabbai's, unchanged. §20.1's ✗ rows and the
> P46 phones 2–5 no longer apply; phone 1 (the picker, with טכני as a fourth option) and the copy remain.

Added 2026-10-28 from the owner's decision of the same day. Frames: `P46` (`tech-role.html`: phone 1 the role picker as a
gabbai sees it, 2 as a tech sees it, 3 management as a tech sees it, 4 a gabbai's card as a tech sees it, 5 the hall
map without names), at 390 × 844, light and
dark. All names are invented. Like §18, this pass adds a role and moves no feature. Every screen stays where §18 put
it, and a tech sees the gabbai's screens with some rows hidden.

**Why.** The owner runs the app technically, but today only a gabbai can change anything, and he does not want to
be a gabbai. Role tags (§12.6) are labels and give no rights. So there is now a fourth role, stored as `tech` and
shown as **"טכני"**.

**The principle (owner, binding).** A tech gets the community's **configuration and operations**, and **no personal
data about people**. He sees names and roles, because he approves people and changes roles. He does not see phones
that are not public to everyone, families, family trees, children, who sits where, healing names, simchas,
aliyot or private replies. He is never shown to members as a gabbai.

| | גבאי | טכני |
|---|---|---|
| Kehila settings, logo, invites, groups, templates | ✓ | ✓ |
| Prayer times, weekly sheet, seat-map hall layout | ✓ | ✓ |
| Approve members, change roles | ✓ | ✓, but cannot make anyone a gabbai and cannot change a gabbai's role |
| Members' phones, who sits where by name, private replies | ✓ | ✗ |
| Shown to members as | "גבאי" | "טכני", never as gabbai |

**A tech is also a member.** He has a family, a tree, a seat form, Mi Sheberach and the phone list, exactly as a
member does: he sees only the numbers members chose to show to everyone. Server rule for the developer: every role
set that means "an adult with a family" (today `('member', 'gabbai')` in `routes_families`, `routes_tree`,
`routes_privacy`, `routes_seatweek` (`get_mine`/`put_mine`), `routes_messages` (directory, target families, join,
replies), `routes_invites`, `repo_families`, `push_worker`, `visibility.can_target`) becomes
`('member', 'gabbai', 'tech')`. `visibility.is_gabbai` stays gabbai-only. It decides reading every channel, being
an implicit admin of every group, and removing any message, and a tech gets none of these (§20.6).

### 20.1 Inventory: every gabbai-only thing, tech ✓ or ✗

How to read it: **✓** = same as a gabbai. **✓ filtered** = allowed, but the response or the screen drops the fields
named. **✗** = 403 `forbidden` from the API, and the row or screen is not rendered for a tech. Each line is meant to
become one test: call the route as a tech and expect the result in the last column.

**Members and joining**

| # | Screen / row (§18.3) | API | Tech | Expect / what tech sees |
|---|---|---|---|---|
| 1 | חברים ומשפחות › בקשות הצטרפות; tab אישורים | `GET admin/requests` | ✓ filtered | 200; rows without `seatSuggestions` (holder names) |
| 2 | Approve with classification (א / קבוע) | `POST admin/requests/{u}/approve` | ✓ | 200. The auto-link (§16.7) still runs on the server, but its notice and undo show to gabbaim only |
| 3 | Keep as guest / reject | `POST admin/requests/{u}/reject` | ✓ | 200 |
| 4 | Member list (tab חברים; row "ספר החברים", for tech titled "חברים ותפקידים") | `GET admin/members` | ✓ filtered | 200; each row without `phone` and `showPhone`. Name, role, classification, broadcast, groups, tags remain |
| 5 | Member card › family block: adults, phones, call / WhatsApp, children, "עץ המשפחה ›" (P11) | `GET admin/families` | ✗ | 403; the block is not rendered |
| 6 | Family tree, read-only view (§17.11) | `GET admin/families/{f}/tree` | ✗ | 403 |
| 7 | "קישור לבן/בת זוג" (P11) | `POST admin/families/link` | ✗ | 403 |
| 8 | Role picker (§20.4) | `PUT admin/members/{u}` `{role}` | ✓ with rules | 200 for member ↔ tech on a member or a tech. 403 `gabbai_only` if the new role is `gabbai` or the target is a gabbai |
| 9 | Classification, groups, broadcast switch on a member | `PUT admin/members/{u}` (other fields) | ✓ | 200, on any target including a gabbai (these are not his role) |
| 10 | "הסרה מהקהילה" | `DELETE admin/members/{u}` | ✓ with rule | 204 for a listener, member or tech; 403 `gabbai_only` for a gabbai |
| 11 | "התר לכולם / חסום לכולם" | `PUT admin/broadcast` | ✓ | 200 |
| 12 | תגיות תפקיד: list, create, rename, delete, assign | `admin/tags*`, `PUT admin/members/{u}/tags` | ✓ | 200 (tags are labels, set by staff, §12.6) |
| 13 | קבוצות: list, create, rename, delete, appoint / remove admins | `admin/groups*` | ✓ | 200 |
| 14 | Group join requests and group members (management › קבוצות) | `groups/{g}/requests*`, `groups/{g}/members*` | ✓ | 200, as if he were the admin of every group **for membership only**. It does not open the group's channels to him (§20.6) |
| 15 | הזמנות: create (listener / member), list all, revoke any | `invites` | ✓ | as a gabbai: no 3-link cap, every link listed. There is no tech or gabbai invite for anyone (400 `invalid_role`). `accept` must treat a tech inviter like a gabbai inviter for member links |
| 16 | ייבוא רשימה | `POST admin/import` | ✓ with rule | 200; a row with role גבאי is reported as a row problem `gabbai_only` when a tech imports. Import has no tech role (tech is given only in the app, §20.5) |

**Settings, times, sheet, messages**

| # | Screen / row | API | Tech | Expect |
|---|---|---|---|---|
| 17 | הגדרות הקהילה: תקרת מאזינים, איש קשר לפרטיות, מיקום וזמנים, הגיליון, מועד מקומות, מה שחברים מפרסמים | `PUT admin/settings` (every key) | ✓ | 200 |
| 18 | לוגו הקהילה (§19.4) | logo upload / remove | ✓ | 200 |
| 19 | התנאים בין הקהילה לבין קהילות: accept | `POST admin/terms` | ✗ | 403. The row shows who accepted and when (read-only). Until a gabbai accepts, the tech sees the gate text without the button (`admin.terms.waitGabbai`) |
| 20 | עריכת זמני התפילות, weeks | `PUT admin/schedule`, `admin/schedule/weeks/*` | ✓ | 200 |
| 21 | הגיליון השבועי: approve, remove, edit line, reorder, free item | `admin/sheet/*` | ✓ | 200. Pending items show the poster's name and the line, which were written to be published |
| 22 | ערוצים, סוגי הודעות | `admin/channels*`, `typeRules` | ✓ | 200 |
| 23 | נוסח ההתראות | `admin/push-texts` | ✓ | 200 |
| 24 | תבניות הודעה (future, §19.2) | — | ✓ | — |
| 25 | הודעה חדשה, as management (always allowed, `post: management` types) | `POST messages` | ✓ | 201; goes on the sheet automatically (§20.6) |
| 26 | Read every channel (moderation) | `visibility.can_read_channel` | ✗ | reads like a member: only the channels his groups and role open |
| 27 | Remove someone else's message | `DELETE messages/{m}` | ✗ | 403 for another author's message; 204 for his own |
| 28 | Management tab "הודעות" (all messages, "member broadcasts" filter, GD6) | — | ✗ | tab not rendered; his own Messages tab and its type filter (P40) are the member's |
| 29 | Private replies to a family | `messages/{m}/replies` | ✗ | as for anyone outside the family (§6 flow 3) |
| 30 | Phone list, "לגבאים בלבד" numbers | `GET phone-list` | ✗ filtered | 200 with members who show their number to everyone, exactly as a member |

**Seating, simchas, names**

| # | Screen / row | API | Tech | Expect |
|---|---|---|---|---|
| 31 | עריכת מפת המקומות → for tech **"עריכת מבנה האולם"**: versions, open, save | `GET/PUT admin/seating/layouts*` | ✓ with rule | 200. A save that would drop or move an assigned seat → 409 `seat_taken` (§20.3) |
| 32 | Which seats are taken (for the editor) | `GET admin/seating/layouts/{from}/assignments` | ✓ filtered | 200 `{taken: [seatId…], updatedAt}`; no household refs |
| 33 | Assign mode: families panel, assign, move, clear | `PUT …/assignments` | ✗ | 403; the "שיבוץ משפחות" segment is not rendered |
| 34 | מחזיקי מקומות בלי חשבון (list, create, edit, seats, delete) | `admin/seating/holders*` | ✗ | 403 (names, phones) |
| 35 | Link suggestions, link holder, auto-links (list, undo, finish) | `admin/seating/link-suggestions`, `…/holders/{h}/link`, `…/auto-links*` | ✗ | 403 (they show names); not counted in his "לטיפול עכשיו" |
| 36 | מפת האולם להדפסה, עדכון בשם משפחה, this week's answers by family | `GET/PUT admin/seats/week/{w}` | ✗ | 403 (names per seat) |
| 37 | העלאת קובץ תשובות מהטופס, undo | `POST admin/seats/week/{w}/responses*` | ✗ | 403 (the file holds names) |
| 38 | Seat answers: Kehila-wide totals ("61 מתוך 84 ענו") | — | ✓ in principle | Counts without names are allowed, but not built in v1. The seating group's status line for a tech is the layout ("225 מקומות · בתוקף מ־י״ט באלול (1.9)"; dates follow the §2 rule) |
| 39 | שמחות קרובות (§17.14) | `GET admin/simchas` | ✗ | 403 (children's names and birthdays from the trees). The whole group **שמחות ועליות** is hidden |
| 40 | עליות לתורה (reserved) | — | ✗ | names, the name for an aliyah, history per person |
| 41 | Combined Mi Sheberach / healing names list (§17.15, GD7) | — | ✗ | names of the sick |
| 42 | Push "family_gabbai", gabbai edits of a family | — | ✗ | — |

**Pushes a tech gets:** join requests (`request`), and group join requests where a group has no admin (with the
gabbaim). The M5 management toggles apply to him as to a gabbai.

### 20.2 Management as a tech sees it (P46 phone 3)

Same screen, same order and same six groups as §18.3, with rows hidden. **A group with no row left is hidden.**
Nothing is greyed out or locked: a tech does not see what he cannot open.

| Group | For a tech | Status line for a tech |
|---|---|---|
| תפילות וזמנים | both rows | as gabbai |
| מקומות ישיבה | only **"עריכת מבנה האולם"** (the "השבוע" block and "מחזיקי מקומות" are hidden; there is no summary card) | "{n} מקומות · בתוקף מ־{date}" |
| הודעות וערוצים | all rows | as gabbai |
| שמחות ועליות | **hidden** (both rows ✗) | — |
| חברים ומשפחות | בקשות הצטרפות · **חברים ותפקידים** (the member book without phones and families) · תגיות תפקיד · קבוצות · הזמנות · ייבוא רשימה | "{n} חברים · {n} מאזינים" |
| הגדרות הקהילה | לוגו הקהילה · תקרת מאזינים · איש קשר לפרטיות · התנאים (read-only: "אושרו ב־{date} · {name}") | as gabbai |

- **Tabs:** סקירה · אישורים · חברים. The management "הודעות" tab (moderation) is not rendered. Compose is reached from
  הודעות וערוצים › הודעה חדשה and from his own Messages tab.
- **לטיפול עכשיו** counts only what a tech can act on: join requests · this week's times not published · sheet
  items waiting · group join requests he receives. It never counts seat link suggestions, holder hints or
  auto-link notices. When none of these wait, the tech sees "אין משהו שממתין לכם." even if a gabbai has seat items.
- **The logo dot** in the top bar and the badge on "ניהול הקהילה" in the Kehila menu use the same count.
- **Wide (1280):** the same sidebar with the same rows hidden.
- **Member card for a tech** (from "חברים ותפקידים" or the tab): name, role Tag, tags, classification, groups,
  broadcast switch, the **"תפקיד"** row (§20.4) and "הסרה מהקהילה" (hidden for a gabbai target). No phone, no list
  state, no family line, no tree link, no partner link.

### 20.3 The hall map for a tech (P46 phone 5)

A tech edits the **shape** of the hall: rows, columns, aisles, bimah, ark, block names and row labels. He never sees
who sits where.

- **Entry:** מקומות ישיבה › "עריכת מבנה האולם" (status "בתוקף מ־{date} · נוח יותר במחשב", `dualDate`). On the web it opens the
  §16.4 editor **in Layout mode only**. The "שיבוץ משפחות / מבנה האולם" segment is not rendered. Next to the title,
  a Tag says **"בלי שמות"**.
- **Cells:** a **taken** seat is filled (tekhelet tint, solid 1 px line) and reads "תפוס" at 100%. A **free** seat
  keeps the §16.4 dashed line and "פנוי". No name, initial, pasted text or count per household appears anywhere: not
  on hover, in a tooltip, in the history diff or in the screen-reader label ("גוש מערבי, שורה 4, מקום תפוס"). Seats
  are told apart by shape and word, never by colour alone.
- **Side panel:** no households list, no search, no selected-family card. Instead there are **totals** (מקומות 225 ·
  תפוסים 198 · פנויים 27 · גושים 6 · שורות 14), the legend, the palette (מושב · מעבר · בימה · ארון · ריק) and "הגדרת
  גוש…" / "שם לשורה…".
- **What he may change:** add a row or a column. Turn an empty cell or an aisle into a seat (it starts free). Turn
  a **free** seat into anything. Move the bimah or the ark onto empty cells. Rename blocks and rows. Delete a row or
  column only when it holds no taken seat.
- **What he may not change: a taken seat.** Tapping a taken seat with any palette tool other than "מושב" does
  nothing to it. The cell gets a gold outline, and a polite live line under the toolbar says "המקום תפוס. רק גבאי
  משנה מקום תפוס." When a dragged selection includes taken seats, the tool applies to the others and the line says
  "{n} מקומות תפוסים לא שונו".
- **Can a tech save a change that would move assignments? No.** Moving or dropping a family's seat without seeing
  whose it is would change a person's place blindly, and a family's seat is the most sensitive thing the map holds.
  Because of the rule above, the editor cannot build such a change. The server checks it anyway: `put_layout` from a
  tech whose new cells would prune any assignment returns 409 `seat_taken`, and nothing is saved. Hall changes that
  need moving people go to a gabbai, who does them in Assign mode.
- **Save, effective date, history, conflicts:** as §16.5, but the diff line gives counts only ("3 שינויים: שורה
  נוספה מאחור, 2 מקומות חדשים"). "שחזור" of an old version is offered only when it drops no taken seat. Otherwise
  it is disabled, with "השחזור יוריד {n} מקומות תפוסים. רק גבאי יכול לשחזר את הגרסה הזו." The conflict dialog names
  the other staff member with their role ("רינה ניסיון (גבאית)"). Staff names are fine, as in §16.5.
- **Phone** (as §16, view only): the whole hall with pinch zoom, taken and free only, **no names at any zoom**, the
  totals Card, and an info Banner: "עריכת מבנה האולם במחשב. שמות מוצגים לגבאים בלבד." There is no "משפחות" list.
- **Print:** "מפת האולם להדפסה" is not offered (it prints names).

### 20.4 Where the role shows

**Role picker (P46 phones 1–2).** On a member's card (management › חברים), one `NavRow` **"תפקיד"** with the value
("חבר/ת קהילה" / "טכני" / "גבאי") replaces today's "מינוי לגבאי" / "החזרה לחבר" buttons. Tapping it opens a Sheet
**"התפקיד של {name}"**:
- Rows are radio `Choice`s, 64 high, each with a one-line note under the title saying what the role can do (copy in
  §20.7). The current role is selected. Order: חבר/ת קהילה · טכני · גבאי.
- **A gabbai** sees all three.
- **A tech** sees חבר/ת קהילה · טכני only. The gabbai option is **not offered**: no disabled row. Under the list, one
  muted line with a `lock` icon says "מינוי לגבאי נעשה בידי גבאי."
- **A tech looking at a gabbai** (P46 phone 4): the "תפקיד" row shows "גבאי" with a lock and no chevron, status "רק גבאי משנה
  תפקיד של גבאי", and it does not open. "הסרה מהקהילה" is not rendered.
- **Listeners** have no role row, as today. A listener becomes a member only through approval (אישורים), and a tech
  may approve.
- Footer: one primary button named for the change: "מינוי לטכני" / "מינוי לגבאי" / "החזרה לחבר/ת קהילה". It is
  disabled while the current role is selected. There is no second confirm: the note above already says what changes.
  The result is a Toast "התפקיד עודכן".
- **Myself:** a tech may set himself to member, and a gabbai may set himself to tech or member. Then a warn Banner
  inside the Sheet says "תצאו ממצב ניהול מיד." When the last gabbai tries this, the `last_gabbai` error appears as a
  danger Banner inside the Sheet, and nothing changes.

**Members list.** The role Tag next to the name: "גבאי" (`ktag st`, tekhelet) and **"טכני"** (`ktag`, ash outline). A
member has no Tag. Filter chips: כולם · חברים · **טכני** · גבאים · מתפללים אורחים.

**Invites.** No invite gives tech (or gabbai): a role that sees management is given only to a person already in the
Kehila, from the picker, and never through a forwardable link. A tech's invite screen is the gabbai's: role מתפלל
אורח / חבר, uses, days, and all links listed. "של גבאי או חבר אחר" becomes "של מישהו אחר" (the link was not
necessarily made by a gabbai).

**Me and the Kehila menu.** In the details card the role line reads "טכני". The Kehila menu header shows the role
under the name. "ניהול הקהילה" is shown to gabbai **and tech**, with his count. On P13 על הקהילה, "התפקיד שלכם" shows
the Tag "טכני". The switcher row for that Kehila also says "טכני".

**Attribution to members.** A tech is never labelled "גבאי". Where the app names a role, it names his ("טכני").
Where a sentence would credit "the gabbai" for something a tech can also do, it becomes neutral:
- Compose caption (§19.2): "נכנס לגיליון מיד (פרסום של צוות הניהול)" for both gabbai and tech.
- The sheet source Tag "אוטומטי" already covers both. "נוסף בידי גבאי" stays, because only a gabbai adds from
  simchas.
- Schedule footer "עודכן בידי הגבאים ב־{date}" becomes "עודכנו ב־{date}".
- The seat-map conflict dialog shows "{name} ({role})".
- Texts about things only a gabbai does stay as they are ("המקומות שלכם עודכנו על ידי הגבאים", "רק הגבאים של
  {kehila} רואים אותו"), because they remain true.
**"צוות הניהול"** (management team) is the one collective term for gabbaim and techs. It is used only where a
sentence must cover both.

### 20.5 Rules

1. **At least one gabbai always remains.** The existing `last_gabbai` guard covers every way a gabbai stops being
   one: becoming tech, becoming member, being removed, leaving.
2. **A tech cannot appoint a gabbai and cannot change or remove a gabbai.** API: 403 `gabbai_only`.
3. **A gabbai can make anyone (member or tech) a tech**, and a tech a gabbai or member.
4. **A tech can make a member a tech, a tech a member** (himself included), approve a listener as a member, or keep
   them a guest. "Listener" is reached only through approvals, as today. No role is ever demoted to listener (unchanged
   `role_change_not_allowed`).
5. There is no limit on the number of techs. A tech can be appointed a group admin, like a member.
6. A tech's broadcast permission is always on and locked, as a gabbai's.
7. **Tech is given only in the app** (the picker): never by an invite link or by the list import.

### 20.6 Sheet and messages

**Agreed: a tech's posts go on the weekly sheet automatically, like a gabbai's.** He is staff, and the reason for
approving a member's post (a typo or a wrong family going out under the Kehila's name, §19.3) is about members, not
staff. §19.3's first row becomes "Gabbai or tech". `sheet_rules.initial_state` treats `tech` as `gabbai`.
`type_rules` `post: management` includes tech. A tech also approves, edits and orders sheet items.

**What a tech does not get in Messages:** reading channels outside his groups, removing other people's messages, and
the management Messages tab (GD6). Moderation is a judgement about people and content, so it stays with the
gabbaim. A tech who sees something wrong reports it to a gabbai (open question 2).

### 20.7 Copy

| Key | Hebrew | English |
|---|---|---|
| `role.tech` (in `switcher.role`, `me.details.role`, `admin.members.role`, `kehilaInfo`) | טכני | Tech |
| `admin.members.filter.tech` | טכני | Tech |
| `admin.role.row` / `.title` | תפקיד / התפקיד של {name} | Role / {name}'s role |
| `admin.role.member` / `.memberNote` | חבר/ת קהילה / משתמש/ת באפליקציה כרגיל, בלי מסכי ניהול. | Member / Uses the app as usual, without management. |
| `admin.role.tech` / `.techNote` | טכני / מגדיר/ה את הקהילה: זמנים, גיליון, מבנה האולם, ערוצים, קבוצות, הזמנות ואישור חברים. לא רואה טלפונים, משפחות או מי יושב איפה. | Tech / Sets up the Kehila: times, sheet, hall layout, channels, groups, invites and approving members. Doesn't see phones, families or who sits where. |
| `admin.role.gabbai` / `.gabbaiNote` | גבאי / מנהל/ת את הקהילה ורואה גם את פרטי החברים: טלפונים, משפחות ושמות במפת המקומות. | Gabbai / Runs the Kehila and also sees members' details: phones, families and names on the seat map. |
| `admin.role.gabbaiOnly` | מינוי לגבאי נעשה בידי גבאי. | Only a gabbai can appoint a gabbai. |
| `admin.role.locked` | רק גבאי משנה תפקיד של גבאי | Only a gabbai can change a gabbai's role |
| `admin.role.toTech` / `.toGabbai` / `.toMember` | מינוי לטכני / מינוי לגבאי / החזרה לחבר/ת קהילה | Make tech / Make gabbai / Back to member |
| `admin.role.self` | תצאו ממצב ניהול מיד. | You'll leave management right away. |
| `admin.role.saved` | התפקיד עודכן | Role updated |
| `errors.gabbai_only` | רק גבאי יכול לעשות את זה. | Only a gabbai can do this. |
| `errors.role_change_not_allowed` | אפשר לשנות תפקיד רק בין חבר, טכני וגבאי | Roles change only between member, tech and gabbai |
| `errors.seat_taken` | המקום תפוס. רק גבאי משנה מקום תפוס. | This seat is taken. Only a gabbai can change a taken seat. |
| `admin.row.membersTech` / `.membersTechSub` | חברים ותפקידים / שם, תפקיד, קבוצות ותגיות | Members and roles / Name, role, groups and tags |
| `admin.row.hallLayout` / `admin.area.seats.techStatus` | עריכת מבנה האולם / {n} מקומות · בתוקף מ־{date} | Edit the hall layout / {n} seats · from {date} |
| `seatmap.tech.noNames` / `.taken` / `.free` | בלי שמות / תפוס / פנוי | No names / Taken / Free |
| `seatmap.tech.skipped` | {n} מקומות תפוסים לא שונו | {n} taken seats were not changed |
| `seatmap.tech.phone` | עריכת מבנה האולם במחשב. שמות מוצגים לגבאים בלבד. | Edit the hall layout on a computer. Names are shown to gabbaim only. |
| `seatmap.tech.restoreBlocked` | השחזור יוריד {n} מקומות תפוסים. רק גבאי יכול לשחזר את הגרסה הזו. | Restoring would remove {n} taken seats. Only a gabbai can restore this version. |
| `seatmap.conflict.body` | {name} ({role}) שמר/ה את המפה ב־{time}, אחרי שפתחתם אותה. | {name} ({role}) saved the map at {time}, after you opened it. |
| `admin.terms.waitGabbai` | גבאי צריך לאשר את התנאים לפני שמסכי הניהול נפתחים. | A gabbai must accept the terms before management opens. |
| `compose.tpl.sheetAuto` | נכנס לגיליון מיד (פרסום של צוות הניהול) | Goes on the sheet now (posted by the management team) |
| `admin.members.locked` | צוות הניהול תמיד יכול לשלוח | The management team can always post |
| `admin.members.bulkAllowConfirm` / `.bulkBlockConfirm` | להתיר שליחה ל־{n} חברים? צוות הניהול לא מושפע. / לחסום שליחה ל־{n} חברים? צוות הניהול לא מושפע. | Allow {n} members to post? The management team isn't affected. / Block {n} members from posting? The management team isn't affected. |
| `admin.overview.invites.other` | של מישהו אחר | Someone else's |
| `admin.left` | יצאתם ממצב ניהול: אין לכם עוד הרשאת ניהול | You left management: you no longer have management access |
| `schedule.updated` | הזמנים מחושבים ל{city}. עודכנו ב־{date}. | Times are for {city}. Updated {date}. |
| `admin.tags.suggest` | גבאי, רב, חזן, בעל קורא, גזבר, ועד הקהילה, ועד שמחות | Gabbai, rabbi, chazan, Torah reader, treasurer, committee, simchas committee |

**R3 copy corrections under the owner override (2026-10-28).** The §20.7 role notes described the restricted tech. In `src/i18n`
these were rewritten, he and en: `admin.role.techNote` ("כל ההרשאות של גבאי: זמנים, גיליון, מקומות, חברים ופרטיהם. מוצג/ת לחברים
כטכני/ת, לא כגבאי."), `admin.role.gabbaiNote` ("מנהל/ת את הקהילה: זמנים, גיליון, מקומות, חברים ופרטיהם."), the new
`admin.invite.techNote` and `join.asTech`. Strings that told members only gabbaim see their data now say "גבאים וטכנאים" / "gabbaim and
techs": `me.details.gabbaimOnly`, the phone-list `listGabbaim`, `admin.groupAdmin.onlyGabbai`, the family `readOnly`, `privacy` (two
holder texts, the seat-map privacy line, the tree and the birthdays line), the phone switch `body`, `switchOn` and `switchOff`, and
`admin.channels.channelClosed` (en). The seatmap.tech.*, `admin.role.gabbaiOnly`, `admin.role.locked`, `admin.terms.waitGabbai`
and `errors.gabbai_only` rows of the table above are not used. The picker's disabled button reads "בחרו תפקיד אחר" while the
current role is selected (`admin.role.pickOther`).

The tag suggestion **drops "טכני"**, so that a label is not confused with the role. An existing tag named "טכני"
stays, and the tags screen shows a one-time info Banner on it: "יש עכשיו תפקיד טכני עם הרשאות. התגית לא נותנת
הרשאות."

**Privacy page** (`public/privacy/index.html`, "מי רואה מה"), a new item after the gabbai line:

| | |
|---|---|
| he | בעלי תפקיד טכני מגדירים את הקהילה: זמנים, גיליון שבועי, ערוצים, קבוצות, מבנה האולם, הזמנות ואישור חברים. הם רואים שמות ותפקידים, אבל לא טלפונים שלא הוצגו לכולם, לא משפחות ועץ משפחה, לא מי יושב איפה ולא ברכות פרטיות, ואינם מוחקים הודעות של אחרים. |
| en | Members with the tech role set up the Kehila: times, the weekly sheet, channels, groups, the hall layout, invites and approving members. They see names and roles, but not phone numbers that aren't shown to everyone, families or family trees, who sits where, or private blessings, and they don't remove other people's messages. |

The gabbai line there still needs the §18.7 addition ("…ורואים את הטלפונים של החברים"). It should go in with this one.

### 20.8 What this supersedes

- **§3 table:** gains a "Tech" column, described in §20.1. The §1 surfaces B and C ("Gabbai") mean gabbai or tech.
- **§18.2a:** "ניהול הקהילה (gabbai only)" becomes gabbai and tech.
- **§18.3:** unchanged for gabbaim. For a tech, the hidden rows and statuses are in §20.2.
- **P11 / members screen:** "מינוי לגבאי" / "החזרה לחבר" are replaced by the "תפקיד" row and Sheet.
- **§16 "Gabbaim only":** gabbaim, plus techs in Layout mode under §20.3.
- **§19.3 table:** "Gabbai or management" means gabbai or tech. §19.2 caption copy is in §20.7.
- **§12.6:** the tag suggestions lose "טכני".

### 20.9 Open questions for the owner

1. **Terms acceptance.** Accepting the Kehila terms is a legal act for the Kehila as the data controller. Assumed: only
   a gabbai accepts, and a tech sees the terms read-only. *Recommendation: keep it gabbai-only.*
2. **Removing a message.** Assumed: a tech cannot remove other people's messages (moderation stays with gabbaim), and
   he does not read closed channels. *Recommendation: keep it so. If spam becomes a problem, add "remove" for tech on
   channels he can read, but not reading every channel.*
3. **Tech is also a member** (family, tree, seat form, phone list as a member). Assumed yes, since the owner prays
   there. *Recommendation: yes. If a tech must be someone outside the community, that is a separate "service
   account" design.*

### 20.10 Verification

Rendered with headless Chromium (Playwright 1.47.2), one browser at a time: P46 phones 1–5 at 390 × 844, in light and
dark side by side, and the page at 390 wide. Checked: no horizontal scroll at 390 (scrollWidth 390), no NavRow title
or status cut off, the radio and lock line readable in dark mode, and taken and free seats told apart by fill and
dashed line (not by colour only). Not checked: real devices, 360-wide Android, English (LTR), screen readers, web
fonts (the page uses fallback fonts), the 1024+ editor in Layout mode for a tech (specified here, not drawn), and the
Hebrew of the role notes (needs a native editor).

## 21. The seat form all week, the Thursday card, and the reminders

Added 2026-10-28 from the owner's decisions of the same day (binding). Frames: `P47` (`seat-reminders.html`: phone 1
Home on a weekday with the bottom row, 2 Home on Thursday with the card on top, 3 the reminder settings, 4 the two
reminders on a lock screen), at 390 × 844, light and dark. All names are invented. This section refines §15.2 and
§15.10.13 (timing, audience, the push) and adds one row to §18.3. Everything else in §15–§16 stands.

**The problem (owner).** Outside the Thursday-to-Friday window there was no way to reach the seat form from the app.
The server already takes answers all week (`open` = before the deadline, `GET …/seats/me`); only the way in was missing.

### 21.1 Times (owner, binding) and what changed

| Time | Default | Was | Who sets it |
|---|---|---|---|
| **Opening** (the card moves to the top of Home) | Thursday 08:00 | Thursday 12:00 | fixed in this pass (shown, not edited) |
| **תזכורת** (first reminder) | Thursday 20:00, on | the one push at the opening | management (gabbai or tech, §20) |
| **תזכורת עדינה** (second reminder) | Friday 11:00, on | — | management |
| **Deadline** (the form closes) | **Friday 14:00** | Friday 12:00 | management (the Kehila setting `seatDeadline`) |

**The default deadline is now Friday 14:00, not 12:00.** For the developer: `seatDeadline` defaults to `'12:00'` in
`routes_core.py`, `seating_week.deadline_of` and `server/API.md`, and `DEFAULT_WINDOW` in `src/seats/window.ts` is
`{reminder: Thu 12:00, deadline: Fri 12:00}`; they become 14:00 and `{opens: Thu 08:00, deadline: Fri 14:00}`. The
field name `reminder` in `WindowConfig` means the card opening; rename it `opens` so it is not confused with the two
reminders. Kehilot that saved `seatDeadline` keep their value. The sheet's own Friday 12:00 cut-off for mazal tov
(§19.3, §19.9) is a different rule and is unchanged. Spec places updated: §15.2 and §15.10.13 (opening and deadline
wording); the open-week warning (§16.12.6) now counts from the 08:00 opening.

**Validation (my call, as the owner ordered it): opening < first reminder < second reminder < deadline**, with at least
**30 minutes** between neighbours, so no reminder lands on top of another or right at the close. A reminder that is off
drops out of the chain (the other must still sit between opening and deadline). **Both reminders are on Thursday or
Friday only** (owner): the day picker offers just ה׳ and ו׳, plus a time in 15-minute steps. A deadline change that would put an on
reminder after it is refused with the error below; move the reminder first. A change applies to this week too if the
new time is still ahead; a reminder already sent this week is not sent again.

### 21.2 Home all week: the bottom row (P47 phone 1)

**Who sees it:** an adult (`ADULTS`: member, gabbai, tech) whose family holds seats in a Kehila where the seat feature
is on. **Seat feature on** = the Kehila has a hall layout in effect for the coming Shabbat (there is no other switch;
today's Home already hides seats without a hall map). **Holds seats** = the family has at least one seat in that
Shabbat's assignments (`family:<id>` in `SEATASG#…`), or had seats last Shabbat (then the row shows "no seats this
week"). Listeners, holders without an account, and families that never had seats see nothing.

**Where:** the last thing on Home, after "latest messages" (and the guest's locked rows), before "יציאה". A quiet
`NavRow` in a `Card`, 64 high: `Icon seat` (tekhelet) · title "טופס מקומות · {shabbat}" (bold 16, e.g. "טופס מקומות ·
שבת וירא") and a status line (14 muted, up to two lines, then ellipsis) · `chev`. The whole row opens the seat page (P37) for the coming Shabbat. It never asks the question itself:
the one-tap answers stay on the Thursday card, so a weekday Home stays calm.

**States** (the title names the Shabbat, so the week is never in doubt):

| State | Icon (start) | Status line (he) |
|---|---|---|
| Not answered, before the deadline (also before the opening: answers are taken all week) | `seat` tekhelet | עוד לא עניתם · אפשר עד יום ו׳ 14:00 |
| Answered (any answer for the family) | `check` olive | עניתם: 1 פנוי לאחרים · אפשר לשנות עד יום ו׳ 14:00 |
| Answered, set by a gabbai | `check` olive | הגבאי עדכן · אפשר לשנות עד יום ו׳ 14:00 |
| After the deadline, until Shabbat ends | `lock` muted | הטופס נסגר · 1 פנוי לאחרים / כל המקומות נשמרו לכם |
| No seats this week | `seat` muted, no chevron, not pressable | השבת אין לכם מקומות. לשאלות פנו לגבאי. |

"עניתם:" sums the answer in the fewest words: "כולם מגיעים", "לא מגיעים", or "{n} פנוי לאחרים" (the larger of the two
prayers). The state is the family's, so both partners see the same line whoever answered. Status is icon plus words,
never colour alone. The row's accessibility label is title + status.

### 21.3 Thursday: the card on top (P47 phone 2)

- **From the opening (Thursday 08:00)** the full seat card of §15.10.13 (one-tap "לא מגיעים השבת", "כולם מגיעים", "חלק
  מגיעים", undo, the answered states) sits at the top of Home, in the §15.2 place: greeting → test-build card → seat card
  → P7 → schedule → zmanim. While it shows, the bottom row is hidden for that person (one way in at a time).
- **Who gets the card:** the same people as the reminders (§21.5): the family's men, or its adult women when it has no
  man. Other adults of the family (for example a wife in a family with a man) keep the bottom row all week, with its
  states, so they can still open and answer the form.
- **After the deadline, until Shabbat ends,** the card stays on top in its final state (owner): `Card` with an ash edge,
  `Icon lock` + "טופס מקומות לשבת · נסגר", and one line: "שלחתם: {summary}." or "לא שלחתם השבת. כל המקומות נשמרו
  לכם." (P38 wording), then "לשינוי פנו לגבאי." No buttons; the whole card opens P37 read-only (P38 ג). This replaces
  §15.10.13's "the card disappears at the deadline".
- **After Shabbat** (the Kehila's havdalah time from the schedule, §14; without a schedule, the zmanim `nightfall` for
  the Kehila's location) the card goes and the bottom row returns for the next Shabbat. Until then, Saturday still
  belongs to the Friday before, as the server already rules (`week` default); the client's `shabbatFriday` must follow
  the same rule.

### 21.4 Reminders: what they are

- **Pushes only**, never feed messages, never in Messages or the bell list. Tapping one opens P37 for that Shabbat in
  that Kehila (switching Kehila if needed), `data: {kehila, screen: 'seats', week}`. After the deadline the tap opens
  P37 closed (P38 ג).
- The §15.10.13 actions stay on both: "לא מגיעים השבת" and "למלא את הטופס" where the platform has actions.
- **Privacy (push rule):** the Kehila name and generic text. No names, no seat count, no rows. The two texts differ in
  tone: the first is plain, the second is soft and says why it matters.
- **There is no push at the opening any more.** §15.10.13's push "at the reminder time" is now the first reminder.
- **Muted = nothing.** A new switch in M5 (notification preferences), group "מקומות בשבת": `Toggle` "תזכורות לטופס
  המקומות" (default on), offNote "לא תקבלו תזכורות. הטופס עדיין בדף הבית." Shown only to people who could receive
  them. It mutes that person only, in that Kehila; it does not hide the card or the row.
- **Once per reminder per week:** each is sent at most once for a Shabbat (idempotency key per Kehila, Friday and
  reminder 1|2), evaluated at its send time.
- **Developer notes (owner + CTO, binding):** the reminder job runs **only on Thursday and Friday, every 5 minutes, in
  Israel time** (Asia/Jerusalem, so DST needs no special case). That is why the day picker offers only ה׳ and ו׳. Each run
  sends every reminder whose time is at or before now and is not yet sent for that Shabbat, so **a reminder may arrive
  up to 5 minutes late** (20:00 can land at 20:04). The recipient query runs at send time, so a family that answered
  in those minutes is skipped. A reminder whose time is still ahead but would arrive after the deadline is never sent;
  the 30-minute gap (§21.1) keeps that from happening. The settings screen does not promise the exact minute: its
  footer adds "ההתראה יוצאת עד 5 דקות אחרי השעה." (`admin.seats.lateNote`).

### 21.5 Who gets them (owner rule) and what "answered" means (my call)

At the reminder's time, for the coming Shabbat:
1. The Kehila has the seat feature on (§21.2) and that reminder is on.
2. Families with at least one seat in that Shabbat's assignments, **not answered** (below).
3. In each such family, the **men**: account holders linked to the family (its adults, and a son 13+ who has his own
   account in the family), role in `ADULTS`, gender male in the tree (§17). **If the family has no man** (for example a
   widow), its **adult women** with accounts get it instead. Someone whose gender is not recorded is not counted as a man;
   if that leaves no man, every adult with an account gets it.
4. Minus anyone who muted seat reminders (§21.4) or has no push token.

**Answered (named for the developer):** the family's household ref `family:<familyId>` is a key in the `answered` map
of **either** `SEATWK#<friday>#erev` **or** `SEATWK#<friday>#day`. That map is set by every member PUT (P37 Send, the
card's one-tap answers, even one that changes nothing) and by a gabbai's on-behalf save. Either prayer is enough: the
member form and the card always answer both together, so one answered prayer means a gabbai answered for the family,
and the family should not be chased. **Whoever answered** (any partner, a son, a gabbai), nobody in the family gets a
reminder after that.
**Gap to close (CTO):** a responses-file upload (§16.6) does not set `answered` today, so a family that answered only on
the old Google Form would still be reminded. Recommendation: on "החלת השינויים" add the matched households to a separate
`answeredFile {household ref: ms}` on the same items (cleared by undo), and count it as answered for the reminder query
only. The Home card keeps reading `answered` alone.

This supersedes §15.10.13's "only the male head of each family": the card and reminders now go to all the family's
men (owner). The CTO default there for a family with no man becomes the owner's rule above.

### 21.6 Where management sets them (P47 phone 3)

**Management › מקומות ישיבה** (§18.3) gets a third section, **"כל שבוע"**, with one row: **"זמני הטופס והתזכורות"**,
status line "נסגר ו׳ 14:00 · 2 תזכורות" (or "· תזכורות כבויות"). There was no window setting on any screen before
(`seatDeadline` existed only in the API), so this is now its home. Gabbai and tech alike (§20 override).

**The screen** (its own stack screen, back "› מקומות ישיבה"):
1. `ktitle` "זמני הטופס והתזכורות" and a muted line: "חל על כל שבוע. השבוע הקרוב: שבת וירא, כ׳ בחשוון (31.10)."
2. **The week strip** (read-only): a line from Thursday to Friday, filling from the right, with four marks in order:
   "נפתח ה׳ 08:00" (ring), "תזכורת ה׳ 20:00" (bell), "עדינה ו׳ 11:00" (bell), "נסגר ו׳ 14:00" (lock). A reminder that is
   off shows as a dotted bell with "כבויה". It shows the order the validation enforces.
3. **One settings block** (`Card`, the three times together, owner): three rows, each `Icon` · label and one muted line ·
   value at the end (bold, tabular) · for the reminders a `Toggle` in the row:
   - "תזכורת" · "למי שעוד לא ענה" · **ה׳ 20:00** · Toggle;
   - "תזכורת עדינה" · "למי שעדיין לא ענה" · **ו׳ 11:00** · Toggle;
   - "המועד האחרון" · "אחריו רק גבאי יכול לשנות" · **ו׳ 14:00**.
   Tapping a value opens a `Sheet` with `Segmented` ה׳ / ו׳ (the deadline: Friday only, no day choice) and a
   `TimeField` (15-minute steps), the allowed range in a muted line ("בין ה׳ 08:30 ל־ו׳ 10:30"), and "שמירה". An
   out-of-order time shows the field error and keeps "שמירה" disabled. Toggles save at once with a Toast.
4. A muted footer `Card` "למי זה הולך": "הגברים במשפחות שיש להן מקומות השבת ועוד לא ענו. במשפחה בלי גבר: הנשים
   הבוגרות. מי שענה, או שמישהו מהמשפחה ענה בשבילו, לא יקבל. מי שכיבה תזכורות לא יקבל.", the 5-minute note (§21.4) and the live count "כרגע
   עוד לא ענו: {n} משפחות" (no names; the names are on "עדכון בשם משפחה").
5. "דוגמה להתראה" opens a `Sheet` showing both texts as on a lock screen (as P47 phone 4).

**Wide (≥ 1024):** the same screen in the content column; the strip spans the column.

### 21.7 Copy

| Key | Hebrew | English |
|---|---|---|
| `seats.row.title` | טופס מקומות · {shabbat} | Seats form · {shabbat} |
| `seats.row.open` | עוד לא עניתם · אפשר עד {day} {time} | Not answered yet · Open until {day} {time} |
| `seats.row.answered` | עניתם: {summary} · אפשר לשנות עד {day} {time} | Answered: {summary} · You can change it until {day} {time} |
| `seats.row.byGabbai` | הגבאי עדכן · אפשר לשנות עד {day} {time} | A gabbai updated it · You can change it until {day} {time} |
| `seats.row.closed` | הטופס נסגר · {summary} | The form is closed · {summary} |
| `seats.row.none` | השבת אין לכם מקומות. לשאלות פנו לגבאי. | No seats for you this Shabbat. Ask a gabbai if you have questions. |
| `seats.row.sumAll` / `sumNone` / `sumFree` / `sumKept` | כולם מגיעים / לא מגיעים / {n} פנוי לאחרים / כל המקומות נשמרו לכם | Everyone's coming / Not coming / {n} free for others / All your seats were kept |
| `seats.card.closedTitle` | טופס מקומות לשבת · נסגר | Shabbat seats form · Closed |
| `seats.card.closedSent` | שלחתם: {summary}. לשינוי פנו לגבאי. | You sent: {summary}. To change it, ask a gabbai. |
| `seats.push.r1.title` | {kehila} · טופס מקומות לשבת | {kehila} · Shabbat seats form |
| `seats.push.r1.body` | עוד לא עניתם על טופס המקומות לשבת. אפשר לענות עד {day} {time}. | You haven't answered the Shabbat seats form yet. You can answer until {day} {time}. |
| `seats.push.r2.title` | {kehila} | {kehila} |
| `seats.push.r2.body` | תזכורת עדינה: טופס המקומות פתוח עד {time} היום. מקום שתפנו יכול לשמח מישהו אחר בשבת. | A gentle reminder: the seats form is open until {time} today. A seat you free could make someone else's Shabbat. |
| `seats.push.r2.bodyOtherDay` | תזכורת עדינה: טופס המקומות פתוח עד {day} {time}. מקום שתפנו יכול לשמח מישהו אחר בשבת. | A gentle reminder: the seats form is open until {day} {time}. A seat you free could make someone else's Shabbat. |
| `prefs.seatReminders` / `prefs.seatRemindersOff` | תזכורות לטופס המקומות / לא תקבלו תזכורות. הטופס עדיין בדף הבית. | Seats form reminders / You won't get reminders. The form is still on Home. |
| `admin.seats.every` | כל שבוע | Every week |
| `admin.seats.times` | זמני הטופס והתזכורות | Form times and reminders |
| `admin.seats.timesStatus` / `timesOff` | נסגר {day} {time} · {n} תזכורות / נסגר {day} {time} · תזכורות כבויות | Closes {day} {time} · {n} reminders / Closes {day} {time} · Reminders off |
| `admin.seats.applies` | חל על כל שבוע. השבוע הקרוב: {shabbat}, {date}. | Applies every week. Coming up: {shabbat}, {date}. |
| `admin.seats.r1` / `r1Sub` | תזכורת / למי שעוד לא ענה | Reminder / To whoever hasn't answered |
| `admin.seats.r2` / `r2Sub` | תזכורת עדינה / למי שעדיין לא ענה | Gentle reminder / To whoever still hasn't answered |
| `admin.seats.deadline` / `deadlineSub` | המועד האחרון / אחריו רק גבאי יכול לשנות | Deadline / After it only a gabbai can change answers |
| `admin.seats.opens` | נפתח {day} {time} | Opens {day} {time} |
| `admin.seats.off` | כבויה | Off |
| `admin.seats.range` | בין {from} ל־{to} | Between {from} and {to} |
| `admin.seats.errOrder` | צריך להיות אחרי {prev} ולפני {next}, בהפרש של חצי שעה לפחות. | Must be after {prev} and before {next}, at least half an hour apart. |
| `admin.seats.errDeadline` | {reminder} ({when}) תהיה אחרי המועד האחרון. שנו קודם את התזכורת. | {reminder} ({when}) would be after the deadline. Change the reminder first. |
| `admin.seats.saved` / `onToast` / `offToast` | נשמר / התזכורת פעילה / התזכורת כבויה | Saved / Reminder on / Reminder off |
| `admin.seats.who` | הגברים במשפחות שיש להן מקומות השבת ועוד לא ענו. במשפחה בלי גבר: הנשים הבוגרות. מי שענה, או שמישהו מהמשפחה ענה בשבילו, לא יקבל. מי שכיבה תזכורות לא יקבל. | The men of families with seats this Shabbat that haven't answered. In a family with no man: its adult women. Nobody gets one once their family has answered. People who turned reminders off get nothing. |
| `admin.seats.pending` | כרגע עוד לא ענו: {n} משפחות | Not answered yet: {n} families |
| `admin.seats.sample` | דוגמה להתראה | Sample notification |
| `admin.seats.lateNote` | ההתראה יוצאת עד 5 דקות אחרי השעה. | It goes out within 5 minutes of the time. |

`{day}` is the weekday ("יום ו׳" / "Fri"); the push body uses "היום" when the deadline is the same day. Keep
`{day} {time}` on one line (non-breaking spaces): the row status may wrap to two lines (`numberOfLines={2}`), but never
between the day and the time. No Gregorian
date stands alone anywhere here; the one date shown (the settings line) follows §2: Hebrew first, Gregorian in brackets.

### 21.8 Accessibility

The row and the final card are `button`s with title + status as the label. The week strip is one image with a text
label listing the four times in order. Each reminder row: the Toggle is a `switch` named "תזכורת, ה׳ 20:00"; the value is
its own `button` ("שינוי שעת התזכורת"). Targets 48. Time values are LTR-isolated and tabular.

### 21.9 Open for the CTO (not owner questions)

- The editor's "open week" (§16.12.6) counted from the card opening; families can now answer earlier in the week from
  the row. Recommendation: treat a Shabbat as open from the opening **or** its first answer, whichever is first, so a
  hall change can't silently drop an early answer.
- `answeredFile` for uploads (§21.5).
- Opening is fixed at Thursday 08:00 in this pass; `WindowConfig` keeps it as data so it can become a setting later.

**Owner answers (2026-10-28):** (1) No data change: a responses-file upload does not count as "answered" for
reminders; families moving to the app stop using the old form. (2) Only the men (or, in a family with no man, its adult
women) get the Thursday card and the reminders; other adults keep the bottom row only.

### 21.10 Verification

P47 phone 1 shows Home scrolled to the bottom; a separate panel shows the row in all five states. Rendered with headless Chromium (Playwright 1.47.2), one browser at a time: P47 phones 1–4 at 390 × 844 in light and
dark, and the page at 390 wide (no horizontal scroll). Not checked: real devices, 360-wide Android, English, screen
readers, how iOS and Android actually truncate the push bodies (the gentle text is about 90 characters; the lock
screen frame shows two lines), web fonts, and the wide layout (specified, not drawn).

## 22. Private replies to Kehila messages

Added 2026-10-28 from the owner's decisions of the same day (binding). Frames: `P48` (`private-replies.html`: phone 1
Messages with the count and the button on the card, 1a the long-press sheet, 1b the reply Sheet from the card, 2 M3
with the reply box, 2a the condolence box, 2b a mazal tov with the recipient picker and its states panel, 3 the
replies mailbox, 3a and 3b the mailbox of each spouse, 4 the author's own message), at 390 × 844, light and dark. All names are invented. This section replaces the M3 "ברכה אישית למשפחה" private reply (§5 M3 row, flow 3 in §6)
with one mechanism. Everything else in §12, §19 and §19.2a stands. "Management" means gabbai or tech (§20).

**Owner decisions (2026-10-28, binding).**
1. There is **no switch in Compose**. Every message to the whole Kehila written by a **member** of the Kehila can be
   answered privately. **Messages written by management (gabbai or tech) get no private-reply button and no count** when the replies would
   reach that gabbai or tech (הודעה, אירוע). *CTO ruling, owner to confirm (2026-10-28):* a mazal tov or condolence
   posted by management still takes blessings, because they go to the family, not to the poster. The reader gets a "תשובה פרטית" button on the card and on M3, and a long-press action on the card.
2. **Routing.** A private reply to a **mazal tov or condolence** goes to the **subject**: the adults of the family the
   message names, not the poster (as today). A private reply to **every other message** goes only to its **author**.
3. The count of private replies shows on the card **to the whole Kehila**: "{n} תשובות פרטיות". The reason is that a
   visible count encourages people to reply.
4. The existing family blessing becomes this one mechanism: one storage, one count on the card, one mailbox. Only the
   routing rule above differs.
5. **Choosing the recipient (mazal tov, condolence).** The replier chooses who receives it: **the whole family**
   (default) or **one of the family's adults, by name**. A reply sent to one adult is seen only by that adult: not by
   the spouse, the rest of the family or the gabbaim (§22.4a).

Nothing changes in Compose (M4, §12.3, §19.2): no new control, and the template preview (§19.2) shows the card's
reply row exactly as members will see it.

### 22.1 Which messages can be answered (owner rules, plus my calls on type and channel)

A message has the reply action when **all** of these hold:

| Rule | Why |
|---|---|
| It is in the main channel ("הודעות הקהילה"), the whole-Kehila audience | Owner: "a message to the Kehila". Group channels and conversation channels already have their own conversation, so they get no private reply in v1 |
| For **הודעה and אירוע**, the author is a **member** (`authorKind: member`). A management (gabbai or tech) הודעה or אירוע gets no button, no count, no long-press action and no box on M3. **מזל טוב and השתתפות בצער qualify whoever posted them** (*CTO ruling, owner to confirm*) | Owner decision 1: management doesn't need replies landing in its own mailbox. A blessing goes to the family, so that reason doesn't apply to it. The rule follows the author's role when the message was posted (`authorKind` is stored on the message), so a member who later becomes a gabbai keeps replies on older messages |
| Its type is הודעה, אירוע, מזל טוב or השתתפות בצער | **עדכון שבועי is excluded**: it is the Kehila's notice sheet, not one person speaking, and questions about it belong to the gabbai directly |
| It is not a system message (welcome, automatic notices, test-build card) | Nobody reads the mailbox of "the app" |
| The recipient still exists: the author is still in the Kehila and can read the channel; for a blessing, the family still has a live adult who can (today's `target_left`) | Otherwise the reply would go nowhere |

Who may reply: members, gabbaim and tech (management can reply to a member's message; it just can't receive
replies on its own הודעה or אירוע). **Listeners (guests) see the count but get no button** (they can't post or
reply anywhere, §3). The author never sees a reply action on their own message; an adult of the named family never
sees one on the blessing about them. A muted author (§M5) is muted for notifications only: the button stays.

**Blessings on a management post (CTO ruling, owner to confirm, 2026-10-28):** a mazal tov or condolence posted by a
gabbai or tech has the full blessing box, the count and the recipient picker (§22.4a). The replies go to the family
it names and never to the poster. So a Kehila whose type rule is "ההנהלה בלבד" (§12.2) keeps its blessings.

**For the developer:** the server decides with one rule and returns `canReply: bool` and `replyTo: "author"|"family"`
on the message object, and for a family target `replyAdults: [{userId, name}]` (the live adults who can read the
channel), so the app never re-derives it. Not designed here.

### 22.2 Labels per type (condolence wording is my call)

The mechanism is one; the words follow the register of the type (§12.1). Gendered forms are avoided by plural
address ("כתבו", "אליכם"), as everywhere in the app.

| | הודעה, אירוע | מזל טוב | השתתפות בצער |
|---|---|---|---|
| Button (card, M3, long press) | תשובה פרטית | ברכה אישית | מילה למשפחה |
| Icon | `reply` | `heart` | `heart` |
| Button colour | tekhelet | pomegranate | ash |
| Box heading (M3, Sheet) | תשובה פרטית ל{name} | ברכה אישית למשפחת {family} | מילה אישית למשפחת {family} |
| Placeholder | כתבו תשובה | כתבו ברכה למשפחה | כתבו למשפחה כמה מילים |
| Count on the card | {n} תשובות פרטיות | {n} ברכות אישיות | {n} חברים כתבו למשפחה |
| Push to the recipient | תשובה פרטית חדשה | ברכה אישית חדשה למשפחה | מילה אישית חדשה למשפחה |

**Condolence (my call):** not "ברכה" (a blessing reads wrong at a death), not "תשובה" (nobody asked a question), and not
"ניחומים" (§12.1 keeps it out of the app). "מילה למשפחה" / "מילה אישית" is what people actually do at a shiva: say a few
personal words. The count is about people, not items ("9 חברים כתבו למשפחה"), so it reads as presence, never as a
score. The count is in muted ash like the rest of the condolence card; it is never pomegranate and never animates.

The existing chip text "{n} חברים שלחו ברכה פרטית למשפחת {name}" is replaced by the short card count above; M3 shows
the same count. "ברכה פרטית" becomes "ברכה אישית" everywhere (one name per action, §2).

### 22.3 The card (P48 phone 1, and the states panel)

`MessageRow` gets a **reply row** under the body, after a hairline, 48 high, only when there is something to show:

- **Start:** the count, `Txt small bold muted` with a 16 `lock` icon (`heart` for mazal tov and condolence). **Not shown
  at 0.** The count is the number of distinct repliers (= replies, since each person has one reply per message, §22.4).
- **End:** the button, a 40-high pill (48 hit area), 1.5 border and text in the type's colour, icon + label (§22.2).
  Tap: opens the reply **Sheet** (P48 1b), so a person can answer without leaving the list. Once I have replied, the
  pill becomes **"עניתם"** with `check` in olive on a hairline border; tapping it opens M3 at my reply (edit or delete
  there).
- **The author's own card** (and the named family's card): no button; after the count, " · {m} חדשות" in bold
  pomegranate when unread replies exist. Tapping the count opens M3 at "תשובות שהגיעו".
- **Listener:** the count only.
- **A management הודעה or אירוע:** no reply row at all (owner). A mazal tov or condolence posted by management keeps
  its count and button (CTO ruling, owner to confirm).
- A card with neither a count nor a button (עדכון שבועי, a group channel, a message nobody answered that I can't answer)
  has no reply row at all.

**Long press** on the card (500 ms, haptic tick) opens the card's actions Sheet (P48 1a); "תשובה פרטית ל{name}" (or the
type's label) is the first row, in tekhelet, followed by "פתיחת ההודעה" and the existing actions (mute the member,
§19.2a update, delete for the author). On web, the card's `more` button opens the same Sheet. The long press is a
shortcut only; every action is also on M3.

**A11y:** the count is part of the card's label ("3 תשובות פרטיות"); the button is a separate `button` named
"תשובה פרטית לרותם אלמוג", so screen-reader users reach it without the long press. The long press is exposed as an
`accessibilityActions` entry "פעולות".

### 22.4 The reader's side (P48 phones 1b, 2, 2a and the states panel)

**On M3**, under the message card and its join button: the count line ("3 תשובות פרטיות", lock icon), then the box:
heading (§22.2), the existing `Composer` (min 96 high), the **lock line** that never scrolls away while typing:
"תגיע רק אל {name}. לא תוצג לשאר הקהילה, גם לא לגבאים." (blessing: "יגיע למשפחת {family} בלבד. לא יוצג לשאר הקהילה,
גם לא לגבאים."), and "שליחה" (disabled while empty). The **Sheet** from the card has the same parts and the message
title as a muted line "על: {title}"; it closes on send with the Toast "נשלחה".

- **One reply per person per message (my call).** It keeps the count honest (one person = one), and a second thought is
  an edit, not a second message to the recipient. After sending, the box is replaced by **my reply**: a Card with an
  olive start edge, caption "נשלחה אל {name} בלבד · {time}" (blessing: "נשלחה למשפחה בלבד · {time}"), the text, and
  two text buttons **"עריכה"** and **"מחיקה"**.
- **Editing:** the same Composer, prefilled, with "שמירה" / "ביטול". The recipient sees "נערכה" next to the time; no
  history is kept or shown. No new push for an edit.
- **Withdrawing:** "מחיקה" opens a confirm: "למחוק את התשובה?" / "היא תימחק גם אצל {name}." (blessing: "גם אצל
  המשפחה."). The count drops by one. Allowed any time.
- **Length:** 1000 code points (today's limit). A counter "{n}/1000" appears from 900; past 1000 "שליחה" is disabled.
- **Can't reply** (box replaced by an info Banner): the author left — "מי שכתב את ההודעה כבר לא בקהילה, ולכן אי אפשר
  לענות."; the family left — today's `detail.familyGone`. Offline: the box is disabled and the existing offline line
  shows.
- **Existing blessings** written before this change may hold several replies by one person: all stay visible, the
  count already counts people, and the box shows the newest as "my reply".

### 22.4a Choosing the recipient: mazal tov and condolence (owner, P48 phone 2b and its panel)

**The picker.** Under the box heading, a label **"אל מי"** and one row of `Chip size="filter"` choices (radio
semantics, wrapping, 40 high with a 48 hit area, selected = ink fill with `check`, as §19.2):
**"כל המשפחה"** (`users` icon, **default, preselected** every time the box opens) · then one chip per adult, by display
name ("שולמית ברקן", "יגאל ברקן", `user` icon), in the family's stored order. The same picker is in the Sheet from the
card and on M3. The heading follows the choice: "ברכה אישית למשפחת ברקן" → "ברכה אישית לשולמית ברקן"
(condolence: "מילה אישית למשפחת שדמי" → "מילה אישית לאלון שדמי").

**The lock line** follows the choice and never scrolls away while typing:
- whole family: "יגיע למשפחת {family} בלבד. לא יוצג לשאר הקהילה, גם לא לגבאים." (as §22.4);
- one adult: "תגיע רק אל {name}. לא לבן או לבת הזוג, לא לשאר המשפחה, לא לשאר הקהילה ולא לגבאים."

**Sent state.** My reply card says "נשלחה אל {name} בלבד · {time}" for one adult, "נשלחה למשפחה בלבד · {time}" for
the family. **The recipient is fixed once sent (my call):** "עריכה" changes the text only, and the picker is not shown
while editing. To send to someone else, delete and send again. Moving a reply from one person to the family would
show it to someone it was not written for. Still one reply per person per message (§22.4): a person can't send one to
the family and another to one spouse. This keeps the count one per person and keeps the box simple.

**How many adults (my call).**
- **One live adult** (no partner, or the partner left): **no picker.** The reply goes to "the family", which is that
  one adult today. A partner who links later sees family replies, as today, but never a personal one.
- **Two adults:** the picker as above.
- **More than two:** not possible in today's model, because a family has at most two linked adults and grown children
  have their own families. If it ever happens, the chips simply wrap: "כל המשפחה" then each live adult by name. Children
  are never recipients.
- An adult who can't read the channel (left the Kehila or its groups) is left out of the picker. If that leaves one
  adult, there is no picker.

**Who sees a personal reply.** Only the chosen adult and the writer. Not the spouse, children, gabbaim or tech, and it
never appears in the spouse's mailbox, unread count, push or export. If the chosen adult later unlinks from the family
and stays in the Kehila, the reply stays theirs. If they leave the Kehila or delete their account, it is deleted
(nobody else may read it), and the count drops.

**The count** on the card and on M3 counts **every** reply, family and personal ("12 ברכות אישיות"), and stays one per
replier. The family's own count line adds " · {m} חדשות" with the unread replies **that this adult can see**.

**Each spouse's mailbox (P48 phones 3a, 3b).** The blessing's card in the mailbox shows what *I* can see: the family
replies plus the ones sent to me personally. Personal ones carry a small pomegranate Tag **"אישית"** with a `lock`
after the writer's name. The header line counts mine: "ברכות למשפחה שלכם · {n} ברכות · {p} אישיות · {m} חדשות".
Example: 12 on the card = 9 to the family + 2 to Shulamit + 1 to Yigal. Shulamit sees 11 (2 personal) and Yigal sees 10
(1 personal). Neither sees the other's personal replies (their text, writers or number). Note: since the public count includes every reply, a spouse who subtracts what they can see could infer how many personal replies the other got; the content and writers stay private (review note, accepted). The public count says only "12", with no breakdown. On
M3 "ברכות שהגיעו" uses the same list and Tag.

**Push.** A personal reply pushes only the chosen adult: "ברכה אישית חדשה" (condolence: "מילה אישית חדשה"), with no
"למשפחה", no name and no text. Family replies push every adult as §22.5.

### 22.5 The recipient's side: M3 and the mailbox (P48 phones 3 and 4)

**There is no inbox screen today:** a family reads its blessings only under its own message on M3 ("ברכות שהגיעו").
That place stays, generalised, and a mailbox is added for everything that came to me.

1. **On M3** (the author's own message, or the blessing about my family): the count line, then **"תשובות שהגיעו"**
   (mazal tov: "ברכות שהגיעו"; condolence: "מילים שהגיעו") with the line "רק אתם רואים אותן." and the list, newest
   first: name bold, time (§2 rules: "היום, 09:58", "אתמול, 22:03", otherwise "יום ב׳, ט״ו בחשוון (26.10)"), "· נערכה"
   when edited, the text (`Txt content`), and an 8 px pomegranate dot before an unread one. A reply whose writer
   deleted their account without deleting posts shows the name "חבר/ה שעזב/ה".
2. **The mailbox: Me › שלי בקהילה › "תשובות פרטיות"** (P48 phone 3). Personal, so it lives on Me (§18.4). The row's
   status is "{n} חדשות" with a pomegranate badge, "אין חדשות", or "עוד לא הגיעו תשובות"; the row is shown to every
   member, gabbai and tech, not to listeners. The **Me tab** shows the unread count as its badge. The screen: back
   "› אני", title "תשובות פרטיות", the line "רק אתם רואים אותן. גם הגבאים לא.", then one card per message (newest
   activity first) with the type's stripe, the title, "הודעה שלכם · {n} תשובות · {m} חדשות" or "ברכות למשפחה שלכם ·
   {n} ברכות", up to three replies, and "עוד {n} תשובות" which opens M3. Both adults of a family see the family's
   blessings; only the author sees replies to their own message.
3. **Unread:** a reply is unread until the recipient has seen it on M3 or in the mailbox (marked read when shown, per
   person; one partner reading does not mark it for the other). No sender ever learns whether it was read.
4. **Push:** to the recipient only, title the Kehila name, body from §22.2 ("תשובה פרטית חדשה"), **no names and no
   text**; data `{kehila, messageId}` opens M3 at "תשובות שהגיעו". At most **one push per message per recipient per 15
   minutes** (my call): a busy message would otherwise ring 40 times; the badge carries the rest. These are fixed system
   texts, left out of `admin/push-texts` (like `family_request`); the old editable `reply` key goes. The locked line in
   notification preferences becomes "ברכות ותשובות פרטיות אליכם תמיד מגיעות" (you can't mute replies to yourself;
   muting the replier does not hide their reply either).
5. **No reply back in the app** (my call, v1): the mailbox is one-way, like the family blessings today. If the
   replier's phone is in the phone list (§18.2a), the name in the mailbox links to that entry.
6. **Gabbaim and tech see no reply text and no replier names**, in the app, in management or in exports, unless they are
   the recipient. They see the count like everyone (same rule as the confirmed family blessings, §7).

### 22.6 With the rest of the app

| Case | What happens |
|---|---|
| **Mazal tov / condolence** | Same mechanism, routed to the named family (owner). The join action ("מצטרף לברכות", "משתתף בצער") is unchanged and separate: a public count of people, no text. Condolence now shows its count too (owner), in ash, as people ("9 חברים כתבו למשפחה") |
| **§19.2a update of a message** | Replies stay with the message (same id). No push to repliers |
| **Deleting the message** (author, or management from GD6) | Its replies are deleted with it, for everyone, including each replier's own copy. Confirm: "ההודעה תימחק לכל הקהילה, ואיתה {n} התשובות הפרטיות שהגיעו עליה. אי אפשר לשחזר." (count shown only when n > 0). Repliers are not notified |
| **Download my data** (export) | My own replies, as today, now with the message title and `to` ("author", "family" or the chosen adult's name). **Plus, my call: replies I received** (writer's display name, time, text) as `repliesReceived`, because they were written to me; a family's blessings go into both adults' exports. Never anyone else's |
| **Account deletion, the replier** | With "delete my posts": every reply they wrote is deleted and counts drop (today's rule, now for all replies). Without: replies stay, the name shows as "חבר/ה שעזב/ה" (names are blanked, §M12 rule) |
| **Account deletion, the author** | Replies addressed to the author are deleted with the account (nobody else may read them), the button disappears and the count goes. With "delete my posts" the message goes too, as today. For a blessing the family's replies are untouched by the poster's deletion: they belong to the family |
| **Author leaves the Kehila** | Like `target_left`: the button is replaced by the "can't reply" Banner; replies are kept until the message is deleted, and come back if the author rejoins |
| **TTL / 14-day rules** | None apply. Messages have no expiry; the 14-day TTLs are for sheet items, schedule weeks and auto-links only. A reply lives exactly as long as its message |
| **Search** (§12.4) | Never searches reply text. The mailbox has no search in v1 |
| **Weekly sheet, Home** | The count is not printed on the sheet and not shown on Home's latest-messages rows |

### 22.7 Copy

New or changed keys (`src/i18n/he.json` / `en.json`). `{name}` is the author's display name, `{family}` the family's
display name; both are isolated (§11.5).

| Key | Hebrew | English |
|---|---|---|
| `reply.button.general` | תשובה פרטית | Private reply |
| `reply.button.celebration` | ברכה אישית | Personal blessing |
| `reply.button.condolence` | מילה למשפחה | A word to the family |
| `reply.buttonA11y` | תשובה פרטית ל{name} | Private reply to {name} |
| `reply.done` | עניתם | Replied |
| `reply.count.general` | {n} תשובות פרטיות | {n} private replies |
| `reply.countOne.general` | תשובה פרטית אחת | 1 private reply |
| `reply.count.celebration` | {n} ברכות אישיות | {n} personal blessings |
| `reply.countOne.celebration` | ברכה אישית אחת | 1 personal blessing |
| `reply.count.condolence` | {n} חברים כתבו למשפחה | {n} people wrote to the family |
| `reply.countOne.condolence` | חבר אחד כתב למשפחה | 1 person wrote to the family |
| `reply.new` | {n} חדשות | {n} new |
| `reply.title.general` | תשובה פרטית ל{name} | Private reply to {name} |
| `reply.title.celebration` (was `detail.replyTitle`) | ברכה אישית למשפחת {family} | Personal blessing to the {family} family |
| `reply.title.condolence` | מילה אישית למשפחת {family} | A personal word to the {family} family |
| `reply.about` | על: {title} | Re: {title} |
| `reply.placeholder.general` | כתבו תשובה | Write a reply |
| `reply.placeholder.celebration` (was `detail.replyPlaceholder`) | כתבו ברכה למשפחה | Write a blessing to the family |
| `reply.placeholder.condolence` | כתבו למשפחה כמה מילים | Write a few words to the family |
| `reply.lock.general` | תגיע רק אל {name}. לא תוצג לשאר הקהילה, גם לא לגבאים. | Only {name} will see it. Not the rest of the community, not the gabbaim. |
| `reply.to` | אל מי | To whom |
| `reply.toFamily` | כל המשפחה | The whole family |
| `reply.title.celebrationPerson` | ברכה אישית ל{name} | Personal blessing to {name} |
| `reply.title.condolencePerson` | מילה אישית ל{name} | A personal word to {name} |
| `reply.lock.person` | תגיע רק אל {name}. לא לבן או לבת הזוג, לא לשאר המשפחה, לא לשאר הקהילה ולא לגבאים. | Only {name} will see it. Not their spouse, the rest of the family, the community or the gabbaim. |
| `reply.personalTag` | אישית | Personal |
| `inbox.personal` | {n} אישיות | {n} personal |
| push `personal_blessing` (fixed) | ברכה אישית חדשה | New personal blessing |
| push `personal_word` (fixed) | מילה אישית חדשה | New personal word |
| `reply.lock.family` (was `detail.lock`) | יגיע למשפחת {family} בלבד. לא יוצג לשאר הקהילה, גם לא לגבאים. | Only the {family} family will see it. Not the rest of the community, not the gabbaim. |
| `reply.sent.general` | נשלחה אל {name} בלבד · {time} | Sent to {name} only · {time} |
| `reply.sent.family` (was `detail.sent`) | נשלחה למשפחה בלבד · {time} | Sent to the family only · {time} |
| `reply.toast` | נשלחה | Sent |
| `reply.edit` | עריכה | Edit |
| `reply.save` | שמירה | Save |
| `reply.cancel` | ביטול | Cancel |
| `reply.edited` | נערכה | edited |
| `reply.delete` | מחיקה | Delete |
| `reply.deleteTitle` | למחוק את התשובה? | Delete your reply? |
| `reply.deleteBody.general` | היא תימחק גם אצל {name}. | It will be deleted for {name} too. |
| `reply.deleteBody.family` | היא תימחק גם אצל המשפחה. | It will be deleted for the family too. |
| `reply.counter` | {n}/1000 | {n}/1000 |
| `reply.authorGone` | מי שכתב את ההודעה כבר לא בקהילה, ולכן אי אפשר לענות. | The person who wrote this is no longer in the community, so you can't reply. |
| `reply.received.general` | תשובות שהגיעו | Replies received |
| `reply.received.celebration` (was `detail.received`) | ברכות שהגיעו | Blessings received |
| `reply.received.condolence` | מילים שהגיעו | Words received |
| `reply.onlyYou` | רק אתם רואים אותן. | Only you can see them. |
| `reply.formerMember` (was `chip.formerMember`) | חבר/ה שעזב/ה | Former member |
| `inbox.row` | תשובות פרטיות | Private replies |
| `inbox.rowNew` | {n} חדשות | {n} new |
| `inbox.rowNone` | אין חדשות | Nothing new |
| `inbox.rowEmpty` | עוד לא הגיעו תשובות | No replies yet |
| `inbox.title` | תשובות פרטיות | Private replies |
| `inbox.privacy` | רק אתם רואים אותן. גם הגבאים לא. | Only you can see them. Not even the gabbaim. |
| `inbox.mine` | הודעה שלכם · {n} תשובות | Your message · {n} replies |
| `inbox.family` | ברכות למשפחה שלכם · {n} ברכות | To your family · {n} blessings |
| `inbox.more` | עוד {n} תשובות | {n} more replies |
| `actions.open` | פתיחת ההודעה | Open message |
| `actions.title` | פעולות | Actions |
| `detail.deleteBodyReplies` | ההודעה תימחק לכל הקהילה, ואיתה {n} התשובות הפרטיות שהגיעו עליה. אי אפשר לשחזר. | The message will be deleted for the whole community, with the {n} private replies it received. This can't be undone. |
| `prefs.locked` (changed) | ברכות ותשובות פרטיות אליכם תמיד מגיעות | Blessings and private replies to you always arrive |
| push `private_reply` (fixed) | תשובה פרטית חדשה | New private reply |
| push `family_blessing` (fixed) | ברכה אישית חדשה למשפחה | New personal blessing for your family |
| push `family_word` (fixed) | מילה אישית חדשה למשפחה | New personal word for your family |

Removed: `chip.celebration`, `chip.condolence` (replaced by `reply.count.*`), `detail.notAllowed` (the button is not
shown when replies are not allowed).

### 22.8 Accessibility

The reply button and "עניתם" are `button`s with the full name in the label. The lock line is part of the Composer's
accessible description, so it is read before typing. The counter is announced only once it appears (polite). Unread
dots are never the only signal: the row says "{n} חדשות" and each unread reply's label starts with "חדשה". The Sheet
from the card traps focus and returns it to the button on close. Targets 48.

### 22.9 Open for the CTO (not owner questions)

- Server work, not designed here: `canReply` / `replyTo` on the message; one reply per person (edit = `PUT`, withdraw =
  `DELETE .../replies/{r}`, both by the writer only); read markers per recipient; replies to the author; the push
  throttle; `repliesReceived` in the export; deleting the author's received replies with the account.
- Server work for §22.4a: a reply's `to` is `family` or one adult's `userId`; reads, pushes, unread markers and
  export follow it.
- **Owner to confirm:** the CTO ruled (2026-10-28) that a mazal tov or condolence posted by management still takes
  blessings (§22.1). Build it that way.

### 22.10 Verification

Rendered with headless Chromium (Playwright 1.47.2), one browser at a time: P48 phones 1, 1a, 1b, 2, 2a, 2b, 3, 3a, 3b and 4 and the
state panels at 390 × 844 in light and dark, and the page at 390 wide (no horizontal scroll). Not checked: real
devices, 360-wide Android, English, screen readers, the long-press gesture itself, web fonts, and the wide layout (the
mailbox follows the 680 content column of M3; not drawn).
