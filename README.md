# הקהילה שלי · גרסת המתפללים

אפליקציית React Native / Expo עבור iOS ואנדרואיד, בעברית, עם מסכי בית, הודעות, פרטים אישיים והעדפות. מצורף שרת Python ו־SQLite לקהילה אחת. גבאים משתמשים באותה אפליקציה עם מסכי ניהול נוספים לעריכת מתפללים, פרסום הודעות ולו״ז PDF ורישום עליות לתורה.

למעבר למחשב אחר ולהמשך מהנקודה הנוכחית, קרא את [HANDOFF.md](HANDOFF.md). הוא כולל הוראות התקנה, מצב הבדיקות, ההחלטות שהתקבלו ונוסח לפתיחת שיחת המשך.

**בחירת הפיתוח: כל בניית האפליקציה מתבצעת מקומית במחשב של המשתמש.** iOS נבנה עם Xcode ו־CocoaPods, ואנדרואיד עם Android SDK ו־Gradle. פקודות הפרויקט אינן משתמשות ב־EAS Build או בשרת בנייה מרוחק. Metro פועל ברשת המקומית, ללא tunnel. עדיין נדרשת גישה לרשת להורדת תלויות, זמני היום, הודעות והתראות מרוחקות; העדפת הבנייה המקומית אינה שינוי במקור הנתונים או בשירותי המשלוח.

## GitHub repository

The shared project repository is [AGilai/kehilot](https://github.com/AGilai/kehilot), on branch `main`. It is public. The local `origin` remote points there; `personal` preserves the earlier `lebovitz/kehilot` repository. Use `git pull --ff-only` to update and `git push` to publish committed work to the shared repository.

Clone on another computer with `git clone https://github.com/AGilai/kehilot.git`, then read `HANDOFF.md` and install the machine-local dependencies. Credentials, local community databases, native build directories and generated artifacts are excluded from Git; compilation remains local.

## מצב המחשב הביתי — 25 באוקטובר 2026

המקור הועבר אל `/Users/Noam/Developer/Shul-Regular`. כל 36 קובצי המקור התאימו לגדלים ול־SHA-256 שב־`TRANSFER-MANIFEST.json` לפני השינויים המקומיים. החבילה אינה כוללת היסטוריית Git או מסד קהילה אמיתי.

הותקנו Homebrew, ‏Node.js 24.22.1 עם npm 11.19.1, ‏Python 3.11.17, ‏CocoaPods 1.17.0, ‏OpenJDK 17.0.21.0.2 ו־Android Studio 2026.2.1.8. ‏Xcode 27.1 כבר היה מותקן; כעת מותקנים גם runtimes של iOS 27.1 ו־27.0. מכשיר iOS מקומי זמין בשם `iPhone Duo`; מזהי המכשירים מהמחשב הקודם אינם רלוונטיים.

Android SDK נמצא ב־`~/Library/Android/sdk`, עם platform 36, ‏build-tools 36.0.0, ‏platform-tools, ‏NDK 27.1.12297006, ‏CMake 3.22.1, ‏Emulator ותמונת Google APIs עבור ARM64/API 36. נוצר אמולטור בשם `Shul_Regular_API_36` לפי Pixel 9 ונבדקה זמינות האצת Hypervisor. ‏Gradle 9.3.1 הורד דרך wrapper הפרויקט, ו־`./gradlew help` השלים את הגדרת הפרויקט בהצלחה.

נתיבי הכלים ו־`JAVA_HOME`/`ANDROID_HOME` הוגדרו ב־`~/.zprofile` וב־`~/.zshrc`, עם גיבויים ששמם כולל `.shul-backup-`. נתיב ActivePerl הישן הוחרג מ־PATH מפני שקובצי Intel שבו אינם רצים במחשב הזה. יש לפתוח טרמינל חדש כדי לטעון את ההגדרות. כלי Android הועתקו לתיקיית `cmdline-tools/latest` בתוך ה־SDK; קישור סמלי להתקנת Homebrew לא הספיק לזיהוי התמונות על ידי avdmanager.

`npm install` הושלם ונוצר `package-lock.json`; יש לשמור אותו ולהשתמש ב־`npm ci` להתקנה חוזרת. נוספה `expo-system-ui` בגרסה התואמת ל־SDK 57 לצורך הגדרת התצוגה הבהירה ב־Android. תוקנה קריאת `messageId` כש־`data` חסר בהתראה. נוצרו פרויקטי `ios/` ו־`android/` מקומיים והותקנו תלויות CocoaPods; הם עדיין מוחרגים מבקרת גרסאות.

עברו כאן: 56 בדיקות JavaScript, ‏113 בדיקות שרת עם Python החדש, ‏TypeScript ו־`npm run export` עבור iOS/Android/Web. גם `expo install --check`, כל 21 בדיקות Expo Doctor ו־`npm run check:local` עברו בשלב התקנת הסביבה. יצוא Metro אינו הוכחה לבניית native או לבדיקת ממשק.

בניית iOS מקומית באמצעות `npm run ios` הצליחה, והאפליקציה הותקנה ופעלה במצב הדגמה ב־iPhone Duo/iOS 27.1; הממשק וזמני היום נצפו בצילום מסך. הבדיקה הראשונית חשפה ש־iOS 27 דורש UIScene: נוספה `expo-build-properties` עם `ios.enableSceneSupport: true` ב־`app.config.ts`, לפי [מסלול התאימות הרשמי של Expo ל־SDK 57](https://github.com/expo/fyi/blob/main/ios-scene-lifecycle.md#staying-on-sdk-57-with-xcode-27). ההגדרה תישמר גם ביצירה מחדש של פרויקט iOS. אין צורך לשדרג SDK או לערוך ידנית את AppDelegate. בדגם Duo יש לצלם את המסך הפעיל באמצעות `simctl io … screenshot --display=1`; ברירת המחדל עלולה לצלם את המסך השני, השחור.

The Android Debug APK has now been built locally with Gradle, installed in `Shul_Regular_API_36` and launched against local Metro. The build used `:app:assembleDebug -PreactNativeArchitectures=arm64-v8a --max-workers=4`; the APK is at `android/app/build/outputs/apk/debug/app-debug.apk`, and the build log is `.expo/android-build.log`. This is an ARM64 development client that requires Metro, not a signed store release. Other ABIs and physical Android devices have not yet been verified. Login, family editing against a live server, replies, offline behavior and real push delivery still need full end-to-end testing on both platforms.

להמשך מהמחשב הזה פתחו טרמינל חדש והריצו `npm run ios -- --device "iPhone Duo"`. אחרי הבנייה הראשונה מספיק `npm start`. תמונת אימות מקומית נשמרה ב־`.expo/ios-demo-2026-10-25.png` (קובץ עבודה מוחרג). נוצר גם iPhone 18 Pro/iOS 27.0 נוסף; האתחול הראשוני שלו התעכב במיגרציית המערכת והסתיים, והוא כובה לאחר מכן. הפעלת האפליקציה בו טרם אומתה חזותית; Duo הוא המכשיר המאומת להמשך כרגע.

`npm audit` מדווח על חמש התראות high בשרשרת כלי Expo CLI, כולל `node-forge` ו־`zod`. אין להפעיל `npm audit fix --force`: ההצעה הנוכחית מחזירה את Expo ל־44.0.6. נדרש טיפול תואם בגרסאות הכלים לפני הפצה; לא שונתה גרסת SDK כדי להשתיק את ההתראות.

הסעיפים ההיסטוריים בהמשך על חסימת npm והכלים במחשב הקודם מתעדים את מצב ההעברה, ולא את ההתקנה במחשב הביתי.

## Updated classification and aliyah choices

Gabbaim can assign **any registered classification to any person**, including account holders, and add reusable custom classifications from the same dropdown area. The shared server list appears in the full person editor. Custom labels and classifications do not grant administrator roles; seating still requires `א`.

The reading list distinguishes `א׳ ראש השנה` and `ב׳ ראש השנה`, with the correct day preselected from the calendar. Aliyah questions and history use `שלישי`, `רביעי`, `חמישי`, `שישי`, `שביעי`, then `שמיני`, `תשיעי` and further Hebrew numbers for extra aliyot. Historical person links and stored position keys remain intact.

## Gabbai tools — October 26, 2026

A user assigned the `gabbai` role has the regular member experience, initial classification `א` (which the gabbai may later change) and an additional **כלי הגבאי** Home button. The directory lists congregants and opens their personal/family details, yahrzeits, classification, seat allocation and rolling aliyah statistics. Changes synchronize with the original account/child/spouse data, preserving permanent IDs. Gabbaim can override a child's classification, including moving a son from `דור ב` to `דור ב-נשוי`; that also updates marriage in the family profile. Members cannot grant themselves membership or admin roles.

The publishing screen sends text announcements in the existing categories or a weekly PDF schedule, selected through the phone's file picker (up to 10 MiB). The file appears as an authenticated attachment in members' feeds with an open/save/share action. Notifications use the existing preference-aware push queue; real phone delivery still requires configured APNs/FCM/Expo credentials. PDFs and private records stay in SQLite, outside Git.

Morning aliyah entry chooses the date and reading, then a roster person or unnamed `אורח` for every slot. Ordinary Shabbat requires seven regular aliyot plus Maftir and permits extras. Weekday festivals require five plus Maftir; weekday Yom Kippur requires six plus Maftir. Festivals on Shabbat use seven plus Maftir and do not permit extras. The form enforces tribe-specific choices and complete records; corrections replace a service atomically. Guests do not affect member statistics. See [server/API.md](server/API.md) for the legacy-import distinction and exact contracts.

The new native modules are `expo-document-picker`, `expo-file-system` and `expo-sharing`; after `npm ci`, rebuild locally using `npm run ios` / `npm run android`. Both local native builds have passed, along with 56 app tests, 113 server tests, TypeScript, all-platform Metro export and all 21 Expo Doctor checks. Android UI checks verified editing, publishing, the complete aliyah form, PDF selection/upload and the native share sheet; recipient download matched the original PDF bytes. Event/seat-summary administration, Mincha entry UI and broader household/account linking remain future work.

## Phone sign-in and association membership

Sign-in now uses an Israeli mobile number and a six-digit SMS code. Verified numbers on the server's imported association list receive `א` access; other new users register as `קבוע`. Users then complete their personal/family details. They cannot select their own classification. The gabbai edits classifications through the directory, and those decisions survive future imports and sign-ins. The former **מתפללים חדשים לסיווג** card, review screen and classification push alerts have been removed. Only `א` household heads report family seats; their seat quota still requires a gabbai setting.

Prepare an Excel `.xlsx` file using [the blank membership template](server/association-members-template.xlsx), with **שם פרטי**, **שם משפחה**, **פלאפון** columns. `שם מלא` + `פלאפון` is also accepted without guessing name order. Under **כלי הגבאי → רשימת חברי העמותה — טעינת אקסל**, select the file and upload it to the server. Imports validate all rows before saving, normalize equivalent Israeli phone formats, reject duplicate phone numbers and add/update the list without deleting existing members or overriding gabbai decisions. Maximum 5 MiB / 10,000 rows. The list and its uploader/timestamps persist in the private SQLite database; no real membership file is bundled with the project.

The import is also available locally:

```sh
.venv/bin/python -m server.manage import-members --author-email gabbai@example.com --file /path/to/members.xlsx
```

SMS delivery is configurable and **not yet connected to a real provider**. The supplied adapter supports [Twilio's Messages API](https://www.twilio.com/docs/messaging/api/message-resource); another provider can be added in `server/sms.py`. Copy `server/.env.example` to ignored `server/.env.local`, set the provider credentials and a persistent random `SHUL_OTP_SECRET` (at least 32 characters), and export those server-only values in the shell running the API:

```sh
set -a
source server/.env.local
set +a
.venv/bin/python -m server.app --host 0.0.0.0 --port 8000
```

No SMS is sent without configuration. Missing configuration returns a clear error; there is no production fixed-code/bypass mode. Codes expire after five minutes, can be used once, allow five wrong attempts and have persisted send/verify limits. The login phone is locked after verification; editing contact details cannot claim another membership. SMS transport tests use an injected fake sender, not real delivery. See [server/API.md](server/API.md) for exact behavior and deployment limits.

Before an **existing account** first signs in by phone, a trusted server operator must explicitly link its number. This keeps its permanent account/person IDs, family, classifications and aliyah history. Do this for the CLI-provisioned gabbai too:

```sh
.venv/bin/python -m server.manage link-phone --email gabbai@example.com --phone 0501234567
```

The app exposes only phone sign-in. Old editable profile phone fields are never used to claim existing accounts automatically; link existing accounts before rollout. Account/phone conflicts are rejected instead of merging people. Existing sessions remain valid. Unlinked legacy email/password authentication is retained only for migration; linked accounts require SMS. New public email registration returns 410. Self-service number changes and account merging are future work.

## Family seating reports

The Home card `עדכון מקומות לשבת` opens the upcoming Shabbat/selected holiday, with the parasha/date and the gabbai-controlled men's-section allocation. Only the **two prayer-specific questions** appear, with dropdowns for Arvit and Shacharit; there is no additional general question. Both run from zero to the allocated count and are saved together. An unknown quota directs the household to the gabbai.

For ordinary events the numbers are seats **not** needed (`לא` stays bold/red); absence of a report retains all seats at each prayer. Special events ask for seats actually needed, including explicit zero; no report retains none. The event mode is set by the gabbai. The family can update both counts while reporting is open. Changed allocation/event meaning requires a fresh report.

Only current-event reports are kept. They remain available throughout the event date even after reporting closes, and are deleted after it passes (for Shabbat: Sunday 00:00 Israel, checked every minute and on startup/access). Selecting another event also clears previous reports. Past event configurations are deleted; future queued configuration can remain. **No seating history is stored; aliyah history is retained separately.** Old single-number seat reports are cleared on upgrade instead of being copied into both prayers.

The gabbai API exposes separate Arvit/Shacharit counts and totals, allocation settings, event selection and deadlines. Default weekly events calculate the Israeli parasha offline; known special Shabbat dates require active reporting. Weekday holidays/evening Megillah and additional special events must be scheduled/selected by the gabbai. Membership review, quota editing and morning aliyah UI are implemented; event/summary management remains future work. See [server/API.md](server/API.md).

Validation: 50 app tests, 81 server tests, TypeScript and iOS/Android/web Metro exports pass. Android verified two independent counts and restart persistence against a disposable local API, and confirmed that `קבוע` has no seating option. Android also verified self-registration, personal-detail saving and gabbai approval before the seating option appears. Special-service Android checks required both choices and saved explicit zero independently. Screenshots: `.expo/seating-dual-services.png` and `.expo/seating-dual-special.png`. Physical push delivery remains unverified.

## Mi Sheberach for the sick

The new `מי שברך` tab lets each member add prayer names using `השם ושם האם`, view their previously added names with Gregorian addition dates, and delete their own entries after confirmation. Names persist across app restarts; successful server deletion removes the database row. Other members' requests are not shown in this screen.

The server's new `healing_prayers` table records the adding member's stable ID, requested name and Gregorian addition date, plus an entry ID for deletion. Identity/date come from the server. A gabbai-only endpoint provides the combined list with member names. Demo mode stores names locally and does not upload them. See [server/API.md](server/API.md) for the complete contract and ownership checks.

## Separate first name and surname

The member form now requires separate first-name and surname inputs. Multiword names remain intact within each field. The combined display name is derived from them, and the home greeting uses the entered first name. The server stores the parts in the profile and syncs them to the existing roster columns without changing IDs or aliyah history.

Older full names remain intact as a read-only reference until the user fills both fields. Already-known separate roster names may populate legacy profiles; no name is split automatically. Older clients cannot overwrite known name parts by sending a differently ordered full name. See `server/API.md` for the compatibility contract.

## Hebrew birthdays and local calendar libraries — October 25, 2026

Member and child birthdays use three dropdowns: Hebrew year, month and day. The year list runs from 5700 (ת״ש) to the current Hebrew year and updates as the year advances. A common year offers ordinary Adar; a leap year offers Adar I and Adar II. Cheshvan and Kislev day limits come from the selected year's actual calendar. Changing year/month clears impossible selections instead of silently changing the birthday. Future birthdays are rejected by both the app and server.

New data is `hebrewBirthDate: {day, month, year}` with a numeric year and predefined month key. Existing Gregorian dates and yearless Hebrew birthdays remain intact; no year or sunset-based conversion is guessed. New or edited Hebrew birthdays require all three fields. Older clients cannot erase an already saved year by sending only the unchanged day/month. A yearless birthday never triggers automatic bar-mitzvah eligibility.

Calendar calculations run locally and offline using [@hebcal/hdate](https://hebcal.github.io/api/hdate/index.html) in the app and [pyluach 2.3.0](https://pyluach.readthedocs.io/en/latest/dates.html) in the server. Python now needs the project virtual environment; this replaces the earlier standard-library-only server setup:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r server/requirements.txt
npm ci
```

Calendar month shapes are cross-checked between the two libraries for 101 Hebrew years. Android UI checks verified the 5700 lower limit, common/leap Adar choices and clearing Cheshvan 30 when switching from 5783 to 5784; screenshot: `.expo/birth-year-screen.png`. No temporary birthday was saved. The existing ARM64 Android development client and iOS build continue to run through local Metro; no cloud compilation is used.

## מה נכתב

- מסך בית עם שבעת זמני היום בפתח תקווה, הדגשת הזמן הבא, תאריך עברי ולועזי ופרשת השבוע.
- זמני כניסת שבת בפתח תקווה ובתל אביב, המופיעים גם מראש ובולטים ביום שישי.
- עריכת שם מלא, מספר הפלאפון של המתפלל ושל אשתו, שם לעלייה לתורה, שם האישה למי שברך, פרשת בר המצווה ותאריך לידה עברי בבחירת יום וחודש.
- הוספת בנים ובנות עם שם ותאריך לידה; לבנים גם שם לעלייה לתורה, פרשה ותאריך שבת בר המצווה. לילדים נשואים אפשר להוסיף שם בן/בת זוג ושם מתאים לעלייה לתורה או למי שברך.
- רשומת אדם נפרדת עם מזהה קבוע לכל ילד כבר מההוספה, מקושרת לחשבון ההורה. כך לבן שהגיע לגיל בר מצווה כבר יש זהות נפרדת למעקב עתידי אחר עליות. לא נוצר לילד חשבון כניסה. מעקב העליות ממומש כעת בשרת, ללא ממשק גבאים.
- הוספת כמה ימי זיכרון לכל אחת משש הקרבות: אב, אם, בן, בת, אח ואחות. נשמרים שם הנפטר/ת, יום וחודש עבריים ושנת פטירה אופציונלית, עם הבחנה בין אדר, אדר א׳ ואדר ב׳.
- לוח הודעות עם חיפוש, סינון לפי סוג, הודעות נעוצות וסימון קריאה אישי.
- תגובות טקסט להודעות מזל טוב ותנחומים. כל חברי הקהילה יכולים לקרוא אותן; אי אפשר לפרסם תגובות ללו״ז ולאירועים.
- ארבע העדפות התראה: לו״ז, מזל טוב/תנחומים, תגובות ואירועים. כיבוי התראה אינו מסתיר הודעות מהלוח.
- הרשמה עצמאית וכניסה, סיווג חברות על ידי הגבאי בלבד, הפרדת הרשאות ושמירת Session ב־SecureStore בטלפון.
- קריאת הודעות מהשרת עם פתיחת האפליקציה, חזרה לרקע הקדמי, רענון ידני ובכל 30 שניות כשהאפליקציה פעילה.
- תשתית רישום וקבלת Push, פתיחת ההודעה מתוך התראה, ותור משלוח בשרת שמכבד את העדפות המשתמש.

## מצב הבדיקות במחשב הקודם — תיעוד ההעברה

24 בדיקות שרת ו־16 בדיקות לקוד התאריכים ופרטי המשפחה הורצו בהצלחה. בדיקות השרת מפעילות את מנתח בקשות HTTP והנתיבים בפועל בזיכרון ואת מסד SQLite בתיקיות זמניות, בלי צורך ברשת. הן כוללות שדרוג נתונים ישנים, שמירת רשומה נפרדת לכל ילד, שמירה על המזהה בעדכון ובהסרה, פרטי זוגיות, מספרי טלפון ומניעת עריכה בין משפחות. משלוחי Push מוחלפים בשירות בדיקה. בדיקות האפליקציה מכסות גם את שעון ישראל ומעבר שעון חורף, תאריכי לידה ויארצייט, בחירת יום שישי, פרמטרי הבקשות למקור הזמנים ודחיית זמנים מתאריך אחר. התשובות מהמקור מוחלפות בנתוני בדיקה; אין בכך אימות של החיבור החי או בדיקה חזותית של מסכי הטלפון.

ב־25 באוקטובר 2026 הותקנו Node.js 24.22.1 ו־npm 11.19.1 באמצעות Homebrew, באישור המשתמש. כלי הפיתוח זמינים בטרמינל. הורדת חבילות הפרויקט ממאגר npm נתקלה תחילה ב־timeout; בניסיון נוסף מהרשת הביתית התקבל HTTP 403 עם דף חסימה של Symantec. לכן עדיין לא הושלמו התקנת החבילות ויצירת קובץ נעילה, ולא הורצו TypeScript, Metro, Expo Doctor או בדיקות מכשיר. קוד האפליקציה טרם נבנה או נבדק חזותית בטלפון. גרסאות החבילות הותאמו לרשימת התאימות הרשמית של Expo SDK 57. אין עדיין התקנה מוכנה ל־App Store או ל־Google Play.

### סביבת Apple במחשב הקודם

בהתאם להפניה לפרויקט `../Hoshanot`, נקראו ה־README שלו ומסמכי Claude ב־`~/.claude/skills/hoshanot-watch-app/`. שם המימוש הוא SwiftUI מקורי עם פרויקט Xcode, בנייה באמצעות `xcodebuild`, חתימה אוטומטית וארכוב להפצה. בבדיקה מקומית ב־25 באוקטובר 2026 נמצאו Xcode 27.0, Swift 6.4 וערכות SDK ל־iOS 27 ולסימולטור iOS 27. נוכחות SDK אינה הוכחה שקיים runtime מותקן או שניתן להריץ סימולטור או מכשיר חתום.

מסלול Expo הנוכחי משתמש ב־Node.js שהותקן ובכלי Xcode לבניית iOS מקומית; הוא אינו מחייב בנייה בענן של Expo. אפשר לחלופין לממש את גרסת Apple ב־SwiftUI ולהשתמש בכלי Xcode שכבר מותקנים. שינוי כזה מחייב מימוש ממשק iOS מקורי ותכנון נפרד להמשך התמיכה באנדרואיד; הוא עדיין לא בוצע. השרת ומבנה הנתונים הקיימים יכולים לשרת את שני המסלולים.

פרטי ההטמעה של אפליקציית Watch בתוך אפליקציית iPhone ב־Hoshanot מיוחדים לפרויקט ההוא. אין להעתיק לכאן את יעד ה־Watch, מזהי החבילה שלו או הגדרות הרקע שלו. לא בוצעו שינויים בפרויקט Hoshanot, רישום מזהה אפליקציה, חתימה או העלאה ל־TestFlight במהלך בדיקה זו.

## הכנה לבנייה מקומית

דרישות: Node.js 24 LTS ו־npm. [התקנת Node.js](https://nodejs.org/) ו[מדריך Expo](https://docs.expo.dev/get-started/create-a-project/).

ל־iOS נדרשים Xcode, ערכת הפיתוח של iOS ו־CocoaPods. להפעלה בסימולטור נדרש גם iOS Simulator Runtime מותקן ב־Xcode. להתקנה באייפון נדרשים הגדרות חתימה ו־Developer Mode בהתאם למכשיר. לאנדרואיד נדרשים Java, ‏Android SDK עם platform ו־build tools התואמים לפרויקט Gradle שנוצר, ו־platform-tools. אפשר להתקין ולנהל אותם באמצעות Android Studio ולהגדיר `ANDROID_HOME` למיקום ה־SDK. להפעלה באמולטור נדרשים גם Emulator ו־system image.

ב־25 באוקטובר 2026 הותקנה מקומית סביבת הסימולטור iOS 27.0 ‏(24A434), ונוצרו דגמי iPhone לשימוש דרך Xcode Simulator. לאחר פתרון הגישה ל־npm והתקנת החבילות אפשר לבחור במפורש את הדגם עם `npm run ios -- --device "iPhone 18 Pro"`. התקנת הסימולטור ו־CocoaPods הושלמה, אך אפליקציית Expo עצמה עדיין לא נבנתה ולא הותקנה בו.

בדיקת הכלים בלי להתקין או לשנות דבר:

```sh
python3 tools/check_local_build.py
```

אפשר לבדוק פלטפורמה אחת עם `--platform ios` או `--platform android`. לאחר התקנת npm אפשר גם להריץ `npm run check:local`. בבדיקה במחשב הנוכחי נמצאו Node.js, ‏npm, ‏Xcode, ‏iOS SDK ו־Java 17. CocoaPods 1.17.0 הותקן לצורך ההרצה בסימולטור iPhone. עדיין חסרים Android SDK וחבילות הפרויקט. ההיעדרויות מודפסות בבדיקה וקוד היציאה הוא 1 עד להשלמתן.

בבדיקת תקלת npm נמצא שהשם `registry.npmjs.org` נפתר לכתובת loopback ‏`127.0.0.3`, והחיבור אליו נכשל. גם מאגרי Yarn ו־npmmirror לא הגיבו, בעוד שהורדות מ־Apple, ‏GitHub ו־jsDelivr הצליחו. נדרשת בדיקת הגדרות DNS, ‏proxy, ‏VPN או סינון רשת; לא בוצע שינוי בהגדרות הרשת של המחשב.

נקודת המשך מעודכנת מ־25 באוקטובר 2026: המשתמש חזר לרשת הביתית ונוסתה שוב התקנת npm. ה־DNS של המאגר כעת מחזיר כתובות ציבוריות תקינות, אבל כל בקשות החבילות ל־npm ול־Yarn קיבלו HTTP 403. דף החסימה מזהה Symantec, עם `policy_denied`, ומציין שמדיניות המערכת מונעת גישה. בדיקת `scutil --nc list` הראתה חיבורי VPN מנותקים; נראה שסינון האינטרנט פועל גם מחוץ לחיבור ה־VPN. נדרשת פתיחת גישה מאושרת ל־`registry.npmjs.org` או כתובת של מאגר npm ארגוני מאושר, ואז אפשר להתקין חבילות, להריץ TypeScript ולבנות מקומית. לא שונו הגדרות VPN, ‏DNS או תוכנת האבטחה.

איתור חלון הסימולטור הושלם: ב־Xcode 27 האפליקציה היא Device Hub בנתיב `/Applications/Xcode.app/Contents/Applications/DeviceHub.app`, במקום `Simulator.app`. היא נפתחה בהצלחה בניסיון ההמשך. אפשר לפתוח אותה ב־`open -a /Applications/Xcode.app/Contents/Applications/DeviceHub.app`; שירותי `simctl` וה־runtime של iOS 27 מותקנים. ה־iPhone הנבחר הוא iPhone 18 Pro, עם המזהה המקומי `47A2AA83-0BDA-45CC-BFBC-46B70A25F0E1`. אין עדיין בינארי בנוי או צילום של אפליקציית הקהילה בסימולטור. ראו [הנחיות הסימולטור המעודכנות של Expo](https://docs.expo.dev/workflow/ios-simulator/).

התקנת חבילות ובדיקת קוד, מתוך תיקיית הפרויקט:

```sh
npm install
npx expo install --check
npm run typecheck
npx expo-doctor
```

## בנייה והרצה מקומית

```sh
# Compile locally and run on an iOS simulator
npm run ios
```

```sh
# Compile locally and run on an Android emulator or connected device
npm run android
```

הפקודות הן `expo run:ios` ו־`expo run:android`. בהרצה הראשונה הן מייצרות את פרויקטי `ios/` ו־`android/` החסרים, מקמפלות במחשב ומפעילות את Metro המקומי. לא נדרשת התחברות לחשבון Expo לבנייה זו. אפשר לבחור מכשיר באמצעות `npm run ios:device` או `npm run android:device`.

לאחר בנייה והתקנה ראשונות, עבור שינויי TypeScript בלבד, מפעילים `npm start`. זו הפעלה של `expo start --dev-client --lan`: האפליקציה המותקנת מתחברת למחשב באותה רשת מקומית. שינויים בתלויות native או בהגדרות דורשים עדכון הפרויקט עם `npm run prebuild` ובנייה מחדש. אין להריץ `prebuild --clean` על שינויים ידניים שלא נשמרו, משום שהוא מוחק את התיקיות שנוצרו.

לפתיחת הפרויקטים בכלי הפיתוח לפני בנייה, הריצו `npm run prebuild`. לאחר מכן פתחו ב־Xcode את קובץ ה־`.xcworkspace` שנוצר בתוך `ios/`, או פתחו את תיקיית `android/` ב־Android Studio. פרויקטי native נוצרים מקומית ומוחרגים כרגע מ־Git; שינויים קבועים מוגדרים ב־`app.config.ts` וב־config plugins.

לצפייה מקומית בדפדפן אפשר להריץ `npm run web`. מסלול הטלפון הראשי הוא גרסת פיתוח שנבנית ומותקנת מקומית.

ללא `EXPO_PUBLIC_API_URL` האפליקציה עולה במצב **הדגמה**, המסומן בממשק. השמות וההודעות בו בדויים. פרטי החבר, התגובות וההעדפות נשמרים במכשיר בלבד. זמני היום מבוקשים מהמקור האמיתי גם בהדגמה; אין הצגת זמני דמה במקרה של תקלה.

## גרסת Release וארכוב מקומיים

`npm run ios:release` ו־`npm run android:release` מבצעות בניית Release מקומית לבדיקה. הן אינן מחליפות הגדרת חתימה וארכוב להפצה.

להפצת iOS משתמשים ב־Xcode: בוחרים Team ב־Signing & Capabilities, יעד מכשיר כללי ואז Product → Archive. אפשר לספק מראש `APPLE_DEVELOPMENT_TEAM` ב־`.env`; אין צורך ב־Team לבניית סימולטור. לפני רישום או הפצה יש לבחור מזהה חבילה שבבעלות הקהילה במקום המזהה הראשוני שב־`app.config.ts`. ה־Archive נוצר במחשב. הפצה באמצעות App Store Connect או TestFlight היא שלב נפרד לאחר הבנייה.

להפצת Android מגדירים upload key וחתימת Release מקומיים ב־Gradle/Android Studio. לאחר הגדרת החתימה מריצים מתוך תיקיית `android/` את `./gradlew app:bundleRelease`, או משתמשים באשף Generate Signed Bundle / APK ב־Android Studio. זו יצירת AAB מקומית; פרסום בחנות הוא שלב נפרד. מפתחות חתימה וסיסמאות נשמרים מחוץ לבקרת הגרסאות.

ראו [בנייה מקומית לפיתוח](https://docs.expo.dev/guides/local-app-development/) ו[בנייה מקומית להפצה](https://docs.expo.dev/guides/local-app-production/) בתיעוד Expo.

## חיבור לשרת

השרת דורש Python 3.11 ומעלה וסביבת ‎.venv עם התלויות שב־server/requirements.txt, כמפורט למעלה. בכל הדוגמאות יש להריץ מהתיקייה הראשית של הפרויקט.

יצירת חשבונות מקומיים, ללא סיסמאות ברירת מחדל וללא הצגת סיסמה בשורת הפקודה:

```sh
.venv/bin/python -m server.manage create-user --email member@example.com --name "ישראל ישראלי"
.venv/bin/python -m server.manage create-user --email gabbai@example.com --name "גבאי הקהילה" --role gabbai
```

פקודות יצירת החשבון יבקשו סיסמה ואימות שלה, באורך 12–128 תווים. הן מיועדות בעיקר ליצירת הגבאי או להעברת חשבונות קיימים; הרשמת מתפללים חדשים מתבצעת במספר פלאפון וקוד SMS. יש לקשר מספר מאומת לחשבון הגבאי לפי הסעיף לעיל לפני כניסה באפליקציה.

```sh
.venv/bin/python -m server.app --host 0.0.0.0 --port 8000
```

העתיקו את `.env.example` ל־`.env` והגדירו:

```dotenv
EXPO_PUBLIC_API_URL=http://192.168.1.100:8000
EXPO_PUBLIC_COMMUNITY_NAME=שם בית הכנסת
```

החליפו את כתובת ה־IP בכתובת המחשב ברשת הביתית. הטלפון והמחשב צריכים להיות באותה רשת; `localhost` בטלפון מתייחס לטלפון עצמו. הפעילו מחדש את Metro לאחר שינוי משתני הסביבה. בחלק מהתקנות iOS/Android בקשות HTTP לא מוצפנות נחסמות; בגרסה מותקנת יש להשתמש בשרת עם HTTPS. אין כאן פתיחה גורפת של מדיניות HTTP במכשיר.

בדפדפן באותו מחשב אפשר להשתמש ב־`http://localhost:8000`. מקורות הדפדפן המותרים מוגדרים ב־`SHUL_CORS_ORIGINS` כרשימה מופרדת בפסיקים; ברירת המחדל כוללת `http://localhost:8081` ו־`http://localhost:19006`.

אפשר לפרסם הודעת בדיקה מקומית כדי לבחון קבלה ותגובה לפני בניית אפליקציית הגבאים:

```sh
.venv/bin/python -m server.manage publish --author-email gabbai@example.com --file server/example-message.json
```

איפוס סיסמה מבטל גם את כל הכניסות ואסימוני ההתראות של אותו חשבון:

```sh
.venv/bin/python -m server.manage reset-password --email member@example.com
```

מסד הנתונים נוצר ב־`server/data/community.sqlite3` ומוחרג מ־Git. אפשר לבחור מיקום אחר באמצעות `SHUL_DB`, או `--db` בכל פקודת שרת. משתמשים אמיתיים ונתוני ההדגמה נמצאים במסלולים נפרדים; אין העתקה אוטומטית של נתוני הדגמה לשרת.

## Server roster and aliyah history

The backend now maintains `roster_people`, `aliyah_services` and `aliyah_calls`. A son's thirteenth Hebrew birthday activates his roster entry automatically while keeping his existing permanent person ID. The running server checks every minute and also refreshes at startup and during profile/roster activity. Birthdays without a year do not establish eligibility. Records and history survive archival and birthday corrections.

Kohen/Levi aliyah counts cover the preceding **6 Gregorian calendar months**; Yisrael counts cover **12**. They roll daily without a calendar-year reset. The latest aliyah is derived from all recorded history, rendered as Hebrew date plus the recorded Torah reading; absent history displays `לא נמצא`. Service corrections are atomic and cannot double-count duplicate records. Cancelled services remain recorded but do not count.

The gabbai-only API supports the roster, separate first/surnames, the requested classifications, independent regular attendees/sons-in-law and service history. Existing full names are not guessed into separate names. A linked family profile remains authoritative for its personal fields. The roster and statistics are implemented in the server; the directory/editor and morning aliyah UI are implemented; broader account linking remains future work. See [server/API.md](server/API.md) for the schema, date conventions, complete requests and authorization.

## Kohen, Levi or Yisrael

The profile form now requires a dropdown selection of כהן, לוי or ישראל immediately after the member's name. Sons display the father's current selection automatically and have no separate selector. Each married daughter's husband has an independent required dropdown immediately after his name. Turning off marriage or changing the child to a son clears that spouse selection.

Legacy profiles begin with an unselected status; the app does not guess from a surname or default to Yisrael. The user must choose the applicable values when saving. Member `tribe` and child `spouseTribe` are validated by the app and server and saved in demo storage or SQLite. Older clients that omit these fields preserve known values. SQLite upgrades add columns without changing permanent person IDs or archival state; sons resolve their father's status through the existing family link. See `server/API.md` for the contract and migration details.

## זמני היום והשבת

For **Petah Tikva on October 25, 2026**, the app uses the complete Yeshiva daily table supplied by Noam. It is a dated transcription, explicitly identified on screen, and works without a live request:

| Time | Supplied Yeshiva table | Calculated Hebcal fallback |
| --- | --- | --- |
| Sunrise | 05:51 | 05:52 |
| Latest Shema (Gra) | 08:37 | 08:37 |
| Latest prayer (Gra) | 09:33 | 09:33 |
| Earliest Mincha | 11:54 | 11:55 |
| Plag Hamincha | 15:49 | 15:48 |
| Sunset | 16:57 | 16:57 |
| Nightfall | 17:16 | 17:16 |

**Automatic exact matching remains unresolved.** The transcription applies only to this date and city; it is not an adjustment to the calculation for other days. For dates without a supplied table, the app applies [Yeshiva's published calendar rules](https://www.yeshiva.org.il/calendar/timeprinciples) to second-precision data from the [Hebcal Zmanim API](https://www.hebcal.com/home/1663/zmanim-halachic-times-api). Petah Tikva coordinates remain `32.0878,34.8878`; Tel Aviv remains `32.0809,34.7806`. Time calculations and date checks use `Asia/Jerusalem`. The fallback in `src/zmanim.ts` uses:

- Nightfall: sea-level sunset plus 18 ordinary minutes on short days, or 18 seasonal minutes on days longer than 12 hours, rounded upward. This replaces both previous degree-based nightfall selections.
- Earliest Mincha: solar noon plus the greater of 30 ordinary minutes and half a seasonal hour, rounded upward.
- Latest Shema and latest prayer (Gra): rounded downward from second-precision values.
- Sunrise and Plag Hamincha: rounded upward; sunset: rounded downward.
- Friday candle lighting: 40 minutes before sunset in Petah Tikva and 21 minutes in Tel Aviv, rounded downward. Friday sunsets are fetched with seconds; the weekly parasha still comes from the Hebcal Shabbat API. A matching Friday candle event is required to reject stale weekly metadata.

The comparison above confirms that the fallback is not identical to Yeshiva. Rounding alone cannot explain the Plag difference: raw Hebcal is 15:47:52. Yeshiva uses its own astronomical engine and city coordinates/elevation; its public city tables and embedding widget returned Cloudflare challenges to automated requests. An accessible authoritative feed/export is needed for exact automatic matching on other dates. Do not infer year-round accuracy from this single table, guess city elevation, or add per-field offsets to fit it. Sunrise/sunset elevation and Friday candle minutes remain unverified against Yeshiva.

The daily cache uses `shul.zmanim.yeshiva-rules.v2`. It validates the current Israel date, all seven times and the expected source. Where a supplied table exists, a calculated copy or altered table is rejected. Prior namespaces are not reused. On other dates, missing or invalid astronomy is an error; no invented times are substituted. The screen identifies copied daily tables separately from calculated times and shows the possible-difference notice for the latter. Tests cover the seven supplied values, offline access to the transcription, provenance and rejection of date/year carryover.

תאריך הלידה נבחר כעברי בשלוש רשימות של שנה, חודש ויום, ללא הקלדה חופשית. נתוני לידה לועזיים קודמים נשמרים לתאימות ולא מומרים אוטומטית. תאריכי יארצייט נבחרים בחודש עברי וביום עברי מרשימה (א׳–ל׳), ללא שדה שנה. שנים שנשמרו בעבר נשמרות לתאימות ואינן מוצגות בטופס. התאריך העברי בכותרת הוא של היום האזרחי ואינו מתחלף בשקיעה. אין בשלב זה חישוב תזכורות יארצייט שנתיות או הכרעה במנהגי אדר וחודשים חסרים.

פרטי הילדים נשמרים ברשומות נפרדות כבר בעת ההוספה, בלי להמתין לחישוב גיל. שם הבן לעלייה לתורה ופרטי שבת בר המצווה הם שדות רשות, גם כשהתאריך כבר ידוע מראש. תאריך שבת בר המצווה אינו משמש לקביעת הגיל ההלכתי. הסרה מהמשפחה מעבירה את הרשומה לארכיון ואינה מוחקת את המזהה שנוכל לקשר אליו בעתיד את היסטוריית העליות. מסד המתפללים ומעקב העליות מתועדים בסעיף השרת וב־server/API.md; ממשק הגבאים עדיין עתידי.

## Push בטלפון — נפרד ממקום הבנייה

הצגת הודעות בתוך האפליקציה פועלת גם ללא Push. הבנייה המקומית אינה דורשת חשבון Expo או פרויקט EAS. במימוש הנוכחי, האפשרות הנפרדת לקבלת התראות מרוחקות משתמשת ב־Expo Push Service ולכן דורשת מזהה פרויקט Expo והגדרת APNs ב־Apple ו־FCM ב־Firebase. מזהה הפרויקט הוא לצורך רישום אסימון ההתראות, ולא לצורך בניית האפליקציה.

אפשר להשאיר את `EXPO_PUBLIC_EAS_PROJECT_ID` ריק בפיתוח המקומי; ההודעות והרענון מתוך האפליקציה ממשיכים לעבוד, והפעלת Push מציגה הודעה שהשירות עדיין לא הוגדר.

כשמגדירים התראות מרוחקות, משתמשים בגרסה שנבנתה מקומית ב־`npm run ios:device` או `npm run android:device`. ב־iOS מגדירים Team ויכולת Push Notifications ב־Xcode ובחשבון Apple. לאנדרואיד אפשר להפנות את `GOOGLE_SERVICES_JSON` לקובץ `google-services.json` מקומי. בנוסף נדרשת הגדרת אישורי המשלוח אצל ספק ההתראות; קובץ Firebase באפליקציה לבדו אינו מספיק. היכנסו באפליקציה ועברו להעדפות להפעלת התראות במכשיר.

להפעלת עובד המשלוח בשרת משתמשים ב־`SHUL_ENABLE_PUSH=1 .venv/bin/python -m server.app`. אם אבטחת Expo Push מופעלת, מגדירים בשרת גם `EXPO_ACCESS_TOKEN`. שירותי המשלוח הם שירותי רשת; הבנייה נשארת במחשב.

אם נבחר בעתיד לשלוח ישירות דרך APNs ו־FCM ללא מתווך Expo, אפשר להשתמש באותה ספריית התראות בצד האפליקציה, אבל צריך לשנות גם את רישום האסימונים וגם את שרת המשלוח. מסלול זה טרם מומש. ראו [Expo Notifications ללא תלות בספק המשלוח](https://docs.expo.dev/push-notifications/sending-notifications-custom/).

התור נשמר ב־SQLite, מבצע עד חמישה ניסיונות במרווחים גדלים, בודק שוב את ההעדפות בזמן המשלוח ומסיר אסימונים שסומנו `DeviceNotRegistered`. תגובה מפעילה התראה למחבר ההודעה ולמשתתפים קודמים בשיחה, למעט המגיב עצמו. התראות כוללות טקסט כללי ומזהה הודעה; פרטי חברים ותוכן ההודעות אינם נשלחים ל־Expo.

זהו עובד תור ראשוני לתהליך שרת יחיד. `accepted` מציין קבלה ב־Expo, לא הגעה לטלפון. טיפול ב־delivery receipts, ריבוי workers וביטול כפילויות לאחר כשל חלקי נותרו לשלב ההקשחה. אם Push כבוי, התור נשמר אך לא נשלח. ההתחברות באפליקציה אינה מפעילה את ההרשאה בלי לחיצה מפורשת בהעדפות.

## בדיקות והמשך

אחרי npm ci, מריצים את בדיקות התאריכים, פרטי המשפחה ומקור הזמנים ב־Node.js 24:

```sh
npm test
```

בדיקות השרת:

```sh
.venv/bin/python -m unittest discover -s server/tests -v
```

אחרי התקנת סביבת JavaScript יש להריץ את בדיקות התאימות ו־TypeScript המפורטות למעלה ולבדוק בשני מכשירים: שמירת פרטים, מעבר בין מסכים בלי אובדן טיוטה, כניסה מחדש, תגובה להודעה מחשבון אחר, כיבוי התראות, פתיחת הודעה מתוך Push, ניתוק רשת ומעבר יום לפי שעון ישראל.

השרת המצורף מיועד לפיתוח ולפיילוט. לפני הפעלה לקהילה נדרש אירוח עם HTTPS, גיבוי למסד ובדיקת Push מקצה לקצה. חסרים עדיין ממשק ניהול גבאים, תהליכי הצטרפות ושחזור סיסמה עצמאיים, עריכה/מחיקת הודעות ותגובות, ותזכורות אישיות. תיעוד הנתיבים נמצא ב־[server/API.md](server/API.md).

התאימות לחבילות נבדקה מול [רשימת החבילות הרשמית של Expo SDK 57](https://github.com/expo/expo/blob/sdk-57/packages/expo/bundledNativeModules.json) ו[תבנית TypeScript הרשמית](https://github.com/expo/expo/blob/sdk-57/templates/expo-template-blank-typescript/package.json).
