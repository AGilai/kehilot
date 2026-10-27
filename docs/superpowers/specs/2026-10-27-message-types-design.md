# Message types in one main channel — design

Owner decision, 2026-10-27 ("I approve both commits and new directions").

## Why

The original spec seeded three channels per Kehila: announcements, simchas, condolences. The owner:
"smachot and nichumim should be message type and not channels. There's no specific channel for smachot
or nichumim. It should come like a message type under the main channel of the gabayim." Message types
already exist (`weekly`, `celebration`, `condolence`, `event`); the extra channels duplicate them.

## What changes

1. **One default channel.** A new Kehila gets only the main channel (stored name `announcements`, shown as
   "הודעות הקהילה" / "Announcements" by `channelLabel`), `listenersCanRead: true`,
   `postPolicy: 'broadcasters'`. Groups and conversation channels are unchanged.
2. **New type `general`** — a regular message from a member ("הודעה" / "Message"). Push text: the existing
   generic message text.
3. **Per-type rules, a Kehila setting** (`settings.typeRules`), edited by a gabbai:

   | type | who may post | guests (listeners) see it |
   |---|---|---|
   | `weekly`, `event` | gabbaim only (fixed) | yes (fixed) |
   | `general` | gabbaim + members with broadcast permission (fixed) | yes (fixed) |
   | `celebration`, `condolence` | setting: `management` or `broadcasters`; default **`broadcasters`** | setting; default **no** |

   Stored shape: `typeRules: {celebration: {post: 'broadcasters'|'management', listeners: bool},
   condolence: {…}}`. A missing rule means the default. Only these two types are configurable.
4. **Posting** (`visibility.can_post(membership, channel, type, rules)`), non-conversation channels: a
   gabbai always; a member only when `canBroadcast`, the channel's `postPolicy` is `broadcasters`, and the
   type's rule allows `broadcasters`. Listeners never. Conversation channels are unchanged (types do not
   apply to chat). The channel list returns `postableTypes` per channel so Compose shows only those.
   A member without permission for `celebration` can still post `general` — the owner's rule: "if someone
   does not have permission to simcha he can broadcast as general message".
5. **Seeing** (`visibility.message_visible(membership, channel, message, rules)`): as today, plus a
   listener does not see a `celebration`/`condolence` message whose rule has `listeners: false`. Evaluated
   at read time, so changing the setting applies to past messages too. Members and gabbaim always see
   them ("members will see messages" — owner). Every reader of messages goes through it: message GET,
   the change feed, search results from the feed, and the push worker (no push to a listener for a
   message they cannot see). Private replies keep their own rule.
6. **Existing Kehilot** (dev only today): a one-off admin command merges each Kehila to the new shape:
   for the `simchas` and `condolences` channels it moves nothing — if a channel has no messages it is
   deleted; if it has messages the command lists it and leaves it (a gabbai decides). The main channel's
   `postPolicy` becomes `broadcasters`. Dry-run by default; `--apply` to write.
7. **Gabbai settings** (GD3): a "Message types" section with, for mazal tov and condolence: who may post
   (gabbaim only / also members with broadcast permission) and "guests can see" (off by default). Design
   by the designer (one look and feel).
8. **Compose**: the type picker lists only `postableTypes` for the chosen channel; if only one, no picker.

8a. **Filter the messages list** (owner, 2026-10-27: "the message types become a filter on channel. So allow
   filter by free text or message type, where MT is a multi select"). On Messages: a free-text filter and a
   **multi-select** of message types, combined (AND between text and types, OR among the selected types),
   applied on the device to what the person may already see (no new server route). Works with the
   "mine / all" switch and the channel chips when those show. Overrides the design's earlier "no type
   filter" call; layout by the designer (§12).
9. **Role tags** (owner, 2026-10-27: "support from now a roles tag … I'm not actually a gabbai, I'm the
   technical person of the Kehila … the chips and the ability to assign roles to people in the Kehila will be
   a good foundation"). Kehila-defined names (e.g. גבאי, רב, טכני, ועד שמחות); several per person; created,
   renamed, deleted and assigned by gabbaim only; at most 20 per Kehila, name ≤ 24 characters, unique per
   Kehila. **Labels only for now: they grant nothing** — the access role (listener / member / gabbai) and
   every visibility/post rule are unchanged by tags. Stored as Kehila-level tag items with an id and name;
   a membership holds tag ids. Deleting a tag removes it from everyone. Shown as chips where the designer
   decides (`docs/UX-DESIGN.md` §12 "Role tags"). Tag names are personal data only in combination with a
   person: included in the person's own data export, never in pushes or logs.

## Later (not now)

Per-type see/post permissions attached to role tags (e.g. "simchas committee"). Today's "members with
broadcast permission" becomes one such role then; `typeRules` is the subset that maps onto it.

## Constraints

- No PII in logs or pushes (unchanged). Push `data` stays `{kehila, messageId}`.
- Smoke (`tools/smoke_dev.py`) must stop relying on the `simchas` channel and cover: member posts
  `celebration` in the main channel; a listener does not see it by default and sees it after the gabbai
  turns `listeners` on; a member whose type rule is `management` gets 403 for `celebration` but 201 for
  `general`.
- Invented names only in tests, fixtures and smoke.
