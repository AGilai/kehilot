# Me, Kehila menu and management structure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Me becomes a read-only summary; all personal and family editing (name, phone, phone-list switch, partner
linking, children, tree) happens in the family tree; community-level things move to a Kehila menu under the top logo;
the gabbai management area is grouped by weekly use; gabbaim always see members' phones.

**Architecture:** client restructure over existing routes, plus two server changes: gabbai member responses include
phones, and the privacy page text. Partner-linking and children UI move from the old Me family card (P2) into the tree
screen (empty spouse slot, banners, the partner's sheet), reusing the existing family routes.

**Tech Stack:** Expo/React Native + web (`src/`), Python Lambda (`server/cloud/`), static privacy page (`public/privacy/`).

**Spec:** `docs/UX-DESIGN.md` §18 (18.1 inventory, 18.2 Me, 18.2a Kehila menu, 18.3 management, 18.4 rules, 18.6 copy,
18.7 supersedes, 18.8 open points) and the §17 note; frames P41 (Me, Kehila menu), P42 (management), P31/P32 (partner
linking and "הפרטים שלי בקהילה" in the self sheet), P11 phones. Owner decisions in §18 rounds 1–4 are binding.

## Global Constraints

- Me has no edit controls; the only edit outside the tree is a listener's own name (§18 open point 4: accept as designed).
- One place to edit each field: name/phone/switch in my figure's sheet ("הפרטים שלי בקהילה" block, one save).
- Phone-list switch copy: on "חברים וגבאים של {kehila} רואים אותו." / off "רק הגבאים של {kehila} רואים אותו.";
  card line "ברשימת הטלפונים: מוצג לכולם / לגבאים בלבד".
- Gabbaim of the same Kehila see every member's phone (P11), with call/WhatsApp; other members only via the list when on.
- Name labels by gender: men "השם לעלייה לתורה", women "השם למי שברך" (read-only on Me).
- Kehila menu: tapping the Kehila name/logo opens one sheet (replaces the switcher): ניהול הקהילה (gabbai, badge),
  עץ המשפחה, רשימת הטלפונים, הזמנת מתפלל, על הקהילה, הקהילות שלי, הצטרפות לקהילה נוספת.
- Management groups in order: לטיפול עכשיו (only when waiting) › תפילות וזמנים › מקומות ישיבה › הודעות וערוצים ›
  שמחות ועליות › חברים ומשפחות › הגדרות הקהילה; sidebar from 1024 px.
- No feature removed: every item in the §18.1 inventory stays reachable (test asserts the map).
- Invented names only. Tests: `npm test`, `npm run typecheck`, server suite.

## Review Focus

1. A partner request received while the tree is open — the banner appears and confirm/decline work; Home card too.
2. A listener (no family): Me and the Kehila menu show nothing family-related; name edit works where §18 puts it.
3. A member asking for another member's phone through any route — still refused; only gabbaim get phones.
4. A gabbai with nothing waiting — "לטיפול עכשיו" hidden; with waiting items — the right count on the logo dot.
5. Wide web (≥1024): management sidebar and the tree's side panel together without overlap.

---

### Task 1: server — gabbai sees phones; privacy page

`server/cloud/routes_admin.py` (members list for gabbai includes each adult's `phone` and `showPhone`), tests
(gabbai 200 with phones; member/listener refused; other Kehila 404; nothing in logs); `public/privacy/index.html`
(he/en text: gabbaim see members' phones; the list switch controls members' visibility); `server/API.md`.

### Task 2: the tree takes over partner linking and "my details"

`src/views/tree/*`: empty spouse slot sheet (member picker → request, or details without account), "ממתין לאישור" tag
and withdraw, received-request banner (confirm/decline), declined/expired banner, unlink at the bottom of the partner's
sheet (existing confirm copy); self sheet "הפרטים שלי בקהילה" block (app name, phone + remove, switch with helper text,
one save via existing profile/phone/switch routes, then the tree PUT). Pure state tests first (request states → slot/banner).

### Task 3: Me read-only + Kehila menu

`src/views/Me.tsx` and `src/views/me/*`: one read-only card (P41), family status line, button "צפייה ועריכה בעץ
המשפחה ‹" (opens the tree at my figure); remove the old family card, edit sheet and phone section; listener's name edit
in החשבון. `src/views/KehilaSwitcher.tsx` → Kehila menu sheet per §18.2a (logo dot when management has waiting items).
Test: inventory map — every §18.1 item has a reachable destination.

### Task 4: management grouping (P42) and P11 phones

Management home per §18.3 groups and order, settings rows show values and open sheets, sidebar ≥ 1024; P11 shows
phones with call/WhatsApp and list state. Visual checks 390 he light/dark and 1280.

### Task 5: smoke + deploy (controller; owner runs the apply)

Smoke: gabbai sees phones, member does not; web deploy.
