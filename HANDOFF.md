# מעבר למחשב אחר — הקהילה שלי

נקודת המשך מעודכנת במחשב הביתי: 25 באוקטובר 2026. המסמך עומד בפני עצמו; אין צורך בהיסטוריית הצ׳אט או בפרויקט Hoshanot כדי להמשיך.

## Families and privacy pack delivered — October 27, 2026

**What was built** (spec `docs/superpowers/specs/2026-10-27-families-privacy-design.md`, plan `docs/superpowers/plans/2026-10-27-families-privacy.md`, screens P1–P14 in `design/mockups/frames/` and `docs/UX-DESIGN.md` §10, API in `server/API.md`):
- **Families:** every member or gabbai household is a family. Partners link by request and confirm (7-day expiry, 30-day cooldown after a decline) or by a gabbai, who notifies both and lets either undo. Either adult can unlink, and each keeps a copy of the children. Children are entered once per family.
- **Private blessings** reach every current adult of the target family; gabbaim still have no access.
- **Phone list:** names and phones only. Each person opts in per Kehila and a consent record is kept. Members and gabbaim of that Kehila only; the list is never stored on the phone.
- **Privacy pack:**
  - consent records;
  - "I am 13 or older" at setup, plus a one-time gate for existing accounts;
  - Kehila terms that a gabbai accepts, which block only the management screens;
  - a Kehila privacy contact;
  - "delete everything I posted" (unticked by default);
  - removal of imported people who never signed in;
  - "download my data" (a ZIP, with a 10-minute link and the file deleted after a day);
  - "leave Kehila" for listeners;
  - rewritten `/privacy/`, a new `/terms/`, and `docs/BREACH-PROCEDURE.md`.

**Deployed on dev:**
- The Terraform apply made 8 in-place changes: the media `x/` lifecycle rule, the API role `x/*` grant, the CloudFront `/terms` rewrite and Lambda code.
- A second apply, approved by the user, added `dynamodb:BatchGetItem` to the push-worker role.
- `backfill-families` ran; dev has no memberships, so it created 0.
- The web app was deployed. The platform contact comes from the git-ignored `infra/envs/dev/site.env` (`PLATFORM_CONTACT=`). `tools/fill_contact.py` fills it at deploy time and the deploy refuses to run without it.
- Smoke: 237 PASS twice in a row, nothing left behind.

**Tests at this point:** Python 660 OK, `npm test` 392 pass, `npm run typecheck` clean. The ledger with every ruling and deferred minor is `.superpowers/sdd/2026-10-27-families-privacy/progress.md`.

**Still open for the user:**
- A lawyer should review `/privacy/` and `/terms/` (age 13 vs EU 13–16, backups wording).
- A native Hebrew editor should review the new copy.
- On phones: call and WhatsApp buttons, family pushes, export download on iOS and Android.
- Follow-ups:
  - there is no delete-Kehila tool yet (the terms promise deletion on request);
  - Task 24, an Android test APK from GitHub Actions;
  - Task 25, the Neria Kehila on dev with the user as gabbai.

## Cloud app (plan 3) delivered — October 27, 2026

**What was built.** A multi-community cloud backend and a new app on top of it (specs and plans in `docs/superpowers/`, ledger in `.superpowers/sdd/2026-10-27-app/progress.md`, API in `server/API.md`): Cognito sign-in with a pre-sign-up/post-confirmation trigger, tenants (Kehilot) with roles listener, member and gabbai, invite links with roles and caps, membership requests and approvals, member list import (CSV/XLSX, in batches), channels, messages and private blessing replies, push through SQS and Expo, groups with group admins and join requests, conversation channels with an hourly chat limit, image attachments through a private S3 bucket (presigned URLs, client-side resize, in-app viewer with save/share/print), offline search, account deletion, per-community custom push texts, and a web build with a privacy page. The app is Hebrew/English, RTL/LTR, with a dark mode.

**Deployed on dev (il-central-1).** All Terraform plans were applied on dev (the user's night allow rule): CORS, Cognito domain, trigger Lambda, import grants, the private media bucket `kehilot-dev-media`, groups/chat/images code, the web security headers plus the privacy page function, and the push-texts code. The web build is on the dev CloudFront (`tools/deploy_web.sh --env dev`; the script now refuses a bundle without the API URL). The live smoke (`tools/smoke_dev.py`) passes twice in a row and leaves nothing behind; it now also covers CORS preflight, member invite roles, group admin and join requests, the chat limit, push texts, the served web app and an idempotent import. The icon is the Chazit concept (Task 22). Parked reviewer minors are in the per-task review files.

**Blocked.** Tasks 19-20 (Google and Apple sign-in): they need the user's credentials in SSM first. Until then the sign-in screen offers email and password only (`EXPO_PUBLIC_FEDERATION` empty).

**Still open for the user.**
- U2: create the Google OAuth client and the Apple Services ID and key, store them in SSM (Task 19, Step 0; Apple needs a paid developer membership).
- U4: review the privacy page text (draft, `public/privacy/index.html`) and give a contact address.
- U5: on the Mac, copy `.env.dev`, rebuild the dev client (new native modules, see README "Cloud app"), then check on iPhone and Android: full keyboard with emoji and mixed Hebrew/English in the composer, Google/Apple sheets, push arrival and tap, gallery and camera photos (permission texts, size at most 0.5 MB, no location), viewer pinch/double-tap/swipe/save/share/print, opt-in chat push, offline search and sign-out isolation.
- U6: the end-to-end browser checks on the Mac through the port forward (Tasks 8, 11, 17 and 20).

Done already: U1 (all applies, by the controller), U3 (icon, Chazit).

**Tests at this point.** Python suite, `npm test` and `npm run typecheck` pass (counts in `.superpowers/sdd/2026-10-27-app/task-23-report.md`).

## Shared GitHub repository — October 25, 2026

The canonical shared repository is https://github.com/AGilai/kehilot (public), branch `main`. The authenticated GitHub account `lebovitz` has collaborator write access. This checkout uses `origin` for the shared repository and keeps the earlier private `https://github.com/lebovitz/kehilot.git` repository as remote `personal`. `main` tracks `origin/main`; ordinary `git push` publishes to the shared project.

The source, tests, lockfile and documentation are versioned. Local credentials/environment files, community databases, dependencies, native build directories and generated artifacts remain ignored. The original `TRANSFER-MANIFEST.json` describes the historical transfer package, not the current Git checkout. Clones still require machine-local setup and local compilation as described below.

## Latest UI adjustments — October 25, 2026

The shared `PARASHA_OPTIONS` now places each combined reading immediately after its second individual parasha (for example, `אחרי מות`, `קדושים`, `אחרי מות־קדושים`; `מטות`, `מסעי`, `מטות־מסעי`). This applies to both the member and sons' bar-mitzvah selectors. All existing option values remain intact.

The seating screen no longer shows the general `כמה מקומות לא צריך השבת?` / holiday question. Only the Arvit and Shacharit questions remain, with the existing bold/red `לא`, dropdown limits and reporting semantics.

## Previous change — gabbai classification and Arvit/Shacharit seating

Noam's latest requirements supersede the earlier seating section below. A `קבוע` worshipper can never report seats. Users cannot choose their classification. Self-registration now creates an unclassified member; after saving personal details, a durable private request alerts the gabbaim. The gabbai's Home card `מתפללים חדשים לסיווג` opens `src/screens/Membership.tsx`, with exactly `א` and `קבוע`. Only active `א` household heads see/can use the seating option. Unknown quota still requires gabbai configuration; no real allocation is guessed. The separate Kohen/Levi/Yisrael profile field remains user-entered and is unrelated to membership classification.

`server/membership.py` adds POST `/api/register` (separate names/email/password, member role only, persisted rate limit), gabbai-only GET `/api/admin/membership-requests`, `membership_requests` and `membership_outbox`. The first completed personal-profile save creates one request and queues generic gabbai push alerts. Repeated saves do not duplicate alerts. `/api/me` returns authenticated role, own classification and a private pending-request list only for gabbaim. Classification uses the protected roster PUT and rejects other classifications for account holders. Notification taps route to the review screen. Actual phone delivery still needs the existing optional push worker/device credentials and has not been verified; tests mock the transport.

Family classifications are now stored automatically in `roster_people`: eligible sons get `דור ב` or `דור ב-נשוי` based on marriage, and married daughters' husbands get `חתן` for association households. Existing linked husband rows are reused; new husbands get their own permanent roster ID linked to the daughter's unchanged community ID. Underage sons retain their existing community identity until roster eligibility. Known regular-attendee households propagate `קבוע`. Profile/marriage/classification changes resync derived fields; archival and history retain IDs. Children/linked husbands cannot independently be changed into household heads through roster classification writes. Wider account linking and full gabbai management remain future work.

Seating has **two numbers**, `arvit` and `shacharit`, required and saved atomically. The two larger prayer-specific dropdown questions keep `לא` bold/red. The general question was subsequently removed, as described above. Ordinary values are unused seats, with all seats retained per prayer without a report. Special values are needed seats, with no seats retained without an active report. Each dropdown remains 0 through allocation. API `value`, `neededSeats`, `releasedSeats` and summary totals are now per-prayer objects; old single-value writes are rejected.

**Seating history is no longer retained.** The selected event and reports stay available throughout its civil date even after reporting closes. After it passes (Shabbat: Sunday 00:00 Israel), the 60-second worker/startup/seating access deletes past reports and event rows. Selecting another current event immediately clears prior reports. Future queued configuration can remain, but only the current event retains household reports. Aliyah history and permanent people are untouched. Upgrade removes ambiguous legacy single-number reports, including demo copies, rather than assuming both prayers have the same count. Users must report both numbers anew. `server/API.md` has the exact new contract and cutoff convention.

50 app tests, 81 server tests, TypeScript and all-platform Metro exports pass. Tests include self-registration, role/classification forgery, regular-attendee blocking, one durable private review alert, automatic family classifications/IDs, generic push routing, independent prayer counts, atomic rejection of incomplete reports, migration and cleanup through/after Saturday. Android against a disposable local API verified independent Arvit/Shacharit values and restart persistence, plus hiding seating for a `קבוע` account. The Android registration/profile-save/gabbai-approval flow also passed: the unclassified member had no seating option, the gabbai chose `א`, the request disappeared, and the approved member then saw the quota-pending seating screen. Screenshots: `.expo/seating-dual-services.png`, `.expo/regular-no-seating.png` and `.expo/gabbai-membership-review.png`. The special-service screen also required both choices and saved explicit Arvit zero alongside Shacharit two; screenshot: `.expo/seating-dual-special.png`. Temporary accounts were signed out and the disposable API/Metro stopped; the normal local Metro on port 8081 was restarted with the final code. All UI accounts/databases are fictional and separate from real community data. Native compilation remains local; existing development clients run the updated code through Metro.

## Previous change — household seating reports

Noam clarified that only household heads classified `א` report for their **entire family**. A Home card `עדכון מקומות לשבת` opens `src/screens/Seating.tsx`; the existing five tabs remain. The screen shows the event/parasha/date and men's-section allocation, with a dropdown from zero to that allocation. Ordinary events report unused seats with bold/red `לא`, and absence of a report retains all seats. Special events report seats actually needed, require active selection including zero, and absence of a report retains none. Members do not choose the event mode. A saved zero remains distinguishable from no report.

`server/seating.py` adds `allocated_seats` and monotonic `seat_allocation_revision` to the roster plus `seating_events` and `seating_reports`. Existing IDs/history remain intact. Allocation is gabbai-controlled through roster APIs, restricted to `א`, and nullable: unknown is not zero. Household identity comes from the session. Own GET/PUT `/api/seating` and `/api/me.seating` expose current status. Admin event create/update/list and per-event summary endpoints configure mode, current selection, cutoff and closure. Exact contracts are in `server/API.md`. The gabbai management UI remains future work.

Reports are scoped to event, event revision and allocation revision/snapshot. Invalid/stale writes return 409 and the client refreshes. Mode/title/occasion or quota changes invalidate old reports even after changing back; the correct no-report default applies until the household reports again. Saves replace the same household/event row only after successful server validation. Reports persist independently of profile writes. Summary totals use current active households/allocations, not frozen historical quotas. Unknown quotas are separately counted.

Without a selected manual event, the server provides the next future Saturday with an offline Israeli parasha from pyluach. Shabbat Zachor and High Holidays falling on Shabbat use active `needed` mode. Automatic reports close by default at Saturday 00:00 Israel; the gabbai may override the cutoff. Weekday holidays and evening Megillah must be scheduled/selected by the gabbai; queued manual events do not automatically activate. Demo mode uses four fictional seats, local storage and the same mode semantics, with event rollover on refresh/resume.

49 app tests, 70 server tests, TypeScript and Metro exports for iOS/Android/web pass. Tests cover opposite defaults, explicit zero, strict bounds, ownership/roles, allocation/event revisions, deadlines, special dates, migration and persistence. Android UI checks verified the 0–4 dropdown, ordinary reporting of one unused seat retaining three, special reporting of zero/one needed seats, and restart persistence. Screenshots: `.expo/seating-ordinary.png` and `.expo/seating-special.png`. The special-mode UI fixture was fully removed; a final Android check confirmed ordinary mode with no report and all four example seats retained. Temporary demo reports were cleared, other demo data was preserved, and no real community records were changed. Existing local development clients use these TypeScript changes through Metro; no new native build or cloud compilation was needed.

## Previous change — Mi Sheberach for the sick

A fifth `מי שברך` tab opens `src/screens/HealingPrayers.tsx`. Each member can add a prayer name using the mother-name placeholder `השם ושם האם`, see their own remaining names and Gregorian addition dates, and delete an owned name with confirmation. The wife prayer placeholders remain father-name fields as previously requested; this new screen is specifically for healing prayers.

The new `healing_prayers` SQLite table has an entry ID, adding member FK, prayer name and Gregorian `added_on`. Server-assigned identity/date prevent client forgery. Own GET/POST/DELETE endpoints and `/api/me.healingPrayers` are member-scoped; a gabbai-only GET exposes the combined list with member names. Even a gabbai cannot delete another member's entry via the owner endpoint. Deletion physically removes the row. An identical name is unique per member, while different members may add the same prayer name. Names are 1–200 trimmed characters. See `server/API.md` for exact requests, response fields and error semantics.

The list is part of shared member state, with standard background/pull refresh and commit-after-success mutations. Demo state persists locally; older snapshots gain an empty list without losing profile/family/read data. No demo names are uploaded. All changes preserve existing permanent community people IDs, and no prayer entries are embedded in or replaced by profile writes.

43 app tests, 57 server tests, TypeScript and Metro export for iOS/Android/web pass. Server tests verify ownership isolation, gabbai read permissions, forged metadata rejection, physical deletion, persistence, duplicate handling and additive upgrades. Android UI checks verified addition, Gregorian date display, persistence across restart, cancelling deletion and confirmed deletion across restart. Screenshot: `.expo/healing-prayers-screen.png`; the unique temporary demo entry was deleted and its removal verified. No real community records were created. Native compilation remains local; these TypeScript changes use the existing development clients and local Metro.

## Latest change — separate member first name and surname

The member form now has required `firstName` and `lastName` inputs, followed by the tribe dropdown. Multiword given names and surnames are kept intact; only outer whitespace is trimmed. `name` is now a derived display name, and the home greeting uses the entered first name. Client validation requires both fields and limits their combined name to 200 characters. New demo names are explicitly structured; existing data is never split by guessing.

The server stores the two new fields in profile JSON and syncs them to the existing `roster_people.first_name`/`last_name` columns. The community self row keeps the derived display name. Gabbai edits to source-linked self names update that same account profile, avoiding refresh reversions. No schema recreation, ID change or historical name-snapshot rewrite occurs.

Legacy full names remain intact and are shown as a reference while the user supplies both fields. If explicitly entered separate names already exist in the roster, they can populate an older profile. New requests must supply both fields together; legacy clients omitting both preserve known parts and cannot reorder their derived full name. Unknown legacy names remain supported by old clients, without guessed splitting. The account-creation CLI still uses a legacy full name; the user completes the separate parts in the app. Child/spouse name fields are unchanged by this member-profile correction.

39 app tests, 51 server tests, TypeScript and Metro export for iOS/Android/web pass. Android UI checks verified two separate required inputs, independent multipart values and the tribe dropdown following the name fields. Screenshot: `.expo/member-name-fields.png`; all temporary test names were discarded without saving. Tests cover multipart names, legacy names, required fields, roster/profile synchronization, old-client updates and unchanged person IDs/history. See `server/API.md` for the contract. Earlier sections document prior stages.

## Latest change — yahrzeit month/day dropdowns

The member yahrzeit form no longer asks for a death year. Day selection is a dropdown with Hebrew numerals א׳–ל׳, using the selected month's maximum length. Changing from day 30 to a permanently short month clears the day so the user must select again. All three Adar choices remain available; Cheshvan/Kislev allow 30 because this form has no year. The API's legacy `year` string remains for compatibility: new entries use an empty string, and existing saved years are preserved without being shown or edited. Hebrew birthday year selection is a separate field and still required for populated birthdays.

TypeScript, all 36 app tests and iOS/Android/web Metro exports pass. Android UI checks verified all 30 Hebrew day labels, clearing day 30 when switching to Adar II, a 29-day limit there and the absence of the death-year input. Screenshot: `.expo/yahrzeit-dropdown-screen.png`. No temporary yahrzeit was saved.

## Latest change — full Hebrew birthdays, roster and aliyah ledger

The birth form now uses year/month/day dropdowns. Years run from 5700 (ת״ש) through the current Hebrew year, advancing dynamically. `@hebcal/hdate` computes the actual months and lengths; a common year has ordinary Adar, a leap year has Adar I/II, and Cheshvan/Kislev use their selected year's real lengths. Year/month changes clear incompatible selections; future dates are rejected. Full values are `{day, month, year}`. Old yearless Hebrew and Gregorian values are preserved without guessing a birth year. A populated Hebrew date in the current form requires a year. Old clients cannot erase a known year by returning the unchanged day/month.

**Python setup changed:** the server now uses `pyluach==2.3.0` in a project-local `.venv`. Run `python3 -m venv .venv` then `.venv/bin/python -m pip install -r server/requirements.txt`. Use `.venv/bin/python -m server.app` and `.venv/bin/python -m server.manage ...`, or activate the virtual environment. `npm run test:server` uses this environment. Calendar calculations need no runtime network. JavaScript dependencies include `@hebcal/hdate`; use `npm ci` after transfer. Both virtual environments and npm packages are machine-local.

`server/roster.py` adds `roster_people`, `aliyah_services` and `aliyah_calls`. Existing account/son IDs are reused exactly as roster IDs; no community person is replaced. Sons with a complete birth date enter the roster on their thirteenth Hebrew birthday. Refresh happens on startup, profile saves, roster activity and in a server worker every 60 seconds. Underage/missing-year sons remain out of the active roster; archival/corrections retain IDs and history. Dates follow the Israeli civil day (the exact sunset-time boundary is not implemented). Standard library birthday conventions handle Adar transitions and missing day 30; the ceremony date is not an age input.

The main roster stores separate first/surnames, Torah/wife prayer names, birth and bar-mitzvah details, yahrzeits and the specified classifications. Existing combined names are preserved rather than split by guesswork; gabbaim fill separate names via the new API. Source-linked personal data comes from the family profile; the gabbai controls names/classification and sons' own yahrzeits. An independent person, including a son-in-law linked by `familyChildId`, can be created without a login. No automatic merging by names or new account linking is implemented. See `server/API.md` for write restrictions and all endpoints.

Each Shabbat/festival service stores its date, reading, service type and calls linked to stable person IDs, with name snapshots. Kohen/Levi counts use the previous **6 Gregorian calendar months**, Yisrael counts **12**; boundaries are inclusive with shorter-month clamping. These counts roll and do not reset at either New Year. Last aliyah uses the full history and displays Hebrew date plus reading; no record displays exactly `לא נמצא`. Corrections replace a service atomically; duplicates are rejected; cancelled services do not count. All new endpoints require gabbai authorization. The gabbai UI remains future work.

36 app tests, 48 server tests, TypeScript and Metro export for iOS/Android/web pass. Android UI checks verified the 5700 lower year limit, common/leap Adar choices and year-dependent Cheshvan day 30 clearing. Screenshot: `.expo/birth-year-screen.png`; all temporary form changes were discarded without saving. The app and server month calculations are cross-checked for 101 Hebrew years. Tests cover birthday promotion with unchanged IDs, Adar/month-length cases, month-end count windows, historical latest aliyah, cancellation/replacement, API permissions and archival/restart foreign keys. All server test databases are temporary; no real community records were created or altered. Earlier sections below describe prior stages and should not override this section.

## Latest change — Kohen, Levi or Yisrael

The member form now requires `tribe` (`kohen`, `levi`, `yisrael`) in a three-choice dropdown immediately after the full name. Sons have no independent selector or stored copy: the form reads the father's current selection, and database consumers resolve it through `owner_user_id` to his self person row. Each married daughter has a separate required `spouseTribe` dropdown for her husband, directly after his name. Marriage/gender changes clear inapplicable spouse status, while reselecting the existing gender preserves it.

`normalizeProfile` adds unknown empty selections to legacy data without guessing a status. The current form requires the applicable choices before saving. Older clients may omit the fields to preserve known values or legacy unknowns; omitting the whole child list also preserves it. Explicit invalid/empty required selections are rejected by the server. `spouseTribe` must be empty for sons and unmarried daughters. Existing child IDs remain permanent.

SQLite adds `tribe` and `spouse_tribe` columns idempotently. The member's value lives in their profile JSON and self row; a daughter's husband value lives alongside her existing spouse fields. No new person/login or aliyah tables are introduced. Migration tests preserve archival state, creation times and IDs. See `server/API.md` for the complete contract.

32 app tests, 34 server tests, TypeScript and Metro export for iOS/Android/web pass. Android UI checks confirmed field order, all three choices, an independent son-in-law selection, clearing after marriage/gender changes and immediate father-to-son updates. Screenshots: `.expo/tribes-son-in-law.png` and `.expo/tribes-inherited-son.png`. All temporary form changes were discarded without saving. The Android development client receives these TypeScript changes from local Metro; native rebuilds are unnecessary. Use English when communicating with Noam; the app stays Hebrew.

## Latest change — Yeshiva daily reference and calculated fallback

Noam supplied the complete Petah Tikva table from Yeshiva for **October 25, 2026**: sunrise 05:51, latest Shema Gra 08:37, latest prayer Gra 09:33, earliest Mincha 11:54, Plag 15:49, sunset 16:57, nightfall 17:16. `yeshivaReference()` in `src/zmanim.ts` holds this dated transcription. `loadZmanim()` uses it for that exact date, without a network request. The screen explicitly identifies it as a copied Yeshiva daily table. It must never carry over to another day, city or year.

**Automatic exact matching remains unresolved.** For dates without a supplied table, the app applies https://www.yeshiva.org.il/calendar/timeprinciples to second-precision Hebcal astronomy. Nightfall is sea-level sunset plus max(18 ordinary minutes, 18 seasonal minutes); earliest Mincha is noon plus max(30 ordinary minutes, half a seasonal hour). Latest Shema/prayer round down; sunrise/earliest Mincha/Plag/nightfall round up, sunset rounds down. Friday candle lighting uses 40 minutes for Petah Tikva and 21 for Tel Aviv, rounded down; parasha remains from Hebcal.

The calculated fallback gives 05:52 / 08:37 / 09:33 / 11:55 / 15:48 / 16:57 / 17:16 for the supplied date. Three minutes differ from the actual table. Rounding alone cannot explain Plag (raw Hebcal 15:47:52 versus Yeshiva 15:49). Do not change rounding, guess elevation, or add offsets based on one day's comparison. The dated transcription fixes today's display only. Yeshiva uses Skyview astronomy and its own city parameters; its city tables and public widget returned Cloudflare challenges to automated requests. An accessible authoritative feed/export is still needed for exact automatic matching on other dates. Those dates retain the explicit possible-difference notice. Candle lighting has not been compared with Yeshiva's table.

The cache namespace is `shul.zmanim.yeshiva-rules.v2`; previous namespaces are not read. Validation checks the date and actual source, requires all seven times, and rejects calculated/corrupt copies where the supplied table exists. 29 app tests, TypeScript and Metro export for iOS/Android/web pass, including all seven reference values, offline access to the transcription, cache provenance and no date/year carryover. All seven rows and the copied-table source label were checked in the running Android app; screenshots are `.expo/yeshiva-reference-screen.png` and `.expo/yeshiva-reference-screen-lower.png`. No native rebuild was needed for these TypeScript changes. The original transfer notes below describe old calculation choices. More details are in README.md.

## Hebrew birthdays

Birthdays for members and children now use two selection lists for the Hebrew day and month. Ordinary Adar, Adar I and Adar II are separate choices. Day 30 is unavailable for permanently short months, and choosing a shorter month clears an invalid day. The server applies the same validation. Cheshvan and Kislev allow 30 because no birth year is collected.

The `hebrewBirthDate` field stores `{day, month}` or null. Legacy Gregorian `birthDate` values remain intact and hidden from the birthday form; there is no guessed conversion around sunset. The database adds a nullable `hebrew_birth_date` column without replacing person rows or changing child IDs. Legacy app data and clients remain supported. Bar mitzvah ceremony dates remain Gregorian; birth-year comparisons are possible only where a legacy Gregorian birthday exists.

22 JavaScript tests, 29 server tests, TypeScript and Metro export for all three platforms pass. See `server/API.md` for the updated contract. Use English when communicating with the user; the app interface remains Hebrew.

The Android app has now been compiled locally with Gradle and installed/launched in `Shul_Regular_API_36`. Command: `./gradlew :app:assembleDebug -PreactNativeArchitectures=arm64-v8a --max-workers=4` from `android/`. APK: `android/app/build/outputs/apk/debug/app-debug.apk`; log: `.expo/android-build.log`. This is an ARM64 Debug development client using local Metro, not a signed distribution build. Other Android ABIs, physical devices and real push remain unverified.

The birthday dropdowns were checked in the running Android app, including selection of day 30 in Adar I and its removal when switching to Adar II. A screenshot is at `.expo/android-birthday-screen.png`. No birthday was saved during this UI check.

## ההתקנה במחשב הביתי הושלמה

הפרויקט נמצא ב־`/Users/Noam/Developer/Shul-Regular`. לפני השינויים נבדקו כל 36 קובצי המקור מול manifest ההעברה; כולם התאימו. אין היסטוריית Git או מסד קהילה אמיתי בחבילה.

- הותקנו Homebrew, ‏Node 24.22.1/npm 11.19.1, ‏Python 3.11.17, ‏CocoaPods 1.17.0, ‏Java 17 ו־Android Studio.
- Xcode 27.1 זמין עם runtimes של iOS 27.1 ו־27.0 ומכשיר בשם `iPhone Duo`.
- הותקן Android SDK 36 עם build-tools 36.0.0, ‏NDK 27.1.12297006, ‏CMake 3.22.1, ‏platform-tools ואמולטור ARM64 בשם `Shul_Regular_API_36`. ‏Gradle 9.3.1 פועל ו־`./gradlew help` עבר.
- התקנת npm הצליחה ונוצר `package-lock.json`. בשחזור יש להשתמש ב־`npm ci`. נוספה `expo-system-ui` ותוקנה גישה לנתוני התראה חסרים.
- נוצרו `ios/` ו־`android/` מקומיים, והתקנת תלויות iOS באמצעות CocoaPods הושלמה.
- 43 בדיקות JavaScript, ‏57 בדיקות שרת, ‏TypeScript, תאימות חבילות, 21 בדיקות Expo Doctor, בדיקת הכלים המקומיים ויצוא Metro לשלוש הפלטפורמות עברו.
- בניית iOS מקומית עברה והאפליקציה פעלה בהדגמה ב־iPhone Duo/iOS 27.1; הממשק וזמני היום אומתו בצילום מסך. הותקנה `expo-build-properties` והוגדר `ios.enableSceneSupport: true` ב־`app.config.ts` כדי לפתור קריסה בפתיחה ב־iOS 27, לפי ההנחיות הרשמיות של Expo. יש לשמור את ההגדרה כל עוד נשארים ב־SDK 57 עם Xcode 27.
- אפליקציית Android נבנתה מקומית כ־APK לפיתוח עבור ARM64, הותקנה באמולטור והופעלה מול Metro המקומי. בדיקות משתמשים/שרת/Push מקצה לקצה נותרו לעבודה הבאה.

יש לפתוח טרמינל חדש כדי לטעון את הגדרות PATH, ‏`JAVA_HOME` ו־`ANDROID_HOME`. גיבויי קובצי zsh כוללים `.shul-backup-` בשמם. נתיב ActivePerl הישן הוחרג משום שגרסת Intel שבו הכשילה את בניית iOS. פרטי ההתקנה וההתראות של `npm audit` נמצאים בסעיף מצב המחשב הביתי ב־README. אין להפעיל תיקון audit מאולץ שמחזיר לגרסת Expo ישנה.

כל הבנייה ממשיכה להתבצע מקומית. יש לשמור על המזהים הקבועים ב־`community_people`; מסד העליות ממומש בשרת, וממשק הגבאים עדיין עתידי. אין צורך בחתימת הפצה או בהגדרת Push כדי לפתח במצב הדגמה.

המכשיר המאומת כעת הוא `iPhone Duo`: הריצו `npm run ios -- --device "iPhone Duo"`, או `npm start` לשינויי TypeScript לאחר ההתקנה. צילום מקומי נמצא ב־`.expo/ios-demo-2026-10-25.png`. הסימולטור הנוסף iPhone 18 Pro/iOS 27.0 התעכב במיגרציה של האתחול הראשון ולא אומת; השתמשו ב־Duo להמשך המיידי.

## מצב חבילת ההעברה המקורית — תיעוד היסטורי

המידע שמתחת לכותרת זו מתאר את המחשב הקודם ואת המצב לפני ההתקנה בבית. בפרט, החוסר בחבילות, בקובץ נעילה ובכלי המערכת כבר טופל כפי שמתואר למעלה.

## התחלה במחשב הביתי

1. המתן לסיום הסנכרון של חבילת ההעברה ב־Google Drive והורד את קובץ ה־ZIP במלואו.
2. חלץ את התיקייה `Shul-Regular` למיקום מקומי, למשל `~/Developer/Shul-Regular`. עבוד מהתיקייה המקומית, כדי שתיקיות הבנייה והחבילות לא יסונכרנו דרך Drive בזמן העבודה.
3. פתח את התיקייה הזו ב־Codex או בעורך שלך. קרא קודם את `AGENTS.md` ואת המסמך הזה. המידע המפורט נמצא ב־`README.md`; תיעוד השרת ב־`server/API.md`.

אפשר לבדוק את שלמות קובץ ההעברה לפני חילוץ באמצעות הקובץ המצורף ששמו מסתיים ב־`.zip.sha256`:

```sh
shasum -a 256 -c Shul-Regular-transfer-YYYY-MM-DD-HHMMSS.zip.sha256
```

החלף את שם הקובץ בשם שהגיע בחבילה. גם בתוך ה־ZIP יש `TRANSFER-MANIFEST.json`, עם גודל ו־SHA-256 לכל קובץ מקור.

## דרישות במחשב החדש

להרצת סימולטור iPhone ולבניית iOS נדרש **Mac**. התקן Xcode מלא, פתח אותו פעם ראשונה והשלם את הרישיון ורכיבי הפיתוח. התקן ב־Xcode גם סביבת iOS Simulator Runtime. ב־Xcode 27 הסימולטורים מוצגים באפליקציה **Device Hub**; ב־Xcode ישן יותר מדובר ב־Simulator.

נדרשים גם Node.js 24 ומעלה, npm, ‏CocoaPods ו־Python 3.11 ומעלה. אלה כלי מערכת שמתקינים במחשב החדש; הם אינם כלולים בקוד הפרויקט. אם Homebrew כבר מותקן, אפשר להתקין דרכו:

```sh
brew install node@24 cocoapods python@3.11
```

בדוק ש־`node --version` מחזיר 24 ומעלה, וש־`npm --version`, ‏`pod --version` ו־`python3 --version` עובדים. אם Homebrew מציין שצריך לעדכן את PATH עבור node@24 או Python, בצע את ההוראות שהוא מדפיס. אין צורך באישור חתימה או בחשבון Apple Developer לצורך בדיקת סימולטור בלבד.

להרצת Android נדרשים בנוסף Java ו־Android Studio/SDK. הכלים האלה לא הותקנו עדיין במחשב הקודם; ההוראות מופיעות ב־README. אפשר לפתח Android גם ב־Windows או Linux, אך בניית iOS המקומית מחייבת Mac.

## הפעולה הראשונה: התקנת חבילות ובדיקות

בטרמינל מתוך תיקיית הפרויקט המחולצת:

```sh
npm install
npx expo install --check
npm run typecheck
npm test
python3 -m unittest discover -s server/tests -v
npx expo-doctor
python3 tools/check_local_build.py --platform ios
```

במחשב הקודם Node.js, ‏CocoaPods ו־Xcode הותקנו, אבל Symantec חסם את מאגר npm גם ברשת הביתית. בניסיון האחרון ה־DNS היה תקין, אך התקבל HTTP 403 עם דף `Access Denied` ו־`policy_denied` של Symantec. לא שונו הגדרות האבטחה. צריך לנסות את ההתקנה במחשב החדש. אם נתקלים שוב ב־403, יש לבדוק גישה מאושרת למאגר או מאגר npm ארגוני מורשה.

**אין עדיין `package-lock.json` או `node_modules`: התקנת npm מעולם לא הושלמה.** זה אינו חוסר בחבילת ההעברה. יש לשמור את קובץ הנעילה שייוצר בהתקנה מוצלחת. גרסאות התלויות מוגדרות ב־`package.json`; אין צורך לשדרג את Expo או לשכתב את הפרויקט לפני שבודקים אותן. אם בדיקת התאימות מוצאת בעיה, תקן אותה ובדוק מחדש.

## המטרה המיידית: להציג את האפליקציה ב־iPhone

כל הבנייה צריכה להתבצע **מקומית**. אין להשתמש ב־EAS Build או בשירות בנייה בענן.

לאחר שהחבילות מותקנות והכלים זמינים:

```sh
npm run ios
```

זו הפעלה של `expo run:ios`: יצירת פרויקט iOS מקומי לפי ההגדרות, התקנת תלויות native, בנייה באמצעות Xcode והפעלת Metro. אפשר לראות את הדגמים הזמינים באמצעות:

```sh
xcrun simctl list devices available
```

כדי לבחור דגם מסוים, לדוגמה אם הוא מותקן:

```sh
npm run ios -- --device "iPhone 18 Pro"
```

אל תשתמש במזהי ה־UDID מהמחשב הקודם: אלה מזהים מקומיים לכל מחשב. ב־Xcode 27 אפשר לפתוח את חלון המכשירים ישירות:

```sh
open -a /Applications/Xcode.app/Contents/Applications/DeviceHub.app
```

במחשב הקודם ה־iPhone 18 Pro עם iOS 27.0 סיים לעלות, ו־Device Hub נפתח בהצלחה. **אפליקציית הקהילה עדיין לא נבנתה או הותקנה בו.** אם Expo CLI מתקשה ב־Device Hub, בדוק תאימות ל־Xcode 27; אין ליצור אפליקציית דמה או להציג מסך בית של iPhone כאילו זו אפליקציית הקהילה.

אפשר לפתוח פרויקט Xcode ידנית לאחר `npm run prebuild`, באמצעות קובץ ה־`.xcworkspace` שנוצר תחת `ios/`. התיקיות `ios/` ו־`android/` אינן נמצאות בחבילה כי עדיין לא נוצרו; הן מופקות מקומית מהמקור. הבנייה והפתרונות צריכים להישאר מקומיים גם אם צריך להתאים גרסאות או לתקן שגיאות.

לאחר בנייה והתקנה ראשונות, לשינויי TypeScript בלבד מפעילים `npm start`. זהו Metro ברשת המקומית, עם development client וללא tunnel.

## הפעלה במצב הדגמה או עם שרת

כברירת מחדל, ללא `EXPO_PUBLIC_API_URL`, האפליקציה עולה בהדגמה עם שמות והודעות בדויים ושמירה מקומית. לא צריך להגדיר חשבונות משתמש או Push כדי לראות את הממשק. זמני היום מבוקשים מ־Hebcal גם בהדגמה; לא מוצגים זמני דמה כשאין רשת.

אם רוצים שרת מקומי, העתק את `.env.example` ל־`.env`, הגדר את כתובת השרת לפי README, והפעל:

```sh
python3 -m server.app
```

יצירת חשבונות מקומיים ופרסום הודעת בדיקה מתועדים ב־README. השרת משתמש בספרייה הסטנדרטית של Python וב־SQLite בלבד. לא קיים כרגע מסד נתוני קהילה אמיתי להעברה. מסדי הנתונים של הבדיקות נוצרים בתיקיות זמניות ונמחקים אחריהן.

הגדרת Push מרוחק, אישורי Apple/Firebase, מזהה החבילה הסופי וחתימה להפצה יטופלו אחרי שהממשק פועל. במימוש הנוכחי שירות המשלוח הוא Expo Push; זה נפרד ממקום הבנייה. אין צורך להפעיל אותו כדי להריץ הדגמה.

## מה כבר מומש

- אפליקציית מתפללים עברית ב־React Native עם Expo SDK 57, עבור iOS ו־Android. מסכי בית, הודעות, פרטים והעדפות. אין עדיין ממשק גבאים.
- שבעת זמני היום בפתח תקווה, פרשת השבוע וכניסת שבת בפתח תקווה ובתל אביב ממקור Hebcal. קריאת שמע ותפילה לפי הגר״א; צאת לפי 8.5°. כרגע כניסת שבת מחושבת 40 דקות לפני השקיעה בפתח תקווה ו־20 בתל אביב; יש להתאים למנהג הקהילה בהמשך, ולא מובטחת זהות ללוח אתר ישיבה.
- פרטי חבר: שם, פלאפון אישי ופלאפון האישה, שם לעלייה לתורה, שם האישה למי שברך, פרשת בר מצווה ותאריך לידה לועזי.
- תאריכי יארצייט עבריים לקרובי המשפחה, כולל אדר א׳ ואדר ב׳. תזכורות שנתיות וחישובי המנהגים עדיין אינם ממומשים.
- ילדים מכל גיל עם שם, מין ותאריך לידה. לבנים שם לעלייה לתורה, פרשה ותאריך שבת בר מצווה. לנשואים שם בן/בת הזוג ושם לתורה לבן זוג או למי שברך לבת זוג.
- לכל ילד שורת אדם נפרדת בטבלת `community_people` ומזהה קבוע כבר מההוספה, מקושר להורה. כך בן שכבר עבר בר מצווה מוכן למעקב עליות עצמאי בלי שינוי זהות. לא נוצר לילד חשבון כניסה. הסרה מהמשפחה מעבירה לארכיון בלי למחוק את המזהה. **מבנה מסד הנתונים המלא ומעקב העליות עצמם יידונו עם המשתמש בהמשך.**
- הודעות עם חיפוש, סינון, נעיצה וסימון קריאה. תגובות מותרות רק להודעות מזל טוב ותנחומים. העדפות התראה אינן מסתירות הודעות מהלוח.
- שרת עם התחברות, הרשאות חבר/גבאי, הפרדת משפחות, שמירה ב־SQLite ותור Push אופציונלי. קיימים כלי CLI לניהול חשבונות והודעת בדיקה, ללא סיסמאות ברירת מחדל.

## מה אומת ומה עוד לא

**עברו: 16 בדיקות Node לקוד התאריכים ופרטי המשפחה, ו־24 בדיקות שרת.** אפשר להריץ את שתיהן ללא npm install, אם Node.js ו־Python כבר מותקנים. הן בודקות גם הרשאות, שדרוג נתונים, שימור זהות הילדים ותגובות. תעבורת Push ותגובות ספק הזמנים מוחלפות בנתוני בדיקה.

**עדיין לא בוצעו:** בדיקת TypeScript מלאה עם החבילות, Expo Doctor, בניית Metro/native, בדיקה חזותית של הממשק, בדיקת iOS/Android במכשיר, קבלת Push אמיתי ופריסה לשרת קבוע. אין צילום מסך של האפליקציה ואין בינארי להתקנה. הבדיקות שעברו אינן תחליף לבדיקת ממשק והרצה.

אין תלות חיצונית בקבצים מ־Hoshanot או ב־skills של Claude במחשב הקודם. הלקחים הרלוונטיים כבר נרשמו בתיעוד כאן. אין צורך להעביר הגדרות Codex, חשבונות, אישורי חתימה או כלי מערכת מהמחשב של העבודה.

## נוסח לפתיחת שיחה במחשב החדש

אפשר להעתיק ל־Codex לאחר פתיחת התיקייה המקומית:

> זה המשך לפרויקט הקהילה שלי. קרא את AGENTS.md ואת HANDOFF.md. נסה להתקין את החבילות במחשב הזה, השלם את הבדיקות ותקן תקלות שיימצאו, ובנה והריץ את האפליקציה בסימולטור iPhone. כל הבנייה מקומית בלבד, ללא EAS Build. שמור על קוד Android ועל המזהים הנפרדים של הילדים; את מבנה מסד הנתונים המלא ואפליקציית הגבאים נגדיר בהמשך.

## Android test build — October 27, 2026

Owner-only test channel; members will install from the Play Store, and that build never runs the update check.

- **Trigger:** a push to `redesign` that touches `src/`, `assets/`, `locales/`, `app.config.ts`, `package*.json`, `index.*`, `App.*` or `.github/workflows/android-test.yml`, or a manual run (Actions, "android-test", Run workflow). Workflow: `.github/workflows/android-test.yml`.
- **Needs (repository settings):** secrets `ANDROID_TEST_KEYSTORE_B64` (base64 of a PKCS12 `.p12`) and `ANDROID_TEST_KEYSTORE_PASSWORD`; variable `ANDROID_TEST_ENV` (multi-line `KEY=value`: the same `EXPO_PUBLIC_*` keys as `.env.dev`, e.g. API URL, region, Cognito pool, client and domain, web URL, federation). Keep the same keystore forever: an update signed with another key cannot install over the old one. The job fails with a message when any of the three is missing.
- **Where the APK is:** the repository's Releases page, tag `android-test-<run number>`, file `kehilot-test-<run>.apk` (the newest 5 are kept). The app is `com.shulregular.member.test` ("בדיקה · הקהילה שלי"), so it installs beside the store app.
- **In the app:** on start and on return to the app (at most every 6 hours) the test build reads the latest release; a newer one shows a card on Home with Download (opens the APK in the browser) and Not now (remembered per build). Home also shows a "Test build · <run>" tag. Offline or any error shows nothing.
- Not run here (2 GB machine): the workflow itself, Gradle, and the card on a device.
