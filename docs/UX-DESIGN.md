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
