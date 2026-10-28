# Aliyot engine: upstream mapping

Noam (`origin/main`) owns the aliyah-recommendation algorithm. We carry a DB-free port. Recorded upstream commit: **6d74d0e**.

## Mapping (upstream -> ours)

| Upstream (6d74d0e) | Ours |
|---|---|
| `server/recommendations.py` (algorithm functions, verbatim) | `server/cloud/aliyot/engine.py` |
| `RecommendationsStore.aliyah_recommendations` | `engine.recommendations(people, services, *, selected, prayer, yahrzeit_custom, today=None)` |
| `RecommendationsStore.recommendation_calendar` | `engine.calendar(year, today)` |
| SQL `WITH history ... GROUP BY person_id` | `engine.service_statistics` |
| `RosterStore._refresh_roster` (eligibility part) | `engine.project_people` |
| `server/settings.py` `YAHRZEIT_CUSTOMS` | `engine.YAHRZEIT_CUSTOMS` |
| `server/hebrew_calendar.py` | `server/hebrew_calendar.py` (identical at 6d74d0e, reused) |
| `server/tests/test_recommendations.py`, `test_recommendation_filters.py`, `test_yahrzeit_customs.py`, `test_multiple_minyanim.py` | `server/tests/test_aliyot_engine.py`, `_filters.py`, `_yahrzeit_customs.py`, `_minyanim.py` (+ `aliyot_engine_helpers.py`, `test_aliyot_engine_extra.py` new) |
| `src/aliyot.ts`, `src/recommendations.ts`, `src/printLayout.ts` | `src/aliyot/aliyot.ts`, `recommendations.ts`, `printLayout.ts` (verbatim) |
| `src/types.ts` (aliyah types), `src/dates.ts` (`formatCivilDate`, `pickerDate`, `isYomKippur`) | `src/aliyot/types.ts`, `src/aliyot/dates.ts` |
| `tests/aliyot.test.ts`, `tests/recommendations.test.ts` | `tests/aliyotSlots.test.ts`, `tests/aliyotRecommendations.test.ts` (+ `tests/aliyotDates.test.ts` new) |

Not extracted (out of scope): `server/roster.py` persistence/save/validation, `server/classifications.py` (the engine only reads each person's `classification` string), `server/gabbai.py` aliyah templates.

## Intentional differences

- No sqlite: people and services are plain dicts; `yahrzeits` is a list and `hebrew_birth_date` a dict (upstream parses JSON text). Yahrzeit custom is a parameter, not read from `community_settings`.
- No auth (`require_gabbai`), no `israel_today()`: the caller passes `today`. Without `today`, `recommendations` skips the year-range check (`5700 <= year <= current+10`); the service-day and prayer checks always run. Errors are still `server.validation.APIError(400, ...)`. Date-string parsing (`civil_date`) stays with the caller.
- `project_people` replaces `_refresh_roster`: active = `eligible_from <= selected` when eligibility is known (given, or derived from `hebrew_birth_date` via `bar_mitzvah_date` when the `eligible_from` key is absent); otherwise the caller's `active` flag. Upstream also derives roster rows from the family tree (sons, sons-in-law, classification inheritance, gabbai default 'א'); the caller's data layer must supply those people already derived. Archived people: pass `active=False, eligible_from=None`.
- `service_statistics` reproduces the SQL: counts are call rows (a person in two minyanim counts twice), ordering date desc, mincha first, then minyan, service id, position.
- An unknown `yahrzeit_custom` raises 400 (upstream could not store one).
- Tests: sqlite/HTTP/auth plumbing not ported; `patch(israel_today)` and `validation.israel_today` patches dropped (they only allowed saving future services). Test names and scenarios are kept.
- Client: no `escapeHtml` existed in our `src`, so `printLayout.ts` is ported as is. Our `Relationship` type lacks the extended relatives, so `src/aliyot/types.ts` adds `YahrzeitRelationship`.

## Comparing after Noam pushes

1. `git fetch origin`
2. `git diff 6d74d0e origin/main -- server/recommendations.py server/hebrew_calendar.py server/settings.py server/roster.py server/classifications.py src/aliyot.ts src/recommendations.ts src/printLayout.ts src/types.ts src/dates.ts server/tests/test_recommendations.py server/tests/test_recommendation_filters.py server/tests/test_yahrzeit_customs.py server/tests/test_multiple_minyanim.py tests/aliyot.test.ts tests/recommendations.test.ts`
3. Re-port any change into the files above (tests first), noting new differences here. If `hebrew_calendar.py` changed, port it into `server/cloud/aliyot/` rather than altering ours.
4. Run the server tests, `npm test`, `npm run typecheck`; replace the commit hash at the top with the new `git rev-parse --short origin/main`.
