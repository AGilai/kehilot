# מעבר למחשב אחר — הקהילה שלי

נקודת המשך מעודכנת במחשב הביתי: 27 באוקטובר 2026. המסמך עומד בפני עצמו; אין צורך בהיסטוריית הצ׳אט או בפרויקט Hoshanot כדי להמשיך.

## Latest changes — contextual aliyah selectors and Gregorian calendars (October 27, 2026)

Aliyah entry now shows `תפילה` only when the selected civil date is actually 10 Tishrei (offline `@hebcal/hdate` check). Changing the date away from Yom Kippur resets Mincha to Shacharit before fetching a template; Yom Kippur reading choices are omitted on other dates. `מניין` offers exactly `מניין ראשון` (1) and `מניין שני` (2). Historical labels use the same ordinals. Existing service/minyan IDs and the server’s 1–1000 compatibility range are unchanged; an old record above 2 keeps its original minyan as read-only text while its calls can be edited.

Shared `src/DateField.tsx` replaces all three Gregorian inputs: aliyah date, gabbai ceremony date and sons’ ceremony dates. The button always displays `DD-MM-YYYY`; iOS opens the native Hebrew-localized monthly inline calendar with month/year navigation and explicit confirm/cancel. Android opens the native calendar dialog with month/year navigation. Optional ceremony dates can be cleared, support future Saturdays, and validate Saturday selection; aliyah dates are bounded by today. `src/DateField.web.tsx` uses the browser’s calendar. These fields emit ISO date-only strings to existing state/APIs; `formatCivilDate`, `pickerDate` and `pickerDateISO` separate display from local-noon calendar conversion without UTC day shifts. Hebrew birthday/yahrzeit fields and stored dates are untouched. Numeric date displays in aliyah history, recommendation screens/printouts and healing-prayer addition dates also use DD-MM-YYYY.

Added Expo-compatible `@react-native-community/datetimepicker` **9.1.0**, lockfile and the plugin in dynamic `app.config.ts` (Expo cannot add that plugin automatically to a dynamic config). Prebuild, CocoaPods/Xcode iPhone 18 Pro build and ARM64 Gradle Android build passed locally; both rebuilt clients were installed against the same imported-data API (8011) / Metro (8082). A fresh clone needs `npm ci` and local native rebuilds for this module; Metro reload alone is insufficient. No cloud build was used.

Validation: **66 app tests**, TypeScript and iOS/Android/web export pass (`.expo/date-picker-checks.log`). New tests cover DD-MM-YYYY formatting, invalid/leap dates, local calendar round-trips across four time zones/DST boundaries and actual Yom Kippur dates/reset behavior. Backend code/data are unchanged; the previous 150 server tests remain the latest server verification. Local Xcode UI testing of the real installed iPhone app passed: ordinary-date prayer selector hidden, two minyan choices, native monthly calendar opening/confirmation. Screenshot `.expo/date-picker-ui/attachments/7988D511-0489-48F5-88BE-4513A544438E.png`; log `.expo/date-picker-ios-ui.log`. Temporary UI-test host/runner were removed afterward. Android verified year/month navigation, selecting 21-09-2026 with both prayers, its three-call Mincha form, and selecting 24-10-2026 afterward with the prayer selector hidden and Shacharit restored. Screenshots `.expo/date-picker-yom-kippur-mincha.png` and `.expo/date-picker-reset-shacharit.png`. No aliyah/profile save was performed; raw database checks retained 240 active people, 75 services and 577 calls. Native build logs: `.expo/date-picker-ios-build.log`, `.expo/date-picker-android-build.log`. All preview data, test bundles, screenshots and logs remain ignored.

## Previous changes — safe margins, compact rows and concise events (October 27, 2026)

The user reported right-edge clipping and a roughly 3.5-page report, requested at most 2–2.5 pages, and asked to remove verbose event wording. Print margins are now **15 mm on all sides**. `src/printRecommendations.ts` explicitly supplies native margins in points (`15 * 72 / 25.4`), because iOS previously received zero native margins. `recommendationsHtml(report, nativeMargins)` applies 15 mm CSS margins for browser/Android, and zero CSS page margins on iOS where the native renderer reserves the same margin; they are not added twice. A4 portrait stays 595 × 842 points. The print table uses 7.5-point text, 1.1 line height, 0.75-point vertical / 1.5-point horizontal padding, tighter headings and rebalanced columns to reduce wrapping without hiding data. Screen table sizes are unchanged.

Normal server event descriptions are exactly `בר מצווה` or `יארצייט - <relationship> - <Hebrew day/month>`, for example `יארצייט - אם - כ׳ חשוון`. The full effective date/year, relative name and recorded death date remain in structured metadata/storage. The requested split-parasha note is retained; ambiguous yahrzeits still append the original death date and required custom reminder. Existing day-30/custom/eligibility/ranking rules are unchanged.

Verification: **63 app tests, 150 server tests**, TypeScript and all-platform export pass. The actual imported-data report for October 31 (101 rows) was rendered both through Chromium and through **Expo’s actual iOS `ExpoWKPDFRenderer` / `ExpoWKViewPrintPDFRenderer` sources** in a temporary, locally compiled simulator helper. Final results: **two A4 portrait pages in each renderer** (iOS 1.99 pages of content; Chromium 1.89), all 101 worshipper names preserved, and every nonwhitespace character within the 15 mm side margins. Both iOS pages were visually reviewed. No paper print job was sent; physical delivery remains unverified. The helper (`com.shulregular.printcheck`) was uninstalled, preview API restarted with the existing imported database, and the real iPhone preview reopened on Metro 8082. No project native dependencies changed; compilation remained local.

Private artifacts under ignored `.expo/`: `recommendations-compact-ios.pdf`, `recommendations-compact-chrome.pdf`, corresponding `*-page1.png` / `*-page2.png`, HTML/JSON, and `ios-print-check/` helper sources/bundle. These contain imported personal data and must never be committed. Logs: `recommendations-compact-app-checks.log`, `recommendations-compact-server-tests.log`, `recommendations-compact-api.log`. Live API checks confirmed concise event wording and unchanged 240-person roster / 75-service, 577-call history. The previous synthetic-only portrait check below did not verify native iOS margins and is superseded by this real-data/native-renderer verification.

## Previous change — portrait recommendation printing (October 27, 2026)

The user requested portrait printing with the complete row fitting the page width. `src/printRecommendations.ts` now requests `Print.Orientation.portrait` and 595 × 842-point pages. `src/recommendations.ts` uses A4 portrait with 8 mm margins, 8-point table text, compact 3-point cell padding, full-width fixed percentage columns and wrapping for long names/events. All seven columns remain; repeated headers, colors, row preservation and the distinct Events/last-aliyah columns are retained. Screen table sizes are unchanged.

63 app tests, TypeScript and all-platform export pass (`.expo/recommendations-portrait-checks.log`). Local Chromium/PDFKit verification rendered a synthetic 112-row report to **five A4 portrait pages**, confirmed every row’s beginning/end on the same page and all 15,708 nonwhitespace text characters within the horizontal print margins, and visually checked first/last pages. Private artifacts: `.expo/recommendations-portrait-stress.pdf`, `.expo/recommendations-portrait-page1.png`, `.expo/recommendations-portrait-page5.png`. No physical print job was sent; printer delivery remains unverified. No server/native dependency changes or native rebuild are needed. The iOS preview was refreshed from local Metro 8082 to avoid retaining its older loaded bundle. Imported personal records are untouched and remain excluded from Git.

## Previous changes — recommendation filters, last aliyah and split parashot (October 26, 2026)

User requested changes to all five ranked recommendation tables, preserving the Events table. Screen and printed HTML now share section-specific columns: Events retains `אירוע`; the remaining sections use `עלייה אחרונה`, containing the latest included call’s Hebrew date and saved reading, or `לא נמצא`. The backend adds `lastAliyah` to recommendation people, using the same selected-prayer cutoff as counts. Same-date ties prefer Mincha, then lowest minyan and stable service ID, so the reading belongs to the actual last date.

All five ranked sections exclude people with a yahrzeit or bar-mitzvah event from the selected date through 30 days afterward, inclusive, or an uncancelled named aliyah within the preceding 30 days (including exactly day -30). “Coming month” is interpreted as 30 civil days relative to the chosen report. Yom Kippur Mincha also checks that day’s preceding morning calls. Filtering happens before sorting/limits so the next eligible people fill vacancies. The Events section keeps its existing inclusive seven-day yahrzeit window and is not filtered for recent aliyot.

A saved combined bar-mitzvah parasha matches the combined reading or, in a split year, both separately read components. The first separate Shabbat adds exactly `ניתן להעלות גם בשבת הבאה`; the second includes the bar-mitzvah event only if the person had no uncancelled named aliyah on the actual first Shabbat, irrespective of prayer/minyan/position. Calls on unrelated dates do not satisfy it. Other events, including a yahrzeit, remain even when that bar-mitzvah event is omitted. Saved single portions still match combined readings containing them. Calendar lookup handles pairs straddling Rosh Hashanah; upcoming reservations use the same rules and community yahrzeit custom. Stored profiles/roster/history remain untouched by reports.

The report screen now uses a vertical `FlatList` to mount sections as they enter view, rather than building every table at once. Each table scrolls sideways independently. Native scroll viewports stay LTR and start at the right edge; rows/text provide the RTL layout. This avoids negative-origin clipping and makes the final columns reachable on Android. Printing still includes the entire report.

Verification: **63 app tests, 150 server tests**, TypeScript and all-platform export pass. New coverage includes every ranked group and refill cap, exact 29/30/31-day history boundaries, day-0/7/8/29/30/31 yahrzeit horizons, upcoming parasha/ceremony dates, selected community custom, last date/reading consistency, all seven combined pairs, cancellation, any-prayer/minyan first-Shabbat history, remaining yahrzeit events and a split pair across Rosh Hashanah. HTML checks assert different final headers/cells and escape last-aliyah text. Live API checks retained all 240 imported people and 577 calls in 75 service/minyan records and verified every visible last-aliyah label and recent-date filter. Android verified normal vertical/horizontal scrolling, the filtered 12-person Kohen table and the reachable `עלייה אחרונה` column including `לא נמצא` (`.expo/recommendation-filters-last-aliyah.png`). Private printable output: `.expo/recommendation-filters-report.html`; logs `.expo/recommendation-filters-{app-tests,server-tests,export}.log`. API restarted on port 8011 using the same imported database; Metro remains 8082. No native dependency/build change, cloud build, messages or print job was needed.

## Previous changes — real workbook preview and separate minyanim (October 26, 2026)

**The workbook import has been applied. Do not clear or reseed the preview.** The running local API on port 8011 uses ignored `.expo/gabbai-preview.sqlite3`; Metro serves the existing local iOS/Android development clients on 8082. `.expo/gabbai-preview.py` now requires this existing database and never seeds fictional people. `.expo/gabbai-preview-access.txt` contains machine-local access instructions. The existing synthetic gabbai account/session remains usable but its community/roster rows are inactive, keeping it out of the real directory and recommendations. SMS is locally captured and push is disabled; no real messages were sent.

Source: ignored `server/data/imports/שמות מתפללים.xlsx`, sheet `New`, A tribe/B surname/C first name/D Torah name/E wife's prayer name/F bar-mitzvah parasha/H yahrzeits/J classification/M Hebrew birthday. Excluded J blank, `אורח`, `עירייה`. History sheets `עליות תשפו` and `עליות תשפז`, A civil date/B position/C surname/D first name. User explicitly confirmed: repeated blocks are separate actual minyanim; include all calls; Yom Kippur's second three calls are Mincha; `א - לא קבוע` maps to `א`, `דור ב-עזב` to `קבוע`; retain every yahrzeit, use `לא ידוע` when relationship is unspecified, retain uncle/in-laws, and map a spouse's parents to in-laws. Leave `New!M34`'s unspecified Adar month in a leap year unresolved.

Imported **240 people** (78 `א`, 92 `דור ב`, 21 `דור ב-נשוי`, 11 `חתן`, 38 `קבוע`; 15 Kohanim, 32 Leviim, 193 Yisraelim), **69 yahrzeits** across 44 people, and **577 historical calls in 75 service/minyan records on 67 dates**. Of the calls, 463 match included people and 114 retain guest/excluded/unmatched caller snapshots without creating excluded roster people. Six records are second morning minyanim and two are Yom Kippur Mincha. Historical partial records are preserved as supplied; missing calls are not invented. Birthdays: 43 complete, 31 legacy yearless, 165 absent, one unresolved; the latter has no guessed structured date and its original cell is shown as a read-only `birthDateNote` in the person editor. Saving a complete valid Hebrew birthday clears that note. There are 21 yahrzeits marked `לא ידוע`; directory search now includes yahrzeit names and Hebrew relationship labels so the gabbai can find and correct them.

These are independent roster records, using stable import IDs, without guessed family links or login accounts. Optional contact columns remain private source provenance, not verified phone identities. Phone onboarding/linking requires a separate explicit account-linking step; a shared name or an imported contact cell does not establish account ownership. Seat quotas remain unknown unless explicitly set by the gabbai. Permanent existing child identities are untouched.

The private SQLite backup before replacement is `.expo/gabbai-before-workbook-20261026-211159.sqlite3`; `.expo/workbook-import-receipt.json` records the applied counts and source hash. Private staging/audit helpers and JSON live under `.expo/`, including `prepare-workbook-import.py`, `workbook-import-plan.json`, `import-workbook-candidate.py` and `workbook-import-validation.json`. Original source cells/coordinates are also retained in private `workbook_import_source` / `workbook_import_calls` tables. **Never commit the workbook, preview/backup database, audits or screenshots. Do not rerun the replacement importer over subsequent manual edits.** This tailored historical import is distinct from the app's names/phones-only membership Excel upload.

`aliyah_services` now has `minyan` (default 1, unique date/prayer/minyan). Upgrade preserves service/person IDs, guest calls and name snapshots inside an atomic migration. The entry screen selects minyan and distinguishes saved prayer/date/minyan when editing. Yom Kippur has separate `יום כיפור - שחרית` and `יום כיפור - מנחה` reading/report choices; Mincha requires Kohen, Levi and third, with no separate Maftir/extras. Extra eighth and later aliyot on ordinary Shabbat now accept any tribe. Festival extras remain prohibited. Report statistics include every minyan; a Mincha report includes that date's preceding morning calls, while a morning report excludes that date. Extended yahrzeit vocabulary supports in-laws, uncle/aunt and unknown relationship. Contracts are in `server/API.md`.

Verification: **61 app tests, 139 server tests**, TypeScript and iOS/Android/web export pass. Tests cover preservation when migrating old history, multiple minyanim/conflicts, unrestricted extra aliyot, Yom Kippur's three-call Mincha, morning-to-Mincha recommendation counts and extended kinship. A separate live-HTTP audit compared every imported person's rolling count/last date and all service/call totals against the workbook. Android verified the populated report, both Yom Kippur report choices and the imported three-slot Mincha editor (`.expo/workbook-yk-mincha-entry.png`). Local clients retain the previously built printing modules; no new native dependencies or hosted build were needed. Test/export logs: `.expo/workbook-feature-{app-tests,server-tests,export}.log`.

## Previous changes — configurable community yahrzeit custom (October 26, 2026)

The user answered the earlier yahrzeit-policy question. Their specified rules are now implemented through a shared server setting, editable by gabbaim in **העדפות → הגדרות הקהילה → מנהג חישוב יארצייט**. Choices: `אשכנז` (`ashkenaz`) and `עדות המזרח` (`sephardi`). `server/settings.py` adds a singleton table with selected custom, updater and timestamp. Upgrade starts unselected rather than guessing, and never resets an existing choice. Authenticated GET `/api/community-settings`, gabbai-only PUT `/api/admin/community-settings` accepting exactly `{yahrzeitCustom}`, and `/api/me.communitySettings` are documented in `server/API.md`. Personal notification preferences remain separate.

Regular Adar maps to Adar I under Ashkenaz and Adar II under Sephardi in leap years. Explicit Adar I/II maps to Adar in ordinary years and stays in its own month in leap years. Sephardi ל׳ Cheshvan/Kislev remains on the 30th when it exists, otherwise moves only to the following first. The user clarified: **when the 30th exists, both customs use only the actual 30th**, and the person appears only if that date is on the service or in the following seven days. **Only when the 30th is missing** does the Ashkenaz simplification check both the 29th and next first. In a short month, this handles the requested Shabbat-22/Shabbat-29 case: the 29th is included at the previous Shabbat’s +7 boundary, so both reports include the person. Both retain the source date `ל׳ חשוון`/`ל׳ כסלו` and reminder `יש לבדוק עם המתפלל כיצד הוא נוהג` with `needsReview:true`.

Every yahrzeit event now carries `recordedDay`, `recordedMonth`, `recordedHebrewDate` (yearless source) separately from effective `date`/`hebrewDate`; its printed/screen description includes the source date. Reports include `yahrzeitCustom` and a note naming the applied policy. An open report refreshes when background state detects a different community setting. Profile yahrzeits, permanent IDs, roles, quotas and notification preferences are not changed by the setting. Until selected, the initial flagged fallback remains. No rule was provided for ל׳ Adar I in an ordinary year, so that unsupported missing-date edge retains flagged adjacent-date candidates.

59 app tests, 133 server tests, TypeScript and all-platform export pass. Added checks cover protected/validated settings, audit/persistence across restart, unchanged source dates/identities, both Adar policies, explicit Adar mappings, full/short Cheshvan/Kislev, immediate report changes and the short-month Shabbat-22/29 Cheshvan case (5789), exclusion from the preceding Shabbat in a full month (5785), and exact inclusive day-0/day-7 boundaries for an existing 30th in both months/customs. Both printable HTML reports for Shabbat 22 and 29 Cheshvan 5789 were checked for original ל׳ and the worshipper reminder. Android verified choosing/persisting each option and refreshing the report; screenshots `.expo/yahrzeit-custom-ashkenaz.png`, `.expo/yahrzeit-custom-sephardi.png`, `.expo/yahrzeit-custom-report.png`. At that stage the fictional preview was left on Ashkenaz. The subsequent workbook import above retained the selected custom. No native dependencies changed: the printing-enabled local clients from the previous step run these changes through Metro, without another native/cloud build.

## Previous changes — aliyah recommendations and printing (October 26, 2026)

Gabbai tools now includes `מומלצים לעלייה לתורה והדפסה`, implemented in `src/screens/GabbaiRecommendations.tsx`. It defaults to the nearest Shabbat/Israeli Yom Tov, with Hebrew-year and actual dated reading dropdowns (5700 through dynamically current year + 10). Ordinary Shabbat title follows `שבת פרשת וירא - תשפ״ז`; holiday headings use the holiday name. Switching dates recalculates events, counts and eligibility. Print opens the native print dialog (web: separate printable window), with RTL landscape tables, colors, repeating headers and escaped user text.

`server/recommendations.py` adds gabbai-only GET `/api/admin/aliyah-recommendations/calendar?year=...` and `/api/admin/aliyah-recommendations?date=...`. Six sections: all events, 15 Kohanim, 15 Leviim, 25 Yisrael `א`, 35 Yisrael exact `דור ב`, 10 Yisrael `קבוע`. User explicitly confirmed **exclude `דור ב-נשוי` from the דור ב list**. Kohen/Levi lists include all classifications. Event people may also appear in ranked sections. All sections have the same seven requested columns; Kohen pale blue, Levi pale gold, Yisrael white. Rank ascending rolling count, oldest last date (never recorded first), then stable name/ID. Six/twelve Gregorian-month windows are relative to the selected service, with that date and later records excluded. Uncancelled named morning/Mincha history counts; guests do not.

Events include saved bar-mitzvah parasha anniversaries/exact ceremony dates and yahrzeits in `[service date, date+7 days]`, inclusive. Single saved portions match a combined reading containing them; saved combinations require the same combination. Hebrew spellings/separators/nikkud and year transitions are handled. Yearless ambiguous yahrzeits are candidates marked `דרוש בירור מנהג`: regular Adar checks both Adars in leap years; Adar I/II maps to Adar in ordinary years; missing day 30 checks adjacent 29th/first. The initial flagged-candidate fallback is superseded by the community-custom setting above, following the user’s answer. No halachic determination or stored date change is made.

Future eligibility is projected through existing roster rules in an immediate SQLite transaction that is always rolled back. Permanent IDs, current eligibility, source rows, allocation revisions, seating reports and history remain unchanged by previews. One aggregate query supplies statistics. The report uses current known profiles/classifications and recorded calls, without predicting future calls or reconstructing historical membership states. Contracts and conventions are documented in `server/API.md`.

New dependency `expo-print ~57.0.2` was installed with Expo's compatible version. Native projects were regenerated locally; both Xcode/CocoaPods iOS and ARM64 Gradle Android builds passed and were installed. Logs: `.expo/recommendations-ios-build.log`, `.expo/recommendations-android-build.log`. Pulling this dependency requires rebuilding the development clients locally. No hosted build was used.

59 app tests, 122 server tests, TypeScript and all-platform exports pass. New checks cover authorization, exact caps/filters, rolling boundaries/ordering, selected/future/cancelled-call exclusion, guest exclusion, event +7 boundary, combined parashot, Hebrew-year transitions/ambiguous dates, and future-child eligibility with unchanged source/roster rows. HTML tests cover RTL column order, colors/zero values, escaping and no external assets/scripts. Android verified the report, choosing another parasha and the native print preview: `.expo/recommendations-report-top.png`, `.expo/recommendations-other-parasha.png`, `.expo/recommendations-native-print.png`. Local Chromium/PDFKit checks verified all 106 fictional rows in a six-page A4 landscape PDF, including first/last-page Hebrew layout and repeated headers: `.expo/recommendations-pagination.pdf`, `.expo/recommendations-print-page1.png`, `.expo/recommendations-print-page6.png`. No physical print job was sent; physical printer delivery remains unverified. All sample people/files are fictional under ignored `.expo`; no real member data was changed.

## Previous changes — phone sign-in and Excel membership list (October 26, 2026)

This supersedes the classification-review workflow below. The app now uses phone + SMS OTP sign-in, with no email/password registration UI or new-member review screen/card. `src/screens/PhoneLogin.tsx` requests a code, supports autofill/resend/expiry, then accepts the server-issued session. Missing tribe opens the normal details form. `verifiedPhone` is read-only in both member and gabbai profile editors. The same gabbai person editor retains all registered/custom classifications; manual edits override automatic membership matching.

`server/phone_auth.py` adds canonical Israeli mobile identities in `verified_phones`, transient HMAC-only `phone_challenges`, and persisted rate counters. Codes are random six digits, expire in 5 minutes, allow 5 wrong attempts and can be consumed once atomically. Resends wait 60 seconds and invalidate earlier codes. Limits: 5 sends/number/hour, 20/IP/hour, 200 total/day; 20 verify submissions/number/15 minutes and 60/IP/15 minutes. No codes/credentials/membership status are returned in request responses or logs. The new public endpoints are `/api/auth/phone/request` and `/api/auth/phone/verify`; full contracts and proxy/scale caveats are in `server/API.md`.

`server/member_import.py` stores imported names/phones in `association_members`, with importer and server timestamp. Gabbai tools now has an Excel import/list screen instead of classification review. Import is atomic and additive: `.xlsx`, 5 MiB, 10,000 rows, bounded ZIP expansion, safe XML parser, no formulas, duplicate normalized numbers rejected. `openpyxl==3.1.5` and `defusedxml==0.7.1` were installed locally and pinned. The blank `server/association-members-template.xlsx` has Hebrew split-name/phone headers and text phone formatting. Full names are supported without guessed splitting. CLI commands: `import-members --author-email ... --file ...`, `membership-template --file ...`.

After verified sign-in, new list matches get `א`, others `קבוע`; role is always member unless explicitly linked to an existing gabbai. No seat quota is guessed. Import can promote an automatically classified regular account later, but explicit gabbai classifications persist through imports/relogin via the existing `classification_override`. Upgrade marks existing classifications as explicit, retires the old review queue/alerts and preserves all IDs/history. `/api/register` returns 410; the obsolete review endpoint returns 404 and `membershipRequests` is removed from state. Legacy tables remain for additive upgrades, with no worker sends.

**SMS provider is not selected/configured yet.** No real SMS has been sent or verified. User explicitly requested a configurable integration. `server/sms.py` supplies a Twilio Messages transport; `server/.env.example` lists server-only credentials and persistent `SHUL_OTP_SECRET`. Missing configuration fails closed with 503. No production fixed-code or SMS bypass exists. Python does not auto-load Expo `.env`; export `server/.env.local` as documented before starting the API. All compilation stays local; no new native modules are needed for this change.

Existing editable profile phone fields are never trusted to claim an account. Before phone rollout, explicitly run the protected local CLI `link-phone --email ... --phone ...` for existing users/gabbaim. This preserves their permanent identity, family, roles, quota/history and active sessions; conflicts return 409 rather than merging people. Unlinked legacy password login remains for migration; linked accounts must use SMS. Number reassignment/account merging/self-service number changes remain future work.

56 app tests, 113 server tests, TypeScript and all-platform exports pass. Tests cover listed/unlisted membership, admin authorization, bad spreadsheets and atomic imports, canonical phone matching, OTP expiry/replay/resend/rate limits/concurrent use, missing provider/transport failure, sticky manual demotion, readonly verified phones, preserved account/family identities and retirement of the review alerts. SMS tests use an injected sender and never make real deliveries.

Live localhost HTTP checks verified a gabbai phone sign-in, a two-row fictional Excel upload, association/regular status, single-use code rejection, and member/admin isolation. Android UI confirmed the replacement Excel/list screen and sign-out → phone → random simulated SMS code → same gabbai account. iPhone Home was checked with the review card absent. Screenshots: `.expo/phone-membership-import-screen.png`, `.expo/phone-login-screen.png`, `.expo/phone-code-screen.png`, `.expo/phone-login-success.png`, `.expo/phone-gabbai-iphone.png`. The existing ignored preview fixture now injects an SMS capture function instead of contacting a provider; it links fictional gabbai number `0500000001`, writes each random code to ignored `.expo/phone-preview-sms.json`, and stores a local secret with mode 0600. Updated access instructions are in `.expo/gabbai-preview-access.txt`. This fixture must never be deployed or confused with production SMS verification; no codes appear in API responses and no real SMS/push was sent.

## Previous changes — custom classifications and aliyah labels (October 26, 2026)

Gabbaim can now select every registered classification for **any** person, including account holders and their own gabbai account. `server/classifications.py` introduces a shared registry seeded with the five original labels and existing legacy labels. GET/POST `/api/admin/classifications` is gabbai-only; POST `{name}` creates a unique trimmed 1–60-character label. Names persist across restart and are included in gabbai `/api/me.classifications`. Members cannot create/assign classifications. Labels do not grant admin roles or seating; only `א` keeps seating eligibility, and quota clearing/revision behavior is unchanged.

`ClassificationFields` is reused by new-member review and the full person editor. It shows every option and an inline custom-label creator. Creation selects the new label for the current draft; the regular save commits assignment. A gabbai defaults to `א` only while unclassified; refresh no longer overwrites a manually selected category. Child/husband overrides remain permanent; association-derived default family classifications apply only under `א`, with regular-attendee defaults for other known household categories.

The aliyah picker offers separate `א׳ ראש השנה` / `ב׳ ראש השנה` choices and the server's Tishrei 1/2 template defaults accordingly. Visible aliyah labels use `שלישי` through `שביעי`, then `שמיני`, `תשיעי`, `עשירי` and further Hebrew numbers. Form validation and historical displays share `aliyahLabel()`. Canonical `ישראל 1` etc. API/SQLite keys and old reading labels are unchanged, preserving existing calls, guests, person IDs and statistics.

Android preview checks confirmed creating and assigning a shared custom classification, plus standard and extra aliyah labels (`שמיני`, `תשיעי`). Screenshots: `.expo/gabbai-custom-classification.png` and `.expo/gabbai-ordinal-aliyot.png`. The iPhone preview was reopened against the updated local Metro/API. All preview records remain fictional.

54 app tests, 99 server tests, TypeScript and all-platform exports pass. New checks cover registry authorization/validation/duplicates, arbitrary classification assignment to heads/gabbaim, custom-label persistence/migration, preserved identities and seat restrictions, both Rosh Hashanah calendar defaults, and ordinal display without stored-key changes. These changes need only the existing local development clients and a preview API/Metro restart; no new native dependencies or cloud compilation.

## Previous change — first gabbai management tools (October 26, 2026)

The app now has a gabbai-only Home entry `כלי הגבאי`, with a searchable congregant directory/editor, announcement/weekly-PDF publishing and complete morning aliyah entry. The regular member tabs remain available. Gabbai accounts are treated as `א` in the roster; quota is still configured explicitly. The backend checks every administrative operation, and member clients cannot grant themselves role/classification privileges.

`server/gabbai.py` provides full-person GET/PUT and an Israeli-calendar morning template/complete-record API. The editor reuses `ProfileForm` and validates/saves account, son and linked-husband edits to the authoritative family records in one transaction. It preserves permanent community/roster IDs and historical name snapshots. A nullable `classification_override` retains explicit gabbai changes to derived family classifications. Son `דור ב-נשוי` also sets marriage true; `דור ב` clears marriage/spouse details with a UI notice. Son tribe stays inherited from the father. Without an override, automatic family defaults continue.

Aliyah templates require 7+Maftir on Shabbat, 5+Maftir on weekday Yom Tov and 6+Maftir on weekday Yom Kippur. Only ordinary Shabbat permits additional Israel slots before Maftir; festivals forbid extras. Pickers filter tribe and offer `אורח` for every slot. Guest calls use a nullable person FK and the label `אורח`; no guest identity or name is collected or counted in member statistics. The migration copies old calls and name snapshots. New UI writes use `/api/admin/aliyah-records` with full/minimum validation. Existing partial-history/Mincha write API remains supported; see `server/API.md` before changing its compatibility contract.

`server/documents.py` stores weekly PDF BLOBs and metadata in SQLite, atomically publishes the weekly announcement and queues existing preference-aware notifications. Downloads require the session header. Invalid format/base64/path/size input leaves no partial announcement. Maximum decoded file size is 10 MiB. The member message detail has the authenticated PDF open/share/save action. Actual push delivery remains unverified and needs the existing credentials/device setup.

New Expo-native dependencies: `expo-document-picker`, `expo-file-system`, `expo-sharing` (SDK 57 versions locked); `expo-sharing` is in app config. Local prebuild and CocoaPods completed. Local ARM64 Gradle build passed (`.expo/gabbai-android-build.log`), and Xcode compiled/installed on iPhone 18 Pro (`.expo/gabbai-ios-build.log`). Rebuild development clients after pulling these dependencies. Compilation never used EAS/cloud build. The online Expo dependency compatibility check and all 21 Expo Doctor checks pass.

53 app tests, 93 server tests, TypeScript and iOS/Android/web exports pass. Tests cover admin authorization, full-profile/family synchronization, marriage overrides, ID/history-preserving guest migration, calendar slot counts, guest statistics, atomic corrections and PDF upload/download/privacy/size behavior. Android UI checks verified the directory and son marriage-classification edit, text publication, all eight Shabbat slots with named congregants/guests, native PDF selection/upload and the OS sharing sheet. A recipient account received both announcements and downloaded byte-identical PDF content while remaining blocked from admin APIs. Screenshots: `.expo/gabbai-tools.png`, `.expo/gabbai-announcement.png`, `.expo/gabbai-aliyot.png`, `.expo/gabbai-pdf-published.png` and `.expo/gabbai-pdf-share.png`. All accounts and schedules are fictional; no real community data or real push sends are involved. A local preview is available on API port 8011 / Metro 8082, with local-only login details in `.expo/gabbai-preview-access.txt`; this fixture/database is ignored by Git and must never be deployed. Normal Metro/demo remains on port 8081. Seating-event/summary UI, Mincha UI and broader account linking remain future work. The earlier sections below describe previous stages and are superseded by this one where applicable.

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
