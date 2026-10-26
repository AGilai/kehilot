# Community API v1

Single-community member API, Python 3.11+, SQLite and pyluach (installed from server/requirements.txt). Audit timestamps are UTC ISO 8601; birthday, service and eligibility dates are date-only calendar values. All responses are JSON with `Cache-Control: no-store`. Authentication uses `Authorization: Bearer <token>`. Errors use `{ "error": "Hebrew message" }` and an appropriate HTTP status.

| Method | Path | Access | Behavior |
| --- | --- | --- | --- |
| GET | `/health` | Public | Service health |
| POST | `/api/register` | Public, rate limited | `{email,password,firstName,lastName}` → member session; no classification/role accepted |
| POST | `/api/login` | Public, rate limited | `{email,password}` → `{token,user:{id,email}}` |
| POST | `/api/logout` | Signed in | `{}`; revokes current session and its push registrations |
| GET | `/api/me` | Signed in | Own profile, preferences, messages, read IDs, healing prayers and seating status |
| PUT | `/api/profile` | Signed in | Replace own profile; no user ID or role accepted |
| GET | `/api/healing-prayers` | Signed in | Only the caller's requested healing names |
| POST | `/api/healing-prayers` | Signed in | `{name}`; member and Gregorian date assigned by server |
| DELETE | `/api/healing-prayers/{id}` | Owner only | Permanently remove an owned name; `{ok:true}` |
| GET | `/api/admin/healing-prayers` | Gabbai | Combined list with adding member and date |
| GET | `/api/seating` | Signed in | Current event and own household seating status |
| PUT | `/api/seating` | Household head א | Save seats unused/needed for the current event |
| GET | `/api/admin/seating/events` | Gabbai | Seating events and reporting state |
| POST | `/api/admin/seating/events` | Gabbai | Create/select a seating event |
| PUT | `/api/admin/seating/events/{id}` | Gabbai | Configure/select an existing event |
| GET | `/api/admin/seating/events/{id}/summary` | Gabbai | Household reports, defaults and seat totals |
| PUT | `/api/preferences` | Signed in | Replace all four boolean preferences |
| GET | `/api/messages` | Signed in | All announcements and replies, including muted categories |
| POST | `/api/messages/:id/replies` | Signed in | `{body}`; only celebrations and condolences; author derived from session |
| POST | `/api/messages/:id/read` | Signed in | `{}`; idempotent per-member read status |
| PUT | `/api/push-token` | Signed in | `{token}`; upsert this device's Expo token, max 20 per member |
| GET | `/api/admin/membership-requests` | Gabbai | Unclassified members who saved their personal details |
| GET | `/api/admin/members` | Gabbai | Member directory and private profiles |
| GET | `/api/admin/roster` | Gabbai | Eligible congregants and derived aliyah statistics |
| POST | `/api/admin/roster` | Gabbai | Add an independent congregant without a login |
| PUT | `/api/admin/roster/{id}` | Gabbai | Update roster details/classification |
| GET | `/api/admin/aliyah-services` | Gabbai | Recorded services and their aliyot |
| POST | `/api/admin/aliyah-services` | Gabbai | Record a Shabbat/festival service |
| PUT | `/api/admin/aliyah-services/{id}` | Gabbai | Correct or cancel a recorded service |
| POST | `/api/admin/messages` | Gabbai | Publish announcement and enqueue notifications |

### Registration and classification review

The login screen supports self-registration with separate `firstName`/`lastName`, email and a 12–128-character password. POST `/api/register` accepts exactly those four fields and returns a normal session (201). Accounts always start as `member` with no classification or seat allocation; requests cannot supply a role, classification or quota. Duplicate email returns 409. Registration attempts are persisted and limited to five per source IP per 15 minutes; login has its separate existing limits. Gabbai accounts and password resets still use the local CLI.

After registration, the app opens personal details. The first successful profile save with separate names and a Kohen/Levi/Yisrael selection records one durable `membership_requests` row and queues a private alert to each existing gabbai in `membership_outbox`. Repeated saves do not duplicate the request/alert. Profiles already classified do not generate a pending review. Pending requests appear via `/api/admin/membership-requests` and `/api/me.membershipRequests` for gabbaim only; ordinary users receive an empty list. Each request contains `{id,email,submittedAt,profile}` and never credentials. `/api/me` also returns the authenticated `role` and own `classification`.

The gabbai's Home card `מתפללים חדשים לסיווג` opens a review screen with exactly `א` or `קבוע` as classification choices. It saves through the existing gabbai-only roster PUT. Account-holder classifications are restricted to those two values; profile and registration writes cannot set either. Classification removes the request from the pending list. All changes persist in the main roster. Only active `א` household heads see the seating card or can submit reports; `קבוע` and unclassified users are blocked by the API as well as the UI. An `א` household with an unknown quota must wait for the gabbai to configure it.

Sons' classifications are persisted automatically from the father's classification and their own marriage: `דור ב` or `דור ב-נשוי` for `א`, otherwise `קבוע` for a regular-attendee household. They cannot independently become household heads through the roster endpoint. Underage sons retain their permanent community identity and receive the derived roster classification when they become eligible at 13. Married daughters' husbands are automatically added as `חתן` once the household is classified `א`; an already linked son-in-law row is reused. Their status/name comes from the daughter's spouse fields. Husband roster IDs and daughter/son IDs survive profile edits, marriage changes, reclassification and restart. Removing a daughter or marriage archives the linked husband's active status without deleting aliyah history. An already linked husband's classification follows a known household classification; legacy explicitly linked records in unclassified households are preserved.

The optional push worker sends a generic `מתפלל חדש ממתין לסיווג` alert only to registered gabbai devices, with `{screen:"membership"}` and no personal details. Opening it routes to the review screen; the pending list is available even with push disabled. Resolved requests and recipients who are no longer gabbaim are skipped. Push still requires the existing device registration, Expo/APNs/FCM configuration and `SHUL_ENABLE_PUSH=1`; physical delivery is not established by mocked tests.

Profile:

```json
{
  "name": "ישראל ישראלי",
  "firstName": "ישראל",
  "lastName": "ישראלי",
  "tribe": "yisrael",
  "phone": "050-1234567",
  "wifePhone": "+972501234568",
  "torahName": "ישראל בן אברהם",
  "wifePrayerName": "",
  "barMitzvahParasha": "לך לך",
  "birthDate": "",
  "hebrewBirthDate": { "day": 29, "month": "adar", "year": 5783 },
  "children": [
    {
      "id": "child-stable-person-id",
      "gender": "son",
      "name": "יעקב ישראלי",
      "birthDate": "",
      "hebrewBirthDate": { "day": 30, "month": "adar_i", "year": 5774 },
      "torahName": "יעקב בן ישראל",
      "barMitzvahParasha": "נח",
      "barMitzvahDate": "2018-10-13",
      "married": true,
      "spouseName": "שרה",
      "spouseTribe": "",
      "spouseTorahName": "",
      "spousePrayerName": "שרה בת רבקה"
    }
  ],
  "yahrzeits": [
    { "id": "unique-per-member", "name": "אברהם", "relationship": "father", "day": 14, "month": "tishrei", "year": "5784" }
  ]
}
```

### Mi Sheberach for the sick

The member app has a dedicated `מי שברך` tab. It shows only the signed-in member's own remaining entries, lets them add a name in the `השם ושם האם` format, and asks for confirmation before deleting an entry. Each entry displays its Gregorian addition date as `DD/MM/YYYY`. No Hebrew date, illness details or date input is collected. Existing records remain visible until the owner deletes them; cancellation leaves them intact.

The `healing_prayers` table stores a technical primary key `id` plus the three business values: `member_id` (a stable foreign key to the adding account), requested `name`, and Gregorian `added_on` (`YYYY-MM-DD`). The server derives identity from the authenticated session and dates from the current Israeli civil date. Requests cannot supply the adding member or date. Reads resolve the member's current display name, so a profile rename does not break ownership or change the addition date. The schema upgrade is additive and preserves all existing person IDs and community data.

```json
{ "name": "משה בן שרה" }
```

A successful POST returns 201 and an entry such as:

```json
{
  "id": "prayer-generated-id", "memberId": "adding-member-id",
  "memberName": "ישראל ישראלי", "name": "משה בן שרה", "addedOn": "2026-10-25"
}
```

Names are trimmed and must have 1–200 characters. An identical name already present for that same member returns 409; another member may request the same prayer name independently. Deleting and later adding the name creates a new entry/date. Unknown fields are rejected. GET and `/api/me.healingPrayers` are scoped to the caller, including for gabbai accounts. The separate admin GET requires gabbai authorization and supplies the combined list for prayer use; it does not grant deletion of another member's entries.

DELETE removes the physical row by both entry ID and authenticated owner ID. Missing or other-owned IDs return the same 404, without changing another member's data. No archival copy is retained in this table. Success returns 200 with `{ "ok": true }`, without requiring a request body. CORS preflight permits DELETE for the existing allowed origins. These endpoints do not send notifications or publish the names to ordinary members.

The app's shared state refreshes this own list with the regular `/api/me` refresh and on pull-to-refresh. Add/delete updates are committed only after server success; failures retain the current list and show an error. Demo mode persists the same feature locally under the existing demo storage key and never uploads demo names. Older saved demo state gains an empty `healingPrayers` array without losing profile, family, preferences or read status. The existing array is preserved if present. Profile updates and older clients do not replace or erase this separate server table.

### Separate member names

The member form requires `firstName` and `lastName` as separate inputs, followed by the Kohen/Levi/Yisrael dropdown. Each part can contain multiple words. Outer whitespace is trimmed; the combined display `name` is composed as first name + space + surname, with a 200-character combined limit. The home greeting uses the whole entered first name, not the first word of an unstructured full name.

When either new name field is submitted, both are required and must be nonempty strings. A new structured request may omit the derived `name`; if it is supplied, the separate fields remain authoritative. The canonical fields are saved in the profile JSON and synchronized into the existing roster's first/surname columns. The community self row keeps the derived full name. No new person ID or replacement row is created; historical aliyah name snapshots remain unchanged.

Existing unstructured full names are preserved without splitting or guessing the order. The app shows the legacy name as a read-only reference and requires the user to enter both parts when saving. If the roster already has explicitly entered first/surname values, those known parts can populate an older profile. Older clients that omit both new fields preserve known parts and their canonical display name; a differently ordered legacy full-name submission cannot overwrite them. While no separate parts are known, old-client full names remain supported as legacy data. Gabbai edits to a source-linked account holder's roster names also update that same account profile so later refreshes do not revert them.

### Kohen, Levi or Yisrael

The member form requires `tribe`: `kohen`, `levi` or `yisrael`, chosen from a dropdown immediately after the full name. Each married daughter requires an independent `spouseTribe` with one of the same values for her husband. It must be empty for sons and unmarried daughters. Changing the child's gender or turning off marriage clears this now-inapplicable spouse selection. A son has no independent `tribe` input or API field: his status follows the member/father, and the form displays that inherited value immediately when the father changes his choice.

Existing records start with `tribe: ""` and `spouseTribe: ""` (unknown); no status is guessed from names or defaulted to Yisrael. The current form requires the applicable selections before saving. For older clients, omission of either new field preserves a known value on the member or an existing active child; an omitted field on a legacy unknown record remains empty. Explicitly submitted member/son-in-law values must be one of the three choices. An old client's omitted `spouseTribe` is cleared if the child becomes a son or unmarried.

The database gains `tribe` and `spouse_tribe` text columns through an additive, idempotent migration. The member's `tribe` is stored in profile JSON and their self person row. A son's effective status is resolved through `owner_user_id` to that self row rather than copied into the son's row; this also avoids stale status on archived sons. The son-in-law value is stored in the daughter's `spouse_tribe`, alongside the existing spouse fields. IDs, creation times, archival state and family ownership are preserved; this does not introduce a separate son-in-law person/login or the future aliyah schema.

### Hebrew birthdays

Birthdays use `hebrewBirthDate`: an object with exactly `day` (integer), `month` (a predefined Hebrew month key) and `year` (integer), or `null` for an unset member birthday. The app offers years from 5700 through the current Hebrew year, rendered as Hebrew numerals. The upper limit refreshes while the app is open and when it resumes. Both app and server reject future birthdays and impossible combinations, including ordinary Adar in a leap year, Adar I/II in a common year, and day 30 in a month that has only 29 days in the selected year. Changing year/month clears an incompatible selection.

Gregorian `birthDate` values and existing yearless Hebrew birthdays are preserved without a guessed conversion. The current form requires a year for any populated Hebrew birthday; birthdays left entirely empty remain optional for members, and legacy children with a Gregorian birthday remain editable. Older clients may omit the whole birthday, or return the same day/month without the new year, to preserve existing data. A new/changed yearless Hebrew birthday is rejected. Missing birth years do not establish age or automatically promote a son.

The offline libraries are `@hebcal/hdate` (app) and `pyluach==2.3.0` (server). Install the latter with `.venv/bin/python -m pip install -r server/requirements.txt` after creating the virtual environment. See the README for setup.

The current member form requires both name parts; other text fields are optional, up to 200 characters. At most 30 yahrzeits per member. Relationships: `father`, `mother`, `son`, `daughter`, `brother`, `sister`. Hebrew months: `tishrei`, `cheshvan`, `kislev`, `tevet`, `shevat`, `adar`, `adar_i`, `adar_ii`, `nisan`, `iyar`, `sivan`, `tamuz`, `av`, `elul`. Yahrzeit days are validated against the maximum possible length of a month, not resolved into yearly anniversaries. The member form collects only a Hebrew month and a Hebrew-numeral day dropdown (א׳–ל׳), with no year input. Months that are always short omit day 30; switching to such a month clears an invalid day. Cheshvan/Kislev allow 30 because no death year is collected. New entries send `year: ""` for API compatibility; existing optional death years remain preserved in storage. No halachic recurrence decision is made.

`phone` and `wifePhone` accept an empty string or a local/international number containing 7–15 digits, an optional leading `+`, and formatting spaces, parentheses, periods or hyphens. The maximum formatted length is 40 characters. These fields are private profile data, available only to the account and authorized gabbaim.

### Children and permanent person identity

`children` contains up to 30 sons/daughters. Every entry requires `id`, `gender` (`son` or `daughter`), `name`, `birthDate`, `torahName`, `barMitzvahParasha`, `barMitzvahDate`, `married`, `spouseName`, `spouseTorahName`, `spousePrayerName`. New clients also send `hebrewBirthDate` with the structured day, month and year, and `spouseTribe` according to the rules above. A name and a valid Hebrew birthday are required for a new child created in the app. Legacy children with a valid Gregorian birthday can still be edited without reentering a Hebrew birthday. Prayer names, spouse names and bar mitzvah fields are optional strings.

For sons, `torahName` and the bar mitzvah fields are available. An optional `barMitzvahDate` remains a Gregorian Saturday; a planned future Saturday is allowed. If a legacy Gregorian birth date is present, the ceremony must be after birth. Legacy yearless Hebrew birthdays cannot support that chronological comparison. The application records the supplied ceremony date and parasha and does not infer halachic adulthood from either date. For a married son, use `spouseName` and `spousePrayerName`; for a married daughter, use `spouseName` and `spouseTorahName`. The other spouse prayer field must be empty. All spouse fields must be empty when `married` is false.

Each account and each child have separate rows in `community_people`. An account's own person ID equals its existing user ID; a child's `id` is a globally unique, permanent person ID, linked by `owner_user_id`. Children get person rows immediately, including before bar mitzvah, so boys already have independent identities when they become eligible for aliyot. No age-triggered migration, duplicate account or new login is needed. This is the identity foundation; their same IDs also anchor automatic roster entry and the aliyah history described below.

Parent ownership is checked on every write. IDs cannot be used to edit another family's child or overwrite an account's own person row. Edits use an upsert that preserves the person ID and creation timestamp. Removing a child from the submitted list archives their row (`active=0`) and keeps the identity available for future history references. A subsequent authorized update using that same ID reactivates it. Names and dates are not used as identity keys, and no automatic person merging occurs.

Children are read from their separate rows, not duplicated in the account's profile JSON. Existing databases automatically gain the table and their existing account person rows at startup. Existing profiles gain empty phone fields and child lists. For compatibility, an older client's profile update that omits `phone`, `wifePhone` or `children` preserves their current values. When present, `children` is the complete active child list; omitted children are archived. Spouse details are currently fields of the child record, not separate person or login records. The roster below adds independent congregants and optional son-in-law links; further household/account linking remains future work.

The Hebrew birthday upgrade adds a nullable `hebrew_birth_date` JSON column to `community_people` idempotently. It preserves existing Gregorian `birth_date` values, IDs, archival status and creation timestamps. Member birthdays also live in their profile JSON, matching the existing member/self storage pattern. Old local demo profiles gain `hebrewBirthDate: null` for the member and each child without changing identities or discarding their legacy dates.


### Main roster and eligibility

`roster_people` is the main congregant roster. It holds separate first/surnames, status, Torah name, wife prayer name, bar-mitzvah Shabbat/parasha, structured Hebrew birthday, a yahrzeit list and classification. Values for people linked to family profiles are refreshed from those profiles. Member-entered first/surnames synchronize from the linked profile. Existing combined names are retained as `name` until separate parts are supplied; no order is guessed. A gabbai can also enter separate names and classification using the roster endpoint.

Classification labels are exactly `א`, `דור ב`, `חתן`, `דור ב-נשוי`, `קבוע`. Household classifications are gabbai-controlled (`א` or `קבוע` for account holders). A linked son's classification is automatically stored from the father's classification and his own marriage; the endpoint does not allow a child override. An unclassified father leaves the son unclassified. Sons inherit their father's Kohen/Levi/Yisrael status. Son-in-law status is independent.

Each source roster ID equals the existing permanent `community_people.id`; no child row or account is replaced. A son with a complete Hebrew birthday receives a roster entry on his thirteenth Hebrew birthday. A server worker refreshes eligibility every 60 seconds, with additional refreshes on startup, profile saves and roster/API activity, so no login is required that day. Unknown birth years do not promote sons. Known underage independent records stay inactive until eligible. Account holders with unknown birthdays remain on the adult roster for legacy compatibility.

Eligibility uses the library's Hebrew birthday convention: ordinary Adar moves to Adar II in a leap target year; Adar I stays I when present; Adar II moves to ordinary Adar in a common year; a missing day 30 moves forward to the first day of the next month. The recorded ceremony/parasha never determines age. Dates follow the Israeli civil day, consistent with the app's date-only calendar; sunset-time activation is not implemented. Archival or birthday corrections hide an ineligible source entry but retain its ID and aliyah history.

Create an independent congregant (regular attendee or son-in-law) without creating an account:

```json
{
  "firstName": "שם פרטי", "lastName": "שם משפחה",
  "tribe": "yisrael", "classification": "קבוע",
  "torahName": "שם לעלייה", "wifePrayerName": "שם למי שברך",
  "hebrewBirthDate": { "day": 1, "month": "tishrei", "year": 5750 },
  "barMitzvahParasha": "", "barMitzvahDate": "", "yahrzeits": []
}
```

First/surname, valid status and classification are required on creation; other fields are optional. Optional `familyChildId` links a son-in-law to an existing active married daughter's permanent ID; automatic association-household linking usually creates this row first. A second roster entry for that same daughter is rejected. Independent unlinked records remain managed explicitly by the gabbai. Linked husbands use the stable daughter ID, with no merging by name. Linking an existing roster person to a new app account remains future work.

`PUT` accepts a partial update with the same fields. For source-linked people, first/surname can be edited here; household heads also allow classification and seat allocation, and sons allow their own yahrzeit lists. Child/linked-husband classifications follow the household automatically. Other family data is edited through the original profile. A self/account holder's yahrzeit list stays authoritative in that profile. Unknown fields, invalid classifications and unauthorized writes are rejected.

### Household seating

The Home card `עדכון מקומות לשבת` opens the Hebrew seating screen. Only an active household head classified `א` reports, for the **entire family**, using the household's men's-section allocation. Other family members do not submit independent requests. The event title includes the applicable parasha when the date is a Shabbat with a regular reading.

The gabbai sets `allocatedSeats` through the roster create/update endpoint. It is an integer from 0 to 1000, or `null` for an unconfigured quota, and is only allowed for classification `א`. Zero is a configured allocation; null blocks reporting and is shown separately in summaries. Changing away from `א` clears the allocation. Each allocation change increments `seatAllocationRevision`, even if the old number is later restored. Members cannot change their allocation through profile or seating writes. The migration adds these columns without replacing people or changing permanent IDs.

Each event has one server-selected mode:

| Mode | Dropdown means | Without a valid report |
| --- | --- | --- |
| `unused` | Seats **not** needed; the UI emphasizes `לא` | All allocated seats retained |
| `needed` | Seats actually needed, including an explicit zero | Zero seats retained; allocation released |

There are two separate dropdowns: Arvit (`arvit`) and Shacharit (`shacharit`), each permitting 0 through the allocated count. Only the two prayer-specific questions are shown; the additional general question and long ordinary-service explanation were removed. `לא` stays bold/red in ordinary-mode questions. In special mode each initial value is empty, requiring active selection. Saving zero is a valid report and remains distinct from no report. Members can replace their report while reporting is open. Both values are required and saved atomically in one row per household for the current event. Reports never carry to another event or reporting mode.

`GET /api/seating` and `/api/me.seating` return `{event, eligible, allocatedSeats, allocationRevision, reported, value, neededSeats, releasedSeats, reportInvalidated, updatedAt}`. `value` is `{arvit,shacharit}` when reported, otherwise null; `updatedAt` is likewise null without a valid report. `neededSeats` and `releasedSeats` are each `{arvit,shacharit}`, or null for an unconfigured/ineligible household. `event` contains `id`, `date`, `title`, `parasha`, `mode`, `occasion`, `revision`, effective `reportingOpen`, `configuredOpen`, `closesAt`, `isCurrent` and `automatic`.

Submit exactly the context displayed by GET plus both selected values:

```json
{
  "eventId": "weekly-2026-10-31", "revision": 1, "mode": "unused",
  "allocatedSeats": 4, "allocationRevision": 1, "arvit": 1, "shacharit": 3
}
```

This example retains three seats at Arvit and one at Shacharit. Household identity comes from the session; extra fields, forged identities and noninteger values are rejected. Success returns the updated status. Non-heads receive 403; stale event/mode/revision/allocation, unconfigured allocation or closed reporting return 409. The app refreshes after failure so the user can choose again. Event mode/title/occasion changes and allocation changes invalidate previous reports; the applicable no-report default then applies. Revisions prevent a change-and-change-back from silently reviving an old report. Opening or closing an event preserves otherwise valid reports. Selecting another current event deletes the previous event's reports; reselecting it cannot revive them.

To create a special event (POST returns 201):

```json
{
  "date": "2027-03-22", "title": "קריאת מגילה בערב",
  "mode": "needed", "occasion": "megillah_evening",
  "reportingOpen": true, "closesAt": "2027-03-22T18:00:00+02:00",
  "makeCurrent": true
}
```

Use the actual civil date of the evening service. Creation requires `date` (today/future) and `mode`; title defaults from the Israeli calendar. Allowed occasions are `shabbat`, `holiday`, `zachor`, `high_holidays`, `megillah_evening`, `custom`. Known Zachor/Rosh Hashanah/Yom Kippur dates and special occasion presets require `needed`; the gabbai may choose `needed` for any additional event. `closesAt` is optional/null and must include a timezone when provided; storage is UTC. `reportingOpen:false` closes reporting immediately. A date cannot be changed after creation: create a new event instead.

There is at most one current event. New events default to `makeCurrent:true`; false creates a queued event. PUT accepts partial configuration, and `makeCurrent:true` activates it while deselecting the previous one. False does not deactivate an existing current event. The current event, automatic or manual, remains selected through its civil date, even if closed, so the gabbai can use both prayer counts throughout Shabbat. When it passes, or when none is selected, the server creates/selects the next future Saturday, calculating the Israeli parasha offline with pyluach. Automatic Shabbat Zachor and High Holidays use `needed`; ordinary Shabbat uses `unused`. The automatic default deadline is Saturday 00:00 in Israel and can be overridden by the gabbai. Reporting closure does not advance the event or delete that day's reports. Weekday holidays and evening Megillah events must be scheduled/selected by the gabbai. Queued manual events are not automatically activated.

`seating_events` stores event configuration; `seating_reports` stores household/person FK, submitter, revisions, allocation snapshot, both selected values and canonical needed seats per prayer and update timestamp. Reports survive server restart and profile saves until the event passes. Past reports and past event configurations are physically deleted after the event's civil date (for Shabbat: Sunday 00:00 Israel), by the running 60-second worker and on startup/seating access. Only the selected current event can retain reports; future queued event configuration may remain. No seating history is kept. Aliyah history and permanent person records are unaffected. The schema upgrade discards legacy single-number reports rather than guessing which prayer they refer to; those households must report both numbers again. The gabbai summary lists active `א` households with their current status plus `totalAllocated`, `totalNeeded`, `totalReleased`, `unreportedHouseholds` and `unconfiguredHouseholds`. `totalNeeded` and `totalReleased` are separate `{arvit,shacharit}` totals; `totalAllocated` is the household allocation total. Totals use the **current roster and allocations**, including the correct no-report defaults; they are not frozen historical allocation summaries. Unknown quotas are counted separately and do not contribute invented seats.

Demo mode uses four fictional allocated seats and local persistence only. Real quotas are never guessed. The gabbai configuration/summary APIs are implemented; event/quota/summary management screens remain future work; the new-member classification screen is implemented.

### Aliyah services, calls and rolling statistics

`aliyah_services` records the Israeli civil date, `shacharit` or `mincha`, the Torah reading/parasha label, cancellation flag and recording gabbai. `aliyah_calls` links each service position to a permanent roster person ID and keeps the name at recording. Dates must be past/today and a Shabbat or festival in Israel. Ordinary weekdays and calls before a known eligibility date are rejected. Historical records may reference an archived person. Records are retained beyond the counting window so the last aliyah is still available.

```json
{
  "date": "2026-10-24", "service": "shacharit", "reading": "פרשת לך לך",
  "calls": [
    { "position": "ראשון", "personId": "permanent-person-id" },
    { "position": "מפטיר", "personId": "another-person-id" }
  ]
}
```

There is one record per date/service and one person per position. Duplicate creations return 409; duplicate positions or unknown people return 400. A successful `PUT` replaces that service's complete call list atomically and does not add another copy. Add `cancelled: true` to exclude a mistaken service from statistics while retaining its record. Invalid replacements leave the original intact. The same person can have separately recorded calls; statistics count actual call rows, not unique service dates.

`GET /api/admin/roster` exposes `windowMonths` (6 for Kohanim/Leviim, 12 for Yisraelim), `aliyahCount`, `lastAliyahDate` and `lastAliyah`. The window uses rolling Gregorian calendar months, clamped at shorter month ends, with an inclusive lower cutoff and today as the upper cutoff. It never resets on January 1 or Rosh Hashanah. Cancelled services and future dates are excluded. Unknown status yields a null window/count rather than assuming a tribe.

The latest aliyah is selected from all available history, independently of the counting window, and rendered as Hebrew date plus the stored reading. With no recorded aliyah, `lastAliyahDate` is null and `lastAliyah` is exactly `לא נמצא`; a known status then has count 0. All roster/history endpoints require gabbai authentication and remain private to ordinary members. The gabbai aliyah UI remains future work; new-member classification is available in the app.

Preferences:

```json
{ "weekly": true, "community": true, "replies": true, "events": true }
```

Announcement input:

```json
{ "category": "celebration", "title": "מזל טוב", "body": "תוכן ההודעה", "pinned": false }
```

Categories: `weekly`, `celebration`, `condolence`, `event`. Title max 200 characters; announcement body max 10,000; reply max 1,000. Extra input fields are rejected for profiles, preferences, announcements and replies. A member cannot choose an author, edit another member's profile or change a role. Replies notify prior participants and the announcement author when `replies` is enabled; announcement preferences are independent.

Self-registration creates only unclassified member accounts; there are no administrator default credentials. Gabbai creation, optional member provisioning and password reset use local CLI commands. Passwords use PBKDF2-HMAC-SHA256 with 600,000 iterations and per-account salts; session tokens are random and stored hashed in SQLite, expire after 30 days, and are revoked on password reset. Native clients keep the session in SecureStore; the optional browser client uses tab-scoped sessionStorage. Login limits are persisted for both IP and account. The HTTP handler ignores forwarded IP headers. Apply additional request limits at the deployment proxy before production use.

The stdlib HTTP server is a development/pilot entry point. Keep it behind HTTPS for remote use. One server process owns the optional push worker. SQLite and WAL files contain member data; keep the database directory private and back it up consistently. API and push tests use temporary databases and mocked Expo transport; they do not prove delivery through APNs/FCM.

---

## v2 (cloud)

The serverless API (API Gateway HTTP API, one Lambda, DynamoDB, Cognito). Everything above this heading is the v1 local server and is kept until it is retired. v2 is the contract for the multi-community app.

### Conventions

- Base URL: the `api_url` Terraform output. All paths below start with `/v1` except `/health`. Bodies are JSON objects (max 16 KB; `isBase64Encoded` bodies are decoded). Responses are JSON; 204 has an empty body.
- Authentication: `Authorization: <Cognito ID token>` (the `Bearer ` prefix is accepted). A missing or invalid token is rejected by API Gateway with 401 before the Lambda runs (that body is API Gateway's own, not an error code). Public routes: `GET /health` and `GET /v1/invites/{code}`.
- Errors are codes only: `{"error": "<snake_case_code>"}`. The server never sends prose; the app translates the code. IDs (`kehilaId`, `userId`, `channelId`, `messageId`, `replyId`) are 26-character ULIDs.
- Roles: `listener`, `member`, `gabbai`. A caller who is not in the Kehila gets 404 `kehila_not_found` (a Kehila's existence is not revealed); a caller whose role is too low gets 403 `forbidden`. Listeners see only channels with `listenersCanRead = true`, and cannot post, reply, join, create invites or see the member list.
- Text limits: names 60 characters, title 120, body 4000, reply 1000. Supported `lang`: `he`, `en`.
- **Retry on `try_again`**: HTTP 409 (or 503 from a batch read) with `{"error": "try_again"}` means a DynamoDB transaction conflicted. Nothing was changed; the client should retry the same request after a short delay (about 0.5 s, a few attempts).
- **Change feed hold-back**: `GET /changes` never returns changes younger than 2 seconds (`HOLD_BACK_MS = 2000`), because IDs are generated on several containers and a change can commit after a later one. A change written now appears in the feed after about 2 s plus the next poll. The `cursor` the feed returns never passes the hold-back line.

### Routes

"Any" means listener, member or gabbai of that Kehila. `{k}` is the Kehila ID.

#### Health and profile

| Method | Path | Role | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | `/health` | public | - | 200 `{ok:true}` | - |
| GET | `/v1/me` | signed in | - | 200 `{userId, email, profile, kehilot:[{kehilaId, name, role, logoVersion}]}`; `profile` is `{firstName, lastName, lang}` or null | - |
| PUT | `/v1/me/profile` | signed in | `{firstName (required), lastName?, lang: "he"\|"en"}` | 200 `{firstName, lastName, lang}` | 400 `invalid_body`, `invalid_json`, `invalid_first_name`, `invalid_last_name`, `invalid_lang` |
| PUT | `/v1/me/devices` | signed in | `{token: "ExponentPushToken[...]", platform: "ios"\|"android"\|"web"}` | 204; a token already registered to another user moves to the caller | 400 `invalid_token`, `invalid_platform`, `invalid_body` |
| DELETE | `/v1/me/devices/{token}` | signed in | the token in the path, percent-encoded (`ExponentPushToken%5Bxxxx%5D`) | 204, also when it was not registered | - |
| DELETE | `/v1/me` | signed in | - | 204; deletes the account's data (names on messages are blanked, counts are kept) and the Cognito user | 409 `last_gabbai` (sole gabbai of any Kehila: hand over first), 500 `internal` (**retry the same request**: the operation is idempotent and a retry finishes the job; the client may repeat it until it gets 204). After success the account is a tombstone for 1 day: any signed-in call with the old token returns 401 `account_deleted` (the app should sign out), except a repeated `DELETE /v1/me`, which still answers 204 |

#### Kehila, invites and joining

| Method | Path | Role | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | `/v1/kehilot/{k}` | any | - | 200 `{kehilaId, name, role, classification, logoVersion, canBroadcast, pendingRequest, notify:{mutedChannels, mutedTypes, membersBroadcasts, mutedMembers}, settings:{pollSeconds}}` (`canBroadcast`: the caller's flag; `pendingRequest`: a membership request of the caller is waiting; `notify`: the caller's push preferences with defaults `[]`, `[]`, `"all"`, `[]` filled in) (`logoVersion` is a string that changes with every logo upload, or null when the Kehila has no logo: the app caches the logo by it) (`pollSeconds` default 30, 5 in dev: how often the app polls `/changes`) | 400 `invalid_kehila_id`, 404 `kehila_not_found` |
| GET | `/v1/kehilot/{k}/logo` | any | - | 200 `{logoVersion, contentType: "image/png", data}` where `data` is the base64 PNG (square, 64-512 px, at most 64 KB). Fetch it again only when `logoVersion` changes | 400 `invalid_kehila_id`, 404 `kehila_not_found` (not a member, same as the Kehila route), 404 `not_found` (no logo set) |
| POST | `/v1/kehilot/{k}/invites` | member, gabbai | `{uses?: 1-50 (10), days?: 1-30 (7), role?: "listener"\|"member" (listener), classification?: ""\|"א"\|"קבוע"}` or no body | 201 `{code, expiresAt}`; the code makes a **listener** or a **member**. `role: "member"` needs a gabbai; `classification` only with `member` | 400 `invalid_uses`, `invalid_days`, `invalid_role`, `invalid_classification`, 403 `forbidden` (a member asking for a member invite), 404 |
| GET | `/v1/invites/{code}` | **public** | - | 200 `{kehilaName, role, expiresAt}` | 404 `invite_not_found`, 410 `invite_expired` |
| POST | `/v1/invites/{code}/accept` | signed in | - | 200 `{kehilaId, role}` (`listener`, `member`, or `gabbai` for an admin-CLI code). A `member` code sets the classification from the invite and `canBroadcast` from the Kehila default (`memberBroadcastDefault`), and removes any pending request. A caller who is already a **listener** is upgraded to member by a member code (one transaction, one use consumed); every other existing membership gets 409 `already_member` | 404 `invite_not_found`, 409 `profile_required`, `already_member`, `try_again`, 410 `invite_expired` |
| POST | `/v1/kehilot/{k}/membership-request` | listener | - | 202 `{}`; gabbaim get a push | 403, 404, 409 `already_requested` |
| DELETE | `/v1/kehilot/{k}/membership` | any | - | 204 (leave) | 409 `last_gabbai`, `try_again` |

Invite codes are 10 characters, Crockford base32, case-insensitive (`I`, `L` read as 1, `O` as 0). Gabbai codes are created only by `tools/kehila_admin.py`.

#### Management (gabbai)

| Method | Path | Request | Response | Errors |
| --- | --- | --- | --- | --- |
| GET | `/v1/kehilot/{k}/admin/requests` | - | 200 `[{userId, displayName, createdAt, previouslyRejected}]`, oldest first | - |
| POST | `/v1/kehilot/{k}/admin/requests/{userId}/approve` | `{classification: "" \| "א" \| "קבוע"}` | 200 `{}`; the listener becomes a member (`canBroadcast` = the Kehila's `memberBroadcastDefault`) | 400 `invalid_classification`, 404 `request_not_found`, 409 `not_a_listener`, `try_again` |
| POST | `/v1/kehilot/{k}/admin/requests/{userId}/reject` | - | 200 `{}`; the user stays a listener and may ask again | 404 `request_not_found`, 409 `try_again` |
| POST | `/v1/kehilot/{k}/admin/import` | `{rows: [{firstName, lastName, email, role: "listener"\|"member"\|"gabbai", classification: ""\|"א"\|"קבוע"}]}`, 1-10 rows, body at most 64 KB (the client sends longer lists in batches) | 200 `{results: [{index, status, error?}]}`, one per row in order. `status`: `created` (new Cognito account + profile + membership), `added` (the email already had an account: membership added), `upgraded` (a listener became member or gabbai; any pending request is removed), `skipped` (the Lambda was running out of time: the row was not looked at, send it again), `exists` (already a member or gabbai, or a listener row for an existing member: left as it is), `invalid` with `error` one of `invalid_email`, `invalid_first_name`, `invalid_last_name`, `invalid_role`, `invalid_classification`, `duplicate_email` (same email earlier in the batch, case-insensitive). Results never contain names or emails. Emails are trimmed and lower-cased. New accounts are `CONFIRMED` with a verified email and a random password nobody knows (no email is sent): people sign in through "forgot password" or Google/Apple. An existing profile is never overwritten. An existing account that cannot use "forgot password" (status FORCE_CHANGE_PASSWORD, RESET_REQUIRED or UNCONFIRMED) is normalised: confirmed, email verified, and its password replaced by a random one (a temporary password from the CLI stops working: the person uses "forgot password"). A CONFIRMED account whose email is not verified only gets `email_verified=true` (its password is kept); a CONFIRMED, verified account is never touched. Idempotent by email: a re-import gives `exists`. Valid rows are imported even when others are invalid | 400 `invalid_body`, `invalid_json`, `invalid_rows`, 403, 409 `try_again` (retry the same batch) |
| GET | `/v1/kehilot/{k}/admin/members` | - | 200 `[{userId, displayName, role, classification, canBroadcast}]` | - |
| PUT | `/v1/kehilot/{k}/admin/members/{userId}` | any of `{role, classification, canBroadcast}` | 200 `{}` | 400 `invalid_body`, `invalid_role`, `invalid_classification`, `invalid_can_broadcast`, 404 `member_not_found`, 409 `role_change_not_allowed` (roles change only between member and gabbai; to or from listener is refused), `last_gabbai`, `try_again` |
| DELETE | `/v1/kehilot/{k}/admin/members/{userId}` | - | 204 | 404 `member_not_found`, 409 `last_gabbai`, `try_again` |
| PUT | `/v1/kehilot/{k}/admin/broadcast` | `{allow: bool}` | 200 `{}`; sets `canBroadcast` on every member | 400 `invalid_allow` |
| POST | `/v1/kehilot/{k}/admin/channels` | `{name, listenersCanRead: bool, postPolicy: "management"\|"broadcasters"}` | 201 `{channelId, name, listenersCanRead, postPolicy}` | 400 `invalid_name`, `invalid_listeners_can_read`, `invalid_post_policy` |
| PUT | `/v1/kehilot/{k}/admin/channels/{c}` | same as create | 200 channel | 400 as create, 404 `channel_not_found` |

A new Kehila (admin CLI) has the channels `announcements` (listeners can read, management posts), `simchas` and `condolences` (members only; members with `canBroadcast` may post).

#### Channels and messages

| Method | Path | Role | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | `/v1/kehilot/{k}/channels` | any | - | 200 `[{channelId, name, listenersCanRead, postPolicy, canPost}]`, only channels the caller can read | - |
| GET | `/v1/kehilot/{k}/members` | member, gabbai | - | 200 `[{userId, displayName}]` for roles `member` and `gabbai`, sorted by `displayName` (listeners are never included; used to pick a target family) | 403 `forbidden` (listener), 404 `kehila_not_found` |
| POST | `/v1/kehilot/{k}/messages` | gabbai, or member with `canBroadcast` where `postPolicy` is `broadcasters` | `{channelId, type: "weekly"\|"celebration"\|"condolence"\|"event", title, body?, targetMemberId?}` | 201 message (below) | 400 `invalid_channel_id`, `invalid_type`, `invalid_title`, `invalid_body`, `invalid_target_member_id` (target only on `celebration` and `condolence`, and must be a member or gabbai of this Kehila), 403 `forbidden`, 404 `channel_not_found`, 429 `broadcast_limit` (members only, `broadcastDailyLimit` per day, default 3) |
| GET | `/v1/kehilot/{k}/messages?limit=&before=` | any | `limit` 1-50 (20), `before` = a messageId | 200 `[message]`, newest first, only visible ones | 400 `invalid_limit`, `invalid_before` |
| GET | `/v1/kehilot/{k}/messages/{m}` | any | - | 200 message | 404 `message_not_found` (hidden and missing look the same) |
| DELETE | `/v1/kehilot/{k}/messages/{m}` | gabbai or the author | - | 204 | 403 `forbidden`, 404 `message_not_found`, 409 `try_again` |
| POST | `/v1/kehilot/{k}/messages/{m}/join` | member, gabbai | - | 200 `{joinCount, joined:true}`; idempotent per user | 404 `message_not_found`, 409 `try_again` |
| POST | `/v1/kehilot/{k}/messages/{m}/read` | any | - | 204; idempotent; a private read marker (only that user's feed sees it) | 404 `message_not_found` |

Message object: `{messageId, channelId, type, title, body, authorId, authorName, authorKind: "management"\|"member", joinCount}`. `GET .../messages` and `GET .../messages/{m}` add `read: bool` (whether the caller read it; other users' reads never show; feed items carry no `read`, the `read` change kind covers it). When the message has a target it also carries `targetMemberId`, `targetName` (the family's display name) and `replierCount` (the number of distinct repliers: a count only, never who replied or what they wrote).

#### Private replies (blessings)

A reply can be posted only to a message that has a `targetMemberId`. Replies are **private**: only the reply's author and the message's target can read them. Gabbaim have no exception; they see `replierCount` on the message and nothing more.

| Method | Path | Role | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| POST | `/v1/kehilot/{k}/messages/{m}/replies` | member, gabbai | `{body}` (1-1000) | 201 `{replyId, authorId, authorName, body, createdAt}` | 400 `invalid_body`, 404 `message_not_found`, 409 `replies_not_allowed` (no target), `cannot_reply_to_own` (the target), `target_left` (the target is no longer a member: hide the reply box), `try_again` |
| GET | `/v1/kehilot/{k}/messages/{m}/replies` | any | - | 200 `[reply]`, only the ones the caller may see (empty for everyone else) | 404 `message_not_found` |

#### Change feed and notification preferences

| Method | Path | Role | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | `/v1/kehilot/{k}/changes?since=<cursor>` | any | no `since`: ask for the starting cursor | 200 `{cursor, more, changes:[{kind, id, item}]}`; without `since`, `changes` is empty and `cursor` is the point to start from | 400 `invalid_since`; 200 `{resync:true}` when `since` is older than 30 days (reload everything with the list routes, then start a new feed) |
| PUT | `/v1/kehilot/{k}/me/notify` | any | any of `{mutedChannels:[channelId], mutedTypes:[type], membersBroadcasts:"all"\|"management_only", mutedMembers:[userId]}`; only the fields sent change | 200 `{}`; push preferences only, they never change what lists or the feed return | 400 `invalid_body`, `invalid_muted_channels`, `invalid_muted_types`, `invalid_members_broadcasts`, `invalid_muted_members` |

Feed use: call without `since`, store `cursor`, then every `pollSeconds` call with `since=<stored cursor>`, apply the changes, and store the returned `cursor`. While `more` is true call again at once. Up to 200 changes per page. Changes are applied by `kind`:

| kind | `item` | Meaning |
| --- | --- | --- |
| `message` | message object | new message in a channel the caller can read |
| `message_removed` | `{id}` | the message was removed |
| `join` | message object (new `joinCount`) | someone joined |
| `reply_count` | message object (new `replierCount`) | a new distinct replier. Channel-wide, so gabbaim and others learn the count only |
| `reply` | reply object plus `messageId` | a new private reply. Only the reply's author and the target receive it |
| `read` | `{messageId}` | the caller read it (only the caller's own feed) |

A change is skipped if the object is no longer visible to the caller. The feed is subject to the 2 s hold-back above.

### Push notifications

Posting a message, a reply or a membership request queues a job (SQS); a worker sends it through Expo. Payload data carries `{kehila, messageId}` or `{kehila, screen}` only; the title is the Kehila's name and the text is generic and in the recipient's language. A device Expo reports as `DeviceNotRegistered` is removed.

### Error codes

| Status | Code | Meaning |
| --- | --- | --- |
| 400 | `invalid_body`, `invalid_json` | body missing, not an object, over 16 KB, or not JSON |
| 400 | `invalid_<field>` | a field is missing or malformed (`invalid_first_name`, `invalid_title`, `invalid_channel_id`, `invalid_kehila_id`, `invalid_target_member_id`, `invalid_token`, `invalid_since`, `invalid_limit`, `invalid_before`, ...) |
| 401 | `account_deleted` | the account was deleted with `DELETE /v1/me` and the token is still valid: sign out, do not retry |
| 403 | `forbidden` | role is too low for this route |
| 404 | `not_found` | no such route |
| 404 | `kehila_not_found`, `channel_not_found`, `message_not_found`, `member_not_found`, `request_not_found`, `invite_not_found` | missing, or hidden from the caller |
| 405 | `method_not_allowed` | the path exists with another method |
| 409 | `try_again` | transaction conflict: retry the same request (also returned as 503 by a batch read that stayed incomplete) |
| 409 | `already_member`, `already_requested`, `not_a_listener` | state conflicts when joining or approving |
| 409 | `profile_required` | save a profile before accepting an invite |
| 409 | `last_gabbai` | the action would leave the Kehila with no gabbai |
| 409 | `role_change_not_allowed` | role changes are only member and gabbai |
| 409 | `replies_not_allowed`, `cannot_reply_to_own` | reply rules |
| 409 | `target_left` | the message's target family is no longer a member of the Kehila (left, removed or deleted): the app should hide the reply box |
| 410 | `invite_expired` | expired or used up |
| 429 | `broadcast_limit` | a member's daily message limit |
| 500 | `internal` | unexpected failure; nothing is leaked, retry later |

`witness_changed` is internal (retried by the server) and never reaches clients.
