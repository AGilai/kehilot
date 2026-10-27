# Seat release — reminder card, push link, and a clickable preview

Owner, 2026-10-27: "remember the free my chairs from Noam's app and my request for part of the block —
this message shall be sent timer based — it's a banner reminder or link to the actual page on the main
page — the notification also holds a link so both go to the page that releases the chairs — can you add
an emulation for that on my default card — even if the buttons do nothing for now — then we will link it
to the app? can be another agent on its own".

Background: Noam's app lets an א household head release seats for the coming Shabbat (UX M9 "מקומות
בשבת", gabbai GM5/GD5). The owner's earlier request (2026-10-26, "part of the block"): show the person's
seats inside a frame of ±2 rows around them, his own seats marked "needed" vs "freed", others' seats grey
without names, the frame covering split seats, pinch-to-zoom, never rely on red/green alone.

## This step: a preview, wired later

1. **Reminder card on Home** (the person's default screen), shown on a timer: from the gabbai's reminder
   time (default Thursday 12:00) until the release deadline (default Friday 12:00), only to those who
   hold seats (א household heads). Text like "השבת: יש לך 3 מקומות. מגיעים כולם?" with "עדכון מקומות"
   → the seat page, and "כולם מגיעים" (one tap = no change). After the deadline it disappears; after the
   person answered it shows a short confirmation until the deadline.
2. **Push** at the reminder time with the same wording; tapping it opens the same seat page
   (`data: {kehila, screen: 'seats'}` — the existing generic deep-link shape; no names).
3. **Seat page (M9) with "part of the block":** the person's seats inside a ±2-rows frame of the hall,
   own seats toggled needed/freed (shape + label, not colour alone), others grey and nameless, per prayer
   (ערבית / שחרית), deadline line, save.
4. **Preview now:** build items 1 and 3 as UI with fixture data, behind a preview flag, visible on the dev
   web app to everyone who opens it (labelled "תצוגה מקדימה"); buttons do nothing (or show a toast "בקרוב").
   The push in item 2 is only designed now (copy + target), not sent.
5. Later (not now): the server side — seat map per Kehila, allocations, the reminder schedule, the push,
   the gabbai summaries (GM5/GD5) — wired to this UI.

## Two formats (owner, 2026-10-27)

"the seats shall come in 2 formats — the member releasing — the gabbai map print from app or web — you
can use our synagogue layout — you can find a map on gabbai folder".
- **Member (phone):** the release flow above (card → seat page with his part of the block).
- **Gabbai map (print, from app or web):** the whole hall for the coming Shabbat, per prayer: each seat
  marked taken / released / free (shape + label, printable in black and white), counts per block, the
  bimah and ark drawn; A4 landscape print/PDF from the web and a PDF from the phone. Names on the print:
  the gabbai's own choice per print (default off) — the print may be posted in the hall.
- **The hall layout:** the Kehila's real hall shape, as drawn (shape only, no names) in
  `~/work/gabay/design/mockups/phase2-seat-map.html`: 5 blocks (שמאל, מרכז שמאל, מרכז, מרכז ימין, ימין),
  rows 0–13, the bimah in the middle block, about 205 seats. It becomes the first Kehila's seat map
  (data, configurable per Kehila later); never copy names from the Excel chart.

## Running beside the old method (owner, 2026-10-27)

"since we will run the system in parallel to the old method also — allow an upload responses format for
a shabbat release and allow a gabbai (regardless) release places on behalf of a person".
- **Upload responses:** the gabbai uploads, per Shabbat, a file with the answers collected the old way
  (CSV/Excel). One row per household: who (matched by name and/or phone, shown for confirmation —
  unmatched rows listed for manual matching), seats needed per prayer (ערבית / שחרית). A downloadable
  template defines the format; a preview shows what will change before applying; applying is undoable
  for that Shabbat. Answers already given in the app win unless the gabbai chooses the file's answer
  for that household. **Open:** the exact columns of the old method's output — ask the owner for a
  sample (with invented names) and align the template to it.
- **Gabbai on behalf of a person:** in the gabbai's seat screen (and the print map), any gabbai can set
  a household's needed / released seats for the coming Shabbat, regardless of the deadline. It is
  recorded as "updated by a gabbai" (visible to the gabbaim and to that household, without the gabbai's
  name to others) and the household sees the current state on its seat page.

Design through the designer (one look and feel): the card, the seat page with the block frame, the push copy.

## Per-Kehila hall layout and households without accounts (owner, 2026-10-27)

"each kehila should have its own synagogue place layout … the design that I've shared is specifically for
Neria … in the web designer, only on web, allow some kind of designer — like a table of places, like an
Excel — that a gabbai can describe the seats and what family sits where … not all the families will be
registered … the upload should cover also families that are not registered … both should be part of the
tests."

- **Hall layout per Kehila**, edited on the web only (phone: view): a spreadsheet-like grid — each cell a
  seat, aisle, bimah, ark or empty; blocks, rows, seat numbers; drag-select. **Paste from Excel** (the
  gabbai copies his existing seating chart): cell positions become seats, cell text becomes the household
  sitting there, matched with confirmation (nothing linked without the gabbai). Preview before save;
  common Excel quirks handled (merged cells, two names in a cell, blank aisle rows). The Neria hall is the
  first example, not a built-in.
- **Seat holders without an account**: a gabbai-created household record (name, optional phone) that
  holds seats, appears on the map, can be released on behalf, and is covered by the responses upload. When
  a matching family registers, the gabbai is offered a link (by phone/name); on confirm, seats move to the
  registered family.
- **Assignment history**: seat changes take effect from a date; past Shabbatot keep their state.
- **Privacy**: names on the map only for gabbaim; members see only their own seats; print names off by
  default. Seat-holder records are personal data: included in deletion on request, never in logs/pushes.
- **Concurrency**: a save over a newer version warns instead of overwriting.
- **Tests** cover registered and unregistered households in: Excel paste, matching, responses upload,
  on-behalf release, linking on registration; plus a dev smoke.
- **Phasing**: (1) layout editor + Excel paste + seat holders; (2) release with real data (member, gabbai
  on behalf, print); (3) responses upload; (4) timed reminders and push. The fixture preview continues.
- **Asked the owner** for the real Excel chart (kept on the machine only, never in git).

## Member view is limited (owner, 2026-10-27, repeated)

"A member of the Kehila should not have the whole view at all. He will be asked only to free his places …
he will see the block that he sits in, two rows ahead and two rows behind." Binding: the member seat page
shows **only** his block, his row(s) ±2 — **no whole-hall map, no mini-map, no other blocks**, and the API
returns only that cut to a member (never the full layout). The full hall is for gabbaim (editor, print).

## The Kehila's current seating sheet — structure only (owner's export, 2026-10-27; the file stays off git)

A Google Sheet fed by a Google Form. Structure that changes the model (examples below are invented):
- **Form responses** (one row per answer): timestamp; name; "seats I won't need this Shabbat" for
  **ערב שבת** and for **יום שבת** separately; "how many of my seats will be free" for **חג** and for
  **קריאת מגילה**; and **requests to reserve seats** per area: **נשים · בית הכנסת**, **גברים · אולם**,
  **נשים · אולם**.
- **The map**: one grid per prayer (ערב שבת, יום שבת), 13 numbered rows, blocks separated by empty
  columns, a "בימה" cell; each seat cell is "<family>[ <initial>]<n>-" (invented example: "בדיוני1-",
  "דוגמה ש2-.") and "פנוי" for an unassigned seat. Seat states: ממתין (no answer yet), משוחרר (released),
  תפוס (taken), פנוי (free). A family's released count is applied to its seats in order. Summaries: free
  seats, and "requested more than available".
- **So the model needs:** several **areas** (main hall, the "אולם", women's sections), **events** beyond
  Shabbat (חג, מגילה), and **reservation requests** besides releases — a release answer is a count per
  event, mapped onto the family's seats.
- **Paste from Excel** reads this cell format; the responses upload reads the Form's CSV columns above.
- **Asked the owner**: the .xlsx export (a PDF loses cell positions), whether the women's sections have
  their own maps or only counts, and where seats-per-family comes from.

## The real workbook (owner's .xlsx, 2026-10-27; kept off git — structure only here)

Tabs: "Form Responses 1" (the Google Form answers — columns as listed above), "Map" (the seat chart),
per-prayer calculation tabs (ערב שבת / יום שבת: family, free seats, max seats, relevant, seat 1–6), the
gabbai printout tabs, and Positive/Summary tabs.
- **Hall**: 225 seats in **6 blocks** (the earlier gabay mock-up had 5 blocks / 205 — it missed a 2-column
  block at the far left: 20 seats). Sheet rows 6–19 → hall rows 0–13 (row 0 = an unnumbered front row, the
  sheet labels rows 1–13 in a side column). Bimah = a 4×3 merged area in the middle block. Shape (no names):
  `S` seat / `B` bimah / `.` empty, left→right as in the sheet:
  ```
   0 ....SS..................SSS..
   1 SS.SSSSS................SSSSS
   2 SS.SSSSS................SSSSS
   3 SS.SSSSS................SSSSS
   4 SS.SSSSS.SSSS.SSSS.SSSS.SSSSS
   5 SS.SSSSS.SSSS......SSSS.SSSSS
   6 SS.SSSSS.SSSS.BBBB.SSSS.SSSSS
   7 SS.SSSSS.SSSS.BBBB.SSSS.SSSSS
   8 SS.SSSSS.SSSS.BBBB.SSSS.SSSSS
   9 SS.SSSSS.SSSS......SSSS.SSSSS
  10 SS..SSS..SSSS.SSSS.SSSS.SSSSS
  11 .........SSSS.SSSS.SSSS.SSSSS
  12 .........SSSS.SSSS.SSSS.SSSSS
  13 ........................SSSS.
  ```
- **Cell format**: every seat cell is exactly `<family>[ <initial>.]-<n>` (e.g. invented "בדיוני ש.-2") or
  `פנוי`; 80 families, 1–6 seats each, 27 unassigned seats; all cells parse.
- **Seats per family ("Max Family")** is not entered anywhere — it is the count of that family's cells on
  the map. So the map is the single source of seat ownership.
- **Women's seats**: no map — only reservation counts in the form (נשים · בית הכנסת, גברים · אולם, נשים ·
  אולם). Model them as counted areas (capacity + requests), not seat maps — CTO default, owner to confirm.
- Ark side and numbering direction are still not in the file (keep provisional).

**Owner, 2026-10-27:** "ark is in the front. For now only a men map is needed." → the ark is at the front
(the top of the sheet: row 0, then rows 1–13 moving away from it). Only the men's hall gets a seat map;
women's seats stay counted areas (later).

**Owner, 2026-10-27:** "There are no numbers... you can assign them but they mean nothing, at least in our
Kehila." → seat numbers are internal ids only: never shown on the print or as "כיסא N" to members; a
member's seats are shown by position in his block, labelled at most by the family's own order (the sheet's
"<family>-1/-2…"). Drop the numbering-direction constant.
