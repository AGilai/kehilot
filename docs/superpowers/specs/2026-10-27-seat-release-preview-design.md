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

Design through the designer (one look and feel): the card, the seat page with the block frame, the push copy.
