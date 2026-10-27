# Community API v1

Single-community member API, Python 3.11+, SQLite and pyluach (installed from server/requirements.txt). Audit timestamps are UTC ISO 8601; birthday, service and eligibility dates are date-only calendar values. Responses are JSON, except authenticated PDF downloads; both use `Cache-Control: no-store`. Authentication uses `Authorization: Bearer <token>`. Errors use `{ "error": "Hebrew message" }` and an appropriate HTTP status.

| Method | Path | Access | Behavior |
| --- | --- | --- | --- |
| GET | `/health` | Public | Service health |
| POST | `/api/register` | Retired | 410; use verified phone sign-in |
| POST | `/api/auth/phone/request` | Public, rate limited | `{phone}` → `{challengeId,expiresIn:300,retryAfter:60}` |
| POST | `/api/auth/phone/verify` | Public, rate limited | `{challengeId,code}` → session after SMS possession check |
| POST | `/api/login` | Legacy unlinked accounts only | Existing email/password compatibility; linked accounts require SMS |
| POST | `/api/logout` | Signed in | `{}`; revokes current session and its push registrations |
| GET | `/api/me` | Signed in | Own profile, preferences, messages, read IDs, healing prayers and seating status |
| GET | `/api/community-settings` | Signed in | Community yahrzeit custom |
| PUT | `/api/admin/community-settings` | Gabbai | `{yahrzeitCustom:"ashkenaz"\|"sephardi"}`; persist community policy |
| PUT | `/api/profile` | Signed in | Replace own profile; no user ID or role accepted |
| GET | `/api/healing-prayers` | Signed in | Only the caller's requested healing names |
| POST | `/api/healing-prayers` | Signed in | `{name}`; member and Gregorian date assigned by server |
| POST | `/api/healing-prayers/{id}/keep` | Owner only | `{cycleId}`; renew a due name and update its record date |
| DELETE | `/api/healing-prayers/{id}` | Owner only | Permanently remove an owned name; `{ok:true}` |
| GET | `/api/admin/healing-prayers` | Gabbai | Combined list with adding member and date |
| GET | `/api/seating` | Signed in | Current event and own household seating status |
| PUT | `/api/seating` | Household head א | Save seats unused/needed for the current event |
| GET | `/api/admin/seating/events` | Gabbai | Seating events and reporting state |
| POST | `/api/admin/seating/events` | Gabbai | Create/select a seating event |
| PUT | `/api/admin/seating/events/{id}` | Gabbai | Configure/select an existing event |
| GET | `/api/admin/seating/events/{id}/summary` | Gabbai | Household reports, defaults and seat totals |
| PUT | `/api/preferences` | Signed in | Replace all four boolean preferences |
| GET | `/api/messages` | Signed in | Community announcements/replies plus only the caller's active personal reminders |
| POST | `/api/messages/:id/replies` | Signed in | `{body}`; only celebrations and condolences; author derived from session |
| POST | `/api/messages/:id/read` | Signed in | `{}`; idempotent per-member read status |
| PUT | `/api/push-token` | Signed in | `{token}`; upsert this device's Expo token, max 20 per member |
| GET | `/api/admin/association-members` | Gabbai | Imported association phone list and registration state |
| POST | `/api/admin/association-members/import` | Gabbai | `{name,base64}` .xlsx; atomic additive import |
| GET | `/api/admin/members` | Gabbai | Member directory and private profiles |
| GET | `/api/admin/classifications` | Gabbai | Shared built-in and custom classification dropdown options |
| POST | `/api/admin/classifications` | Gabbai | `{name}`; create a reusable classification |
| GET | `/api/admin/people/{id}` | Gabbai | Full editable person/family details, classification, allocation and statistics |
| PUT | `/api/admin/people/{id}` | Gabbai | Atomic personal-data edit with family synchronization |
| GET | `/api/admin/aliyah-recommendations/calendar?year=5787` | Gabbai | Actual dated Shabbat/Yom Tov choices for a Hebrew year |
| GET | `/api/admin/aliyah-recommendations?date=2026-10-31` | Gabbai | Date-specific events and ranked aliyah recommendations |
| GET | `/api/admin/aliyah-template?date=YYYY-MM-DD` | Gabbai | Israeli calendar reading and required slots; optional `service=mincha` on Yom Kippur |
| POST | `/api/admin/aliyah-records` | Gabbai | Complete morning aliyot with guests and minimum validation |
| PUT | `/api/admin/aliyah-records/{id}` | Gabbai | Correct a complete morning record atomically |
| POST | `/api/admin/weekly-documents` | Gabbai | Publish a PDF weekly schedule and enqueue announcement notifications |
| GET | `/api/documents/{id}` | Signed in | Authenticated PDF bytes; no public URL or token in URL |
| GET | `/api/admin/roster` | Gabbai | Eligible congregants and derived aliyah statistics |
| POST | `/api/admin/roster` | Gabbai | Add an independent congregant without a login |
| PUT | `/api/admin/roster/{id}` | Gabbai | Update roster details/classification |
| GET | `/api/admin/aliyah-services` | Gabbai | Recorded services and their aliyot |
| POST | `/api/admin/aliyah-services` | Gabbai | Record a Shabbat/festival service |
| PUT | `/api/admin/aliyah-services/{id}` | Gabbai | Correct or cancel a recorded service |
| POST | `/api/admin/messages` | Gabbai | Publish announcement and enqueue notifications |

### Messages inbox and phone notifications — October 27, 2026

The Messages screen combines community messages with the caller's pending Mi Sheberach reminders. A private reminder is derived from the current healing cycle, never inserted into the shared `messages` table. Its DTO uses `id:"healing-reminder-<cycleId>"`, `kind:"healing"`, `category:"event"` for compatibility, and `healing:{prayerId,cycleId,expiresOn}`. The title/body include the requested name only in authenticated owner responses. `/api/messages` and `/api/me.messages` enforce this scope even for gabbai accounts; internal `list_messages()` without a caller still returns only community content. The UI has a separate personal-reminder filter.

Opening a message sends POST `/api/messages/:id/read` with `{}`. Community receipts remain in `reads`; a private read updates nullable `healing_cycles.read_on` after checking the caller's current cycle. Unknown/foreign/expired IDs return 404; repeated owner reads are idempotent. `/api/me.readIds` includes current read private IDs across restarts. Reading changes neither the record date nor expiry and does not answer keep/remove. Keep, delete or automatic expiry resolves the private message/read state; the next cycle has a new unread ID. Private reminders have no community reply endpoint. The red dot on Messages remains while any message is unread; opening the list alone does not mark cards read. Reminder details contain keep/remove controls and the exact deadline.

New push payloads use `data:{screen:"messages",messageId}`, generic visible text, default sound, high priority and Android channel `messages` (HIGH importance). Foreground alerts show a banner. Live and cold-start notification taps open the Messages **list**; legacy message-ID-only and healing payloads remain supported. Handled saved responses are cleared to avoid later replay. The Messages screen and Preferences both offer explicit OS permission/device registration. Already-authorized physical devices re-register on login, foreground entry and native token changes without another prompt; concurrent registrations are suppressed.

Real delivery requires an Expo project ID, Apple APNs / Firebase FCM credentials and `SHUL_ENABLE_PUSH=1`; these are absent/disabled in the preview. Builds remain local. Actual simulator banner display and cold-start tapping were verified with local `simctl push`, which does not verify Apple/Firebase/Expo network delivery.

### Community yahrzeit custom — October 26, 2026

`server/settings.py` adds the singleton `community_settings` table, with nullable `yahrzeit_custom`, updater FK and UTC update time. Existing/new databases start with no selected custom; startup never guesses or resets a saved choice. GET `/api/community-settings` and `/api/me.communitySettings` return `{yahrzeitCustom:null|"ashkenaz"|"sephardi"}`. Only a gabbai may PUT `/api/admin/community-settings`, with exactly `{yahrzeitCustom:"ashkenaz"}` or `{yahrzeitCustom:"sephardi"}`. Invalid/extra/null values return 400; an ordinary member's write returns 403. Personal notification preferences remain separate and cannot set this policy.

The gabbai's **העדפות → הגדרות הקהילה → מנהג חישוב יארצייט** selector saves immediately to the server. This is shared across the community/devices, not an individual notification preference. Recommendation responses include `yahrzeitCustom` and a policy note; an open report refreshes when a background state refresh sees a changed custom. Printed reports keep the custom and original-date reminders of their loaded snapshot.

The following rules implement the user's specified community policy:

| Saved date | עדות המזרח (`sephardi`) | אשכנז (`ashkenaz`) |
| --- | --- | --- |
| Regular Adar in a leap year | Adar II | Adar I |
| Explicit Adar I/II in a regular year | Adar | Adar |
| Explicit Adar I/II in a leap year | Keep saved month | Keep saved month |
| ל׳ Cheshvan/Kislev when that year's month has 29 days | First of the next month only | Both 29th and first of next month |
| ל׳ Cheshvan/Kislev when that year's month has 30 days | Keep the 30th only | Keep the 30th only |

The Ashkenaz two-date simplification applies **only when the 30th is missing**. When it exists, both customs include a person only if the actual 30th falls inside `[service date, service date+7]`, inclusive, without the adjacent-date fallback/reminder. Its candidate on the 29th is included at the report's inclusive +7 boundary, so in a short month, when the 29th is Shabbat, the person appears on Shabbat the 22nd and Shabbat the 29th. Both reports retain `תאריך הפטירה: ל׳ חשוון` / `ל׳ כסלו` and `יש לבדוק עם המתפלל כיצד הוא נוהג`. Each event has `needsReview:true`; two candidate dates in one report remain in the same person's row. Yahrzeit events additionally return `recordedDay`, `recordedMonth`, and yearless `recordedHebrewDate`, separate from effective `date`/`hebrewDate`. Original dates are never rewritten.

Configured Adar mappings and the Sephardi Cheshvan/Kislev shift are resolved dates with `needsReview:false`. Until a custom is chosen, the earlier flagged-candidate fallback remains and report notes request a selection. The user has not defined a special policy for ל׳ Adar I in a non-leap year; that otherwise-invalid date retains flagged adjacent-date candidates. No new native dependencies are needed for these settings/rules.

### Aliyah recommendations — October 26, 2026

`server/recommendations.py` provides the two gabbai-only, no-store GET endpoints above (401 without a session; 403 for ordinary members). The calendar's optional Hebrew `year` defaults to the next service's year and accepts 5700 through the dynamically current Hebrew year + 10. It returns `{year,yearLabel,defaultDate,years:[{value,label}],services:[service]}`. A service is `{date,key,service,reading,parashot,hebrewDate,year,yearLabel,title}`. `key` is `YYYY-MM-DD:shacharit` or `YYYY-MM-DD:mincha`; use it rather than date alone to distinguish Yom Kippur’s two choices. Choices are actual Shabbatot/Israeli Yom Tov days, with separate Rosh Hashanah days and separate `יום כיפור - שחרית` / `יום כיפור - מנחה` choices on Yom Kippur. Weekday Chol Hamoed, Purim and Chanukah are excluded. Default is today when a service day, otherwise the next such day within a week. Calculations use the offline Israeli calendar.

The report’s optional ISO `date` defaults to that service. Optional `service` defaults to `shacharit`; `mincha` is accepted only on Yom Kippur (otherwise 400). It must be a valid service in the same year range; invalid input returns 400. It returns `{service,yahrzeitCustom,eventWindowEnd,sections,notes}`. Ordinary Shabbat title: `שבת פרשת <reading> - <Hebrew year>`; holidays use their name with `שבת` when applicable. Sections always appear in this order:

| id | title | cap / filter |
| --- | --- | --- |
| events | אירועים | All eligible people with matching events; no cap |
| kohen | כהנים | 15 Kohanim, any classification |
| levi | לוויים | 15 Leviim, any classification |
| israel_a | ישראל | 25 Yisrael, exact `א` |
| israel_b | ישראל — דור ב׳ | 35 Yisrael, exact `דור ב`; excludes `דור ב-נשוי` |
| israel_regular | ישראל — קבוע | 10 Yisrael, exact `קבוע` |

Each section is `{id,title,limit,people}` (null limit for events). Each person is `{id,tribe,firstName,lastName,name,torahName,wifePrayerName,classification,aliyahCount,windowMonths,lastAliyahDate,lastAliyah,events}`. Unknown tribe has null count/window and can appear only in events. Events include `{kind,date,hebrewDate,description,needsReview}`; yahrzeits add `relationship,relativeName`. Zero counts and missing counts are distinct. `lastAliyah` is the latest included call’s Hebrew date plus its saved reading (`<Hebrew date> · <reading>`), or exactly `לא נמצא`. Date and reading come from the same service; for same-date calls prefer Mincha, then lowest minyan and stable service ID. The Events table’s final column remains `אירוע`; the other five tables use `עלייה אחרונה` on screen and print.

Count uncancelled named morning/Mincha calls from `months_before(selected,6)` for Kohen/Levi or `months_before(selected,12)` for Yisrael, inclusive, through the selected date **exclusive** for a morning report. A Yom Kippur Mincha report additionally includes morning calls on that date, from every minyan, while excluding all Mincha calls on that date. Last date uses the same upper cutoff but includes history outside the rolling window. Guests and selected/later service records are excluded. Separate minyanim each count their actual call rows. Sort ascending count, earliest last date (null first), surname, first name, fallback full name, permanent ID. Events group Kohen/Levi/Yisrael/unknown, then use that ranking. Reports use current known profiles/classifications and recorded calls; they do not predict future calls or reconstruct past membership states.

Events include annual saved bar-mitzvah parasha matches or an explicit ceremony date equal to the service, plus yahrzeits in `[service, service+7 days]`, both bounds included. Multiple events stay in one person's row. A saved single portion matches either component of a combined reading; a saved combination matches its combined reading or either separately read component. On the first separate Shabbat, append `ניתן להעלות גם בשבת הבאה`. On the second, omit that bar-mitzvah event if any uncancelled named aliyah was recorded for the person on the actual first Shabbat, in any minyan/prayer/position. Locate that first reading from the Israeli calendar, including pairs straddling Rosh Hashanah, rather than assuming the same Hebrew year. Other events (such as a yahrzeit) remain. An aliyah on another date does not satisfy this specific first-Shabbat condition. Normalize nikkud, separators and `כי תבא`/`כי תבוא`. No birthday/parasha is invented when missing. Yahrzeits handle Hebrew-year transitions. Ordinary descriptions are `יארצייט - <relationship> - <Hebrew day/month>` without the relative’s name, year or duplicate source date. Metadata retains the full effective `hebrewDate`, `relativeName` and original recorded month/day. Only unresolved dates append the original death date and required custom reminder. Bar-mitzvah descriptions are `בר מצווה`, plus the split-parasha reminder when applicable. Apply the community custom described above; preserve unresolved reminders and never rewrite the stored date.

The five ranked sections additionally exclude a person if either (1) their latest included aliyah falls on or after `selected date - 30 days`, or (2) they have a yahrzeit/bar-mitzvah event in `[selected date, selected date + 30 days]`, inclusive. “Coming month” is interpreted as 30 civil days anchored to the selected report, not today or a Hebrew calendar month. Morning uses the history cutoff above; Yom Kippur Mincha includes its same-date morning calls. Yahrzeit reservation uses the same selected community custom and year-boundary rules as events; bar-mitzvah reservation uses actual future reading dates and explicit ceremony dates. These exclusions apply **before sorting/capping**, across all five ranked groups. They never suppress the Events table, which keeps its original day-0-through-day-7 yahrzeit window. Future reports use only recorded history available before that selected prayer, without predicting a future first-Shabbat aliyah.

Future eligibility uses existing roster rules/permanent community-person IDs inside one `BEGIN IMMEDIATE` transaction that is **always rolled back** after materializing the report, including on errors. Reading a future report therefore never promotes a child early or changes source/roster rows, timestamps, allocation revisions, seating reports, notification queues or history. One aggregate history query supplies all statistics; PDF BLOBs are not copied.

The client shares section-specific seven-column RTL layouts between screen and print, with event details only in Events and last aliyah in the ranked sections. Kohen background `#E9F2FA`, Levi `#F4EEDC`, Yisrael `#FFFFFF`. `src/recommendations.ts` creates escaped printable HTML without external assets/scripts. Native `expo-print` requests portrait orientation with a 595 × 842-point page and explicit 15 mm native margins; web opens a separate printable window. For browser/Android printing the HTML specifies A4 portrait and 15 mm margins; iOS sets the same margins in its native renderer and uses zero CSS page margins to avoid applying them twice. The layout uses 7.5-point table text, compact spacing and repeating table headers. Fixed percentage-width columns fit within the printable width, with long values wrapping inside cells and rows kept together where possible; actual paper size is controlled by the OS/printer. No report is published to members or exposed at a public URL. Physical printer delivery remains unverified.

### Gabbai tools — October 26, 2026

A gabbai keeps the ordinary member tabs and gains `כלי הגבאי` on Home, containing the searchable congregant directory/editor, announcement/PDF publishing and aliyah recording (morning or Yom Kippur Mincha), with separate minyan selection. An unclassified gabbai initially defaults to `א`; explicit later classification changes are preserved. No seat quota is invented; the directory editor can configure it. Role creation remains a protected local CLI operation; neither registration nor profile edits can grant a gabbai role. Every new administrative endpoint checks the authenticated role independently of the UI.

GET `/api/admin/people/{id}` returns `{person,profile,kind,ownerId,account,verifiedPhone,birthDateNote}`. `verifiedPhone` is null unless the account is linked to a verified login number; it is read-only in the full editor. `person` is the roster DTO including current classifications, quota and derived aliyah statistics. `profile` follows the normal full profile schema; `kind` is `self`, `son`, `son_in_law` or `independent`. For an account holder, `account` contains only email and role for inspection; credentials are never returned. Non-account profiles have no child list or account phone fields. PUT accepts exactly `{profile,classification,allocatedSeats,barMitzvahDate}`. Personal dates/names/yahrzeits use existing validation. Derived statistics are read-only. `birthDateNote` is a read-only original-source note when an imported birthday cannot be resolved; it is not accepted in PUT. Saving a full valid Hebrew birthday clears the note; unrelated edits preserve it. Every person, including account holders and gabbaim, can receive any registered classification. Classification and administrative role are independent; only exact classification `א` grants seating eligibility.

Head edits update the owning account profile and permanent self/family rows. Son edits update the corresponding child in the father's profile; Kohen/Levi/Yisrael remains inherited, and a mismatching son status is rejected (edit the father instead). Linked-husband edits update the daughter's spouse details. Independent records update their existing roster row. The transaction validates before committing, refreshes eligibility and preserves IDs and historical aliyah name snapshots. Legacy combined names require explicit first/surname entry when using the editor; no order is guessed.

The nullable additive `classification_override` column preserves a gabbai's explicit person classification across profile refreshes. Without an override, automatic household/marriage classification continues. Choosing `דור ב-נשוי` for a son also sets marriage true in the family record. Choosing `דור ב` sets marriage false and clears spouse name/prayer details, as stated in the editor. Ordinary members still cannot submit any classification. Quota changes retain the existing monotonic allocation-revision behavior.

#### Weekly PDFs and announcements

Text announcements use POST `/api/admin/messages`. The publishing screen can choose the existing category, title/body and pinning. For PDFs, the native picker accepts one PDF and copies it to app cache; the screen shows its filename/size before the separate publish action. POST `/api/admin/weekly-documents` accepts exactly `{name,base64,title,body}`. The decoded size limit is 10 MiB (HTTP JSON ceiling 14 MiB on this route only); `.pdf` filename, no path components, strict base64, PDF header and EOF marker are checked. This is a signature check, not a full PDF parser. Empty body uses a short schedule description. Invalid input creates neither attachment nor announcement.

A successful upload atomically inserts a `weekly_documents` BLOB with member-independent ID, filename, size, uploader/time and linked weekly-category message, plus existing `weekly` outbox jobs for the other accounts. `/api/me` and message lists expose `attachment:{id,name,size,mimeType}` metadata. The PDF appears in all members' announcement feeds irrespective of notification preferences; push alerts honor their weekly preference. Push carries the existing generic notification/message ID, not the binary file or personal details. Download is on demand through GET `/api/documents/{id}` with the session Authorization header. The native viewer action opens the OS PDF/share/save sheet after authenticated cache download; web opens an authenticated blob preview. Nothing is uploaded to a cloud build service.

PDF blobs live in the same private SQLite backup as the messages. There is no public attachment URL, attachment deletion/expiry UI or automatic offline-library synchronization in this version. Files and source are separate; the database and caches stay excluded from Git. Native picker/file-system/sharing modules require a new local development-client build after pulling these dependencies. Real APNs/FCM delivery still depends on the existing push configuration.

#### Gregorian dates in the client

All date-only API values remain ISO `YYYY-MM-DD`; no data migration or reversed day/month payloads are introduced. The client displays numeric Gregorian dates as `DD-MM-YYYY` and uses a shared calendar field for aliyah dates and gabbai/family bar-mitzvah dates. Native iOS/Android calendars support month/year navigation; web uses the browser picker. Optional bar-mitzvah dates can be cleared, permit planned future Saturdays and retain existing validation/identities. Aliyah input allows only today or earlier; service-day validation still occurs on the server.

The complete-entry UI shows the prayer selector only on Yom Kippur and resets Mincha to Shacharit when the selected date changes to another day. Its `מניין` dropdown has `מניין ראשון` (1) and `מניין שני` (2). The API's existing 1–1000 range remains for compatibility; historical records above 2 keep their original minyan read-only when using the editor. The existing server-only Yom Kippur Mincha validation is unchanged.

#### Complete aliyot and multiple minyanim

GET `/api/admin/aliyah-template?date=YYYY-MM-DD&service=shacharit` defaults to morning and uses the Israeli calendar: ordinary Shabbat has seven regular aliyot plus Maftir; weekday Yom Tov has five plus Maftir; weekday Yom Kippur has six plus Maftir. On Shabbat (including Yom Kippur) there are seven plus Maftir. Only ordinary Shabbat permits extras before Maftir; **eighth and later extras allow any tribe**, including Kohen/Levi. Festivals including Shabbat Chol Hamoed prohibit extras in this workflow. Ordinary weekdays and weekday Chol Hamoed are outside complete-record morning entry. `service=mincha` is accepted only on Yom Kippur: exactly Kohen, Levi and third, no separate Maftir/extras. The returned template includes `service`. Yom Kippur readings are `יום כיפור - שחרית` and `יום כיפור - מנחה`.

POST `/api/admin/aliyah-records` and PUT `.../{id}` accept `{date,reading,calls,cancelled?,service?,minyan?}`. `service` defaults to `shacharit`. `minyan` is an integer 1–1000, default 1 on create; omitting it on correction preserves the existing minyan. Calls must fill the complete ordered template: morning `כהן`, `לוי`, `ישראל 1` through the regular count, optional further numbered slots, then `מפטיר`; Yom Kippur Mincha uses `כהן`, `לוי`, `ישראל 1` only. The maximum is 100 slots. Each slot is either `{position,personId}` with a permanent roster ID or `{position,guest:true}` with no guest name or ID. Server and picker enforce tribe for regular Kohen/Levi/Israel slots; extras and Maftir allow any tribe. Missing, reordered, wrongly typed or extra festival slots return 400. Duplicate date/prayer/minyan returns 409, while another minyan on the same date is a separate record. Corrections replace the same complete record atomically.

The nullable `aliyah_calls.person_id` represents an unnamed guest (`אורח`). Guests never create congregant identities or contribute to anyone's rolling statistics. Existing historical partial records remain readable. The legacy `/api/admin/aliyah-services` API remains available for partial historical imports and general Mincha history; complete-record UI requires completing any old partial record before resaving it there. Both legacy and complete APIs expose `minyan`; upgrade assigns existing services minyan 1 and preserves all service/person IDs, calls, FK links and historical name snapshots in an atomic migration. The key is now unique `(service_date,service,minyan)`.

### Shared custom classifications — October 26, 2026

The `classifications` table persists dropdown names/order, creator and creation time. Startup seeds `א`, `דור ב`, `חתן`, `דור ב-נשוי`, `קבוע` and retains existing roster/override labels without replacing people. GET `/api/admin/classifications` returns `{value,label}` options; `/api/me.classifications` supplies the same list only to gabbaim. POST accepts exactly `{name}`, trims/collapses whitespace, permits 1–60 characters and rejects controls. Duplicate names (including case-only English variants and quoted aliases of built-ins) return 409; malformed input returns 400; ordinary members receive 403. This version adds names without rename/delete operations.

The full person editor uses the shared selector with every option and `+ הוספת סיווג חדש`. Adding a name immediately selects it for the current draft and updates the shared available list; saving the person's details/classification commits the assignment. Both roster PUT and full-person PUT require a registered name and allow every registered option for any person. Ordinary profile/registration writes still cannot classify anyone. Custom labels do not confer gabbai role, seating rights or inferred association privileges. Automatic family defaults use association-derived categories only for `א`, `קבוע` for other known household categories, and preserve explicit child overrides.

The aliyah reading dropdown now offers `א׳ ראש השנה` and `ב׳ ראש השנה`. The calendar template chooses the corresponding exact label on Tishrei 1/2, preserving the existing Shabbat/festival slot counts. Existing stored reading labels are never rewritten; an older generic `ראש השנה` record remains editable as historical data.

The visible Israel aliyah labels are now `שלישי`, `רביעי`, `חמישי`, `שישי`, `שביעי`, with extras `שמיני`, `תשיעי`, `עשירי` and further Hebrew numbers. Kohen/Levi/Maftir keep their labels. Form errors and saved-record displays use these same names. Internal `ישראל 1` etc. position keys remain stable in API payloads/SQLite, so guest markers, person links, historical records and statistics require no migration.

### Phone verification and association list

The app uses a phone → SMS code → session flow. Israeli mobile formats `05…`, `+9725…`, and `009725…` normalize to one E.164 identity. POST `/api/auth/phone/request` accepts exactly `{phone}`. The response is the same for listed/unlisted numbers and contains no code, membership status or profile. SMS transport is configurable through `server/sms.py`; the supplied adapter uses [Twilio Messages](https://www.twilio.com/docs/messaging/api/message-resource). It is disabled until `SHUL_SMS_BACKEND=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` and a persistent `SHUL_OTP_SECRET` of at least 32 characters are configured. See `server/.env.example`. Provider failures/missing configuration return 503 without provider details. An accepted SMS request is not proof of handset delivery.

Codes have six cryptographically random digits, five-minute expiry, a 60-second resend cooldown and at most five wrong submissions. Only a keyed HMAC bound to challenge/phone/code is stored; raw codes are never returned/logged. A resend invalidates the preceding challenge. Limits survive restart: 5 requests/phone/hour, 20/IP/hour, 200 total/day; 20 verification submissions/phone/15 minutes and 60/IP/15 minutes. The source IP is the socket peer, not a client-supplied forwarded header. The daily ceiling is a pilot safeguard; review these values in `phone_auth.py` for deployment scale/proxy configuration. A new 256-bit challenge ID prevents guessing another user's challenge. Verification, single-use consumption, account creation/link lookup and session issue share one immediate transaction; replay/concurrent reuse cannot create a second account. Invalid/expired/used codes return 401; exhausted limits return 429.

Successful verification looks up `verified_phones`, never the editable contact-phone field. A new account gets role `member`, the same permanent self/roster ID, and a stored login phone. Numbers in `association_members` get classification `א`; other new numbers get `קבוע`. Imported split names prefill the profile; unsplit full names are preserved until the user supplies their own separate name parts. Missing tribe opens the normal details form. The server never invents an allocation; `א` has seating access but needs a gabbai-configured quota. `/api/me.verifiedPhone` is the canonical verified phone. Profile and full-person PUT cannot replace it with another number. Session `user` adds `phone`; internal phone-account email placeholders are omitted from the UI/session email value. Role remains independent of membership.

An explicit gabbai classification save sets `classification_override` for account holders as well as family rows. It wins over future imports and sign-ins, including an `א` → `קבוע` demotion while the number remains in the original list. Existing classifications are marked explicit during the initial upgrade. Automatic regular accounts may be promoted when their verified number is later imported. The roster editor remains the place for gabbai status changes; members cannot request/assign a category. No new review requests or classification push alerts are created. The old queue's pending rows are retired at startup, GET `/api/admin/membership-requests` returns 404, and `/api/me` no longer includes `membershipRequests`.

POST `/api/admin/association-members/import` accepts exactly `{name,base64}` for a `.xlsx` file (5 MiB decoded; route JSON limit 7 MiB). The first sheet must have `שם פרטי`, `שם משפחה`, `פלאפון`, or `שם מלא` + `פלאפון`; English `firstName,lastName,phone` / `name,phone` are supported. The included `association-members-template.xlsx` has separate name columns and a text-formatted phone column. Numeric Excel phones that lost the initial zero are normalized. All rows are validated before any write. Duplicate normalized phones within one file, formulas, invalid numbers/names/headers, malformed archives, over 10,000 rows, archive expansion over 20 MiB or over 200 archive entries are rejected atomically. `openpyxl` reads in read-only mode with `defusedxml` enabled and external links disabled. Original workbook bytes are not retained.

Import adds or updates stored list entries and reports `{added,updated,total}`; it never deletes absent members or rewrites existing profile names, identities, history or manual classifications. GET returns `{phone,name,firstName,lastName,registered}` rows only to gabbaim. Each entry retains the importer and server timestamp. The Gabbai tools screen replaces the former review entry with `רשימת חברי העמותה — טעינת אקסל`, file selection, a separate upload action and a searchable list. The CLI also supports `import-members --author-email ... --file ...` and `membership-template --file ...`.

Before switching an existing account to phone sign-in, a trusted server operator must run `python -m server.manage link-phone --email ... --phone ...`. This preserves its user/person IDs, family, role, sessions and aliyah history. Link the gabbai account this way after local CLI provisioning. Old contact phone fields are not proof of possession and are never matched automatically; otherwise they could enable account takeover. Existing phone/account conflicts return 409 rather than merging identities. Unlinked legacy email/password sessions remain supported for migration, but the app exposes only phone sign-in and linked accounts cannot use password login. Phone reassignment, automated account merging and self-service number changes are not part of this version.

### Mi Sheberach for the sick

The member app has a dedicated `מי שברך` tab. It shows only the signed-in member's own remaining entries, lets them add a name in the `השם ושם האם` format, and asks for confirmation before deleting an entry. Each entry displays its Gregorian addition/last-confirmation date as `DD-MM-YYYY`. No Hebrew date, illness details or date input is collected. Names follow the renewal/expiry policy below; cancelling a manual deletion leaves the entry intact.

The `healing_prayers` table stores a technical primary key `id`, submitter identity, requested `name`, and Gregorian `added_on` (`YYYY-MM-DD`). Ordinary app submissions use `member_id`, a stable foreign key to the adding account. The server derives identity from the authenticated session and dates from the current Israeli civil date. Requests cannot supply the adding member or date. Reads resolve the member's current display name, so a profile rename does not break ownership or reset the record date. The atomic schema upgrade preserves existing request/person IDs, dates and list ordering. Choosing to keep a name deliberately updates `added_on` to the confirmation date.

Local administrative imports also support existing roster people who have no login account. Such a row uses `roster_person_id` instead of `member_id`; the combined admin DTO has `memberId:null`, `rosterPersonId` and the roster's current name in `memberName`. Only an explicitly authorized unmatched import can use `submitter_name` instead, returning `memberId:null`, `unmatchedSubmitter:true` and that supplied name. A CHECK constraint requires exactly one of the three identity sources. These imports do not create accounts, roster people, sessions or notifications. Roster-linked/name-only rows are visible in the gabbai combined list and printout, without granting an unrelated account ownership. Future account/roster linking requires a trusted explicit migration, not a name or editable-phone match. Imports against a roster self-person already linked to an account retain that account's ordinary ownership.

`tools/import_healing_prayers.py --database <existing-db> --input <private-json>` previews an import using a disposable database copy. The JSON list requires `rosterPersonId`, the exact confirmed `submitter` name, requested `name` and ISO `addedOn`. A missing roster person requires both `rosterPersonId:null` and explicit `unmatchedSubmitter:true`. `--apply` first creates a private SQLite backup, then validates the entire batch and inserts atomically. Repeating an identical row does not duplicate it; a conflicting date or mismatched name/ID aborts the batch. Keep input, backup and receipts in an ignored private directory. Normal HTTP POST/DELETE contracts and authorization remain unchanged.

```json
{ "name": "משה בן שרה" }
```

A successful POST returns 201 and an entry such as:

```json
{
  "id": "prayer-generated-id", "memberId": "adding-member-id",
  "memberName": "ישראל ישראלי", "name": "משה בן שרה", "addedOn": "2026-10-25",
  "reminder": {
    "cycleId": "opaque-current-cycle", "startedOn": "2026-10-25",
    "dueOn": "2026-11-08", "expiresOn": "2026-11-25",
    "confirmedOn": null, "pending": false, "createdOn": null, "read": false
  }
}
```

Names are trimmed and must have 1–200 characters. An identical name already present for that same member returns 409; another member may request the same prayer name independently. Deleting and later adding the name creates a new entry/date. Unknown fields are rejected. GET and `/api/me.healingPrayers` are scoped to the caller, including for gabbai accounts. The separate admin GET requires gabbai authorization and supplies the combined list for prayer use; it does not grant deletion of another member's entries. The gabbai app now exposes this endpoint through **כלי הגבאי → מי שברך לחולים — רשימה והדפסה**, showing all names, submitter and addition date. It reloads on opening/app foreground and supports manual/pull refresh. Printing always fetches a fresh admin snapshot first, then prints names only in A4 portrait with 15 mm margins; if the refreshed list is empty or cannot be fetched, no stale printout is opened. The browser print window is created synchronously before the refresh to preserve the user’s popup gesture. Different members’ equal names remain distinct requests. The screen provides no cross-owner deletion.

DELETE removes the physical row by both entry ID and authenticated owner ID, cascading its renewal state and queued reminders. Missing or other-owned IDs return the same 404, without changing another member's data. No archival copy is retained in this table. Success returns 200 with `{ "ok": true }`, without requiring a request body. CORS preflight permits DELETE for the existing allowed origins. These endpoints do not publish names to other ordinary members.

#### Healing-prayer renewal reminders

An account-owned name becomes due for confirmation 14 Israeli calendar days after `added_on`. The owner sees the question in Messages, with **להשאיר ברשימה** / **להסיר מהרשימה** controls in the message detail and Mi Sheberach tab. An app-wide reminder banner opens Messages. The card shows the exact deletion deadline. Choosing remove uses the existing confirmed DELETE. Choosing keep sends POST `/api/healing-prayers/:id/keep` with exactly `{ "cycleId": "current-cycle" }`, returning the updated entry. The server updates `added_on` to today's Israeli date and starts a new two-week reminder / one-calendar-month expiry cycle. Each subsequent keep repeats that behavior. The immutable request/owner IDs and prayer name remain intact; the record date is intentionally renewed. The gabbai screen displays `אישור אחרון` for renewed entries.

A name with no answer is physically deleted at one calendar month after its current record date, including if the phone is offline or the app is closed. Month-end dates clamp to the next month's final day (31 January → 28/29 February). The deadline is not extended by opening/refreshing the list, failed push delivery, or a server outage. An expired keep returns 404 and cannot restore the name. Missing/foreign-owned IDs also return 404; stale/already-used cycles or an early keep return 409; malformed bodies return 400. Request bodies cannot choose a new date or another owner. A later re-add is a new entry/cycle.

`healing_cycles` stores current-cycle dates, a nonce and a nullable owner read date; `healing_reminder_outbox` queues at most one reminder per prayer/cycle. The API starts a durable cleanup/reminder worker every 30 seconds, independent of `SHUL_ENABLE_PUSH`, and authenticated list reads also reconcile due/expired rows. Creation of a reminder and its outbox job is transactional; keep/delete cancels the old queued job. Workers follow the existing single-process deployment model. Existing account-owned rows initialize from their current record dates, so an already expired owned row is eligible for removal when the feature starts. Unlinked roster/name-only imports have `reminder:null`: they stay on hold, with no reminder or automatic deletion, until a trusted account-linking step establishes an owner. Never infer that link from editable names/phone fields.

With `SHUL_ENABLE_PUSH=1` and a registered physical device, the personal reminder also goes through the existing Expo push delivery service. Tapping it opens the Messages list. Its generic text asks whether to keep/remove a name; the prayer name and member details are fetched only inside the authenticated app. Notification data contains `screen:"messages"` and an opaque `messageId` identifying the current private reminder. These personal reminders are independent of the community-event notification preference; OS permission/device registration is still required. Missing tokens retry hourly until the deadline; delivery errors use the existing bounded retry pattern and invalid device tokens are removed. In-app reminders and expiry do not depend on push delivery success. Push acceptance is not proof of delivery. The local preview keeps external push disabled.

The app's shared state refreshes this own list with the regular `/api/me` refresh and on pull-to-refresh. Add/keep/delete updates are committed only after server success; stale/expired keep responses refresh the list. Demo mode applies the same calendar-day renewal/expiry rules on local refresh, persists under the existing demo storage key and never sends real notifications or uploads demo names. Older saved demo state gains an empty `healingPrayers` array without losing profile, family, preferences or read status. Profile updates and older clients do not replace or erase this separate server table.

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

The current member form requires both name parts; other text fields are optional, up to 200 characters. At most 30 yahrzeits per member. Relationships: `father`, `mother`, `son`, `daughter`, `brother`, `sister`, `father_in_law` (חותן), `mother_in_law` (חותנת), `uncle` (דוד), `aunt` (דודה), `unknown` (לא ידוע). Imported unknown relationships remain explicit rather than inferred from personal names. Hebrew months: `tishrei`, `cheshvan`, `kislev`, `tevet`, `shevat`, `adar`, `adar_i`, `adar_ii`, `nisan`, `iyar`, `sivan`, `tamuz`, `av`, `elul`. Yahrzeit days are validated against the maximum possible length of a month, not resolved into yearly anniversaries. The member form collects only a Hebrew month and a Hebrew-numeral day dropdown (א׳–ל׳), with no year input. Months that are always short omit day 30; switching to such a month clears an invalid day. Cheshvan/Kislev allow 30 because no death year is collected. New entries send `year: ""` for API compatibility; existing optional death years remain preserved in storage. No halachic recurrence decision is made.

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

Built-in labels are `א`, `דור ב`, `חתן`, `דור ב-נשוי`, `קבוע`; gabbaim may add custom labels. Household classifications are gabbai-controlled and chosen from the shared built-in/custom registry. A linked son's default classification follows the father/marriage; a gabbai override is stored explicitly and survives refresh. An unclassified father leaves the son unclassified. Sons inherit their father's Kohen/Levi/Yisrael status. Son-in-law status is independent.

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

`PUT` accepts a partial update with the same fields. For source-linked people, first/surname can be edited here; household heads also allow classification and seat allocation, and sons allow their own yahrzeit lists. Child/linked-husband classifications follow the household unless the gabbai sets an explicit override. Other family data is edited through the original profile. A self/account holder's yahrzeit list stays authoritative in that profile. Unknown fields, invalid classifications and unauthorized writes are rejected.

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

Demo mode uses four fictional allocated seats and local persistence only. Real quotas are never guessed. The gabbai configuration/summary APIs are implemented; event-selection and summary management screens remain future work; quota editing is now part of the directory editor.

### Aliyah services, calls and rolling statistics

`aliyah_services` records the Israeli civil date, `shacharit` or `mincha`, the minyan number (default 1), Torah reading/parasha label, cancellation flag and recording gabbai. `aliyah_calls` links each service position to a permanent roster person ID and keeps the name at recording. Dates must be past/today and a Shabbat or festival in Israel. Ordinary weekdays and calls before a known eligibility date are rejected. Historical records may reference an archived person. Records are retained beyond the counting window so the last aliyah is still available.

```json
{
  "date": "2026-10-24", "service": "shacharit", "minyan": 1, "reading": "פרשת לך לך",
  "calls": [
    { "position": "ראשון", "personId": "permanent-person-id" },
    { "position": "מפטיר", "personId": "another-person-id" }
  ]
}
```

There is one record per date/service/minyan and one caller per position. `minyan` accepts integers 1–1000; it defaults to 1 on creation and remains unchanged when omitted from an update. Duplicate creations return 409; duplicate positions or unknown people return 400. A successful `PUT` replaces that service's complete call list atomically and does not add another copy. Add `cancelled: true` to exclude a mistaken service from statistics while retaining its record. Invalid replacements leave the original intact. The same person can have separately recorded calls; statistics count actual call rows, not unique service dates.

`GET /api/admin/roster` exposes `windowMonths` (6 for Kohanim/Leviim, 12 for Yisraelim), `aliyahCount`, `lastAliyahDate` and `lastAliyah`. The window uses rolling Gregorian calendar months, clamped at shorter month ends, with an inclusive lower cutoff and today as the upper cutoff. It never resets on January 1 or Rosh Hashanah. Cancelled services and future dates are excluded. Unknown status yields a null window/count rather than assuming a tribe.

The latest aliyah is selected from all available history, independently of the counting window, and rendered as Hebrew date plus the stored reading. With no recorded aliyah, `lastAliyahDate` is null and `lastAliyah` is exactly `לא נמצא`; a known status then has count 0. All roster/history endpoints require gabbai authentication and remain private to ordinary members. The gabbai entry screen supports morning services and Yom Kippur Mincha, including minyan selection. Other Mincha entry UI remains outside the current complete-record workflow.

Preferences:

```json
{ "weekly": true, "community": true, "replies": true, "events": true }
```

Announcement input:

```json
{ "category": "celebration", "title": "מזל טוב", "body": "תוכן ההודעה", "pinned": false }
```

Categories: `weekly`, `celebration`, `condolence`, `event`. Title max 200 characters; announcement body max 10,000; reply max 1,000. Extra input fields are rejected for profiles, preferences, announcements and replies. A member cannot choose an author, edit another member's profile or change a role. Replies notify prior participants and the announcement author when `replies` is enabled; announcement preferences are independent.

Verified phone sign-in creates only member-role accounts and assigns association/regular status from the server list, subject to explicit gabbai overrides; there are no administrator default credentials. Gabbai creation, optional member provisioning and password reset use local CLI commands. Passwords use PBKDF2-HMAC-SHA256 with 600,000 iterations and per-account salts; session tokens are random and stored hashed in SQLite, expire after 30 days, and are revoked on password reset. Native clients keep the session in SecureStore; the optional browser client uses tab-scoped sessionStorage. Login limits are persisted for both IP and account. The HTTP handler ignores forwarded IP headers. Apply additional request limits at the deployment proxy before production use.

The stdlib HTTP server is a development/pilot entry point. Keep it behind HTTPS for remote use. One server process owns the optional push worker. SQLite and WAL files contain member data; keep the database directory private and back it up consistently. API and push tests use temporary databases and mocked Expo transport; they do not prove delivery through APNs/FCM.
