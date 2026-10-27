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
| Tone | Plain, warm, short. Sentence case, active verbs, one name per action ("פרסום" everywhere, toast says "פורסם"). Hebrew dates in letters (ט״ו בחשוון תשפ״ז). | Members are mixed ages and tech comfort. |
| Accessibility | Touch targets 48 dp, 12.5 px minimum text, contrast checked against both palettes, status never by colour alone (icons and words), full dark mode following the device. | |
| Direction | Logical properties throughout. Back arrow points right, forward points left. Switches slide toward the end (left). Timelines and meters fill from the right. Phone numbers and times stay LTR inside RTL text. | |

Not copied from the current app: its palette, its category symbols and its plain list layout.

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
| P11 | גבאי · חברים ומשפחות | Each member card (and a "family" column on wide) gets one line: "family with X · children: n" or "no partner". "פעולות" shows a read-only family block (adults, children with birth year, read-only note). "קישור לבן/בת זוג" (only if no partner) opens a Sheet: first person fixed, PickList of members and gabbaim without a partner, what will happen, button with both names. No phone numbers on this screen. | 409 already linked (Banner in Sheet), success (Sheet closes, toast). | Card, Tag, Toggle, Button, Sheet, **PickList** |
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
sets. Frames: `design/mockups/frames/P17.html` (types) and `P18.html` (role tags, 12.6), index section "ה". Like the
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

### 12.4 Messages (P17 phone 4, panel "יש גם קבוצה או שיחה")

**Decision: hide the channel chip row when the person sees only one channel** (`channels.length <= 1`). "כל
הערוצים" plus one chip filters nothing. The row returns, unchanged from §11.2, as soon as there is a group channel
or a conversation channel. Listeners almost always see one channel, so for them the row is gone.

**Decision: no type filter.** The feed of one Kehila is short; the stripe colour and the type label already make a
mazal tov or a condolence findable at a glance; muting by type already exists in notification preferences (M5); a
third filter row would bring back the clutter §11.2 removed. Revisit only if a Kehila posts many types daily.

**Meta line** of `MessageRow` and M3: the type label replaces the channel name, which used to carry the type
("שמחות · 14:50"): `{type} · {time}`, and `{type} · {channel} · {time}` when the person sees more than one channel.
Chat messages keep the channel name. No new strings: it reuses the 12.1 labels.

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
