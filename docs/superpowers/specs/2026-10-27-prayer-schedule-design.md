# Prayer schedule, formulas and the weekly sheet — design

Owner, 2026-10-27: "where do a Gabay edit the times of the prayers of the week? for years we have this
template (BeforeShabat.jpeg — kept out of git: real names and the Kehila logo) … the main times of
petach-tikva is cool but not the main part — maybe it can be a collapsable card? … allowing all the items
it holds? maybe changing templates in the future?" and: "maybe a web visualizer for templates — start
with this one — a web for pc editing that is easier but it shows how it will be seen on mobile? the
sections are set automatically by a formula … = zman shkiaa (or = zman shkia − 5 minutes; or = zman
shkia − 5 min round down to 5 min) … worth a design on its own and can run in parallel?"

## What the current sheet holds (the reference template)

Header: Kehila logo + "שבת פרשת <parasha>". Two columns:
- **Shabbat:** candle lighting for two cities (ירושלים / תל אביב), מנחה וקבלת שבת, דף יומי, שחרית,
  a free-text line (שיעורים לגברים, נשים וילדים לאחר התפילה), מנחה גדולה, מנחה וסעודה שלישית, צאת
  השבת, דף יומי.
- **Weekdays:** שחרית מניין א׳, שיעור דף יומי, שחרית מניין ב׳, מנחה גדולה, מנחה, ערבית, שיעור דף
  יומי, מניין ערבית ב׳.
- **Below:** mazal tov notices (free text with emphasised family names and a small icon each), and a
  notice image (e.g. "switching to winter time").

## 1. Data model (one per Kehila)

- **Schedule** = ordered **sections** (שבת, ימי חול; later חג, ראש חודש, תענית, ימים נוראים), each an
  ordered list of **rows**. A row: label (he/en), optional note (free text), and a **time** — or no time
  (a text-only row like the שיעורים line).
- **Time** is either fixed (`8:30`) or a **formula**:
  - anchor: a zman — alot hashachar, misheyakir, sunrise (netz), sof zman shma (GRA / MGA), sof zman
    tfila, chatzot, mincha gedola, mincha ketana, plag hamincha, sunset (shkia), candle lighting (city
    setting, e.g. 18/20/40 minutes), tzeit hakochavim (configurable degrees/minutes), Shabbat end;
  - which day the anchor is taken from: the row's own day, or Friday / Shabbat for Shabbat rows, or for
    a weekday row that shows one time for the whole week: the **earliest / latest** of Sun–Thu;
  - offset: ± minutes;
  - rounding: none / down / up / nearest, to 1, 5, 10 or 15 minutes;
  - optional bounds: not earlier than / not later than a fixed time.
  - Examples: `= shkia`, `= shkia − 5`, `= shkia − 5, round down to 5`, `= min(weekday shkia) − 15,
    round down to 5, not later than 18:30`.
- **Overrides:** "this week only" per row (a different time, hide, or an extra row), stored per week;
  the formula stays.
- **The Kehila's location** (city/coordinates, elevation choice, candle-lighting minutes) is a Kehila
  setting; the two candle-lighting cities on the sheet are a sheet setting.
- Calculation runs from one shared function (TypeScript, used by the app, the web editor and the sheet
  renderer; the server stores formulas, not results). Tests pin known dates (incl. DST switch weeks).

## 2. The web editor (PC first) with a live phone preview

- Gabbai-only screen on the web app, laid out for a desktop browser: **editor on one side, live
  preview on the other** — the preview toggles between "phone (Home card + full schedule)" and "sheet
  (A4 / WhatsApp image)". A week picker shows any week's computed result.
- Edit sections and rows (add, drag to reorder, rename), write the time as a formula with a friendly
  builder (anchor ▾, offset, rounding ▾, bounds) and show the computed time next to it for the chosen
  week. Mark "this week only" changes.
- Works on a phone too, but the PC layout is the target.

## 3. What members see

- **Home:** the Kehila's schedule is the main card. Thursday→Shabbat: "שבת פרשת X" with candle lighting,
  the **next** prayer highlighted with a countdown, and "full schedule". On weekdays: the next weekday
  prayer. The city zmanim (the current arc/grid) become a **collapsible card** below.
- **Full schedule** screen: sections as the template lays them out, this week's overrides applied.

## 3a. Two formats of the same data (owner, 2026-10-27)

"the zmanim shall be set into the app — and shall be allowed to be printed — print loads the times into a
page with kehila logo and format as the page i shared — so there are 2 formats for zmanim — the mobile
and the print". One schedule, two renderings:
- **Mobile** — the Home card and the full-schedule screen (§3), designed for the phone.
- **Print** — an A4 page in the template (§4): Kehila logo, "שבת פרשת X", the two columns, the week's
  notices. A **"הדפסה" / "Print"** action on the full-schedule screen, for everyone who can see the
  schedule (members and guests; guests' print leaves out mazal tov unless guests may see it). On the
  web it opens the print page and the browser's print dialog; on the phone it makes a PDF to print or
  share. The gabbai's editor shows the same page as its "sheet" preview.

## 4. The weekly sheet and templates

- The sheet is **generated**: parasha from the Hebrew calendar, times from the schedule, the week's
  **mazal tov** messages (the `celebration` type, those that may be shown publicly — follow the type
  rules: if guests can't see mazal tov, the shared sheet leaves them out unless the gabbai ticks them),
  and pinned notices/images chosen by the gabbai.
- **Share**: image (WhatsApp) and PDF (print) from the web editor.
- **Template** = presentation only (layout, fonts, colours, ornaments, logo slot); content never lives
  in a template. Start with one template modelled on the current sheet ("Classic two columns"); more
  templates later, switchable per Kehila or per week (e.g. a holiday template).
- The Kehila logo is uploaded by the gabbai (existing logo feature); it never enters git.

## Non-goals for the first version

Holiday calendars beyond Shabbat/weekday (sections exist, auto-detection later); per-day different
weekday times (one weekly time per row, via earliest/latest); a template designer UI (templates are
built by us).

## Open for the designer

Look of the formula builder, the editor/preview split, the Home card and collapsible zmanim card, the
full-schedule screen, the first template's look (fresh, but recognisable to the Kehila).
