# Aliyot engine: upstream mapping

Noam (`origin/main`) owns the aliyah-recommendation algorithm. We carry a DB-free port. Recorded upstream commit: **6d74d0e**.

## Mapping (upstream -> ours)

| Upstream (6d74d0e) | Ours |
|---|---|
| `server/recommendations.py` (algorithm functions, verbatim) | `server/cloud/aliyot/engine.py` |
| `RecommendationsStore.aliyah_recommendations` | `engine.recommendations(people, services, *, selected, today, prayer, yahrzeit_custom)` (`today` required) |
| `RecommendationsStore.recommendation_calendar` | `engine.calendar(year, today)` |
| SQL `WITH history ... GROUP BY person_id` | `engine.service_statistics` |
| `RosterStore._refresh_roster` (eligibility, tribe/classification derivation) | `engine.project_people` |
| `server/settings.py` `YAHRZEIT_CUSTOMS` | `engine.YAHRZEIT_CUSTOMS` |
| `server/hebrew_calendar.py` | `server/hebrew_calendar.py` (identical at 6d74d0e, reused) |
| compare tool (not upstream) | `tools/aliyot_compare.py` |
| `server/tests/test_roster.py` (eligibility/classification/calendar tests) | `server/tests/test_aliyot_engine_roster.py` |
| `server/tests/test_recommendations.py`, `test_recommendation_filters.py`, `test_yahrzeit_customs.py`, `test_multiple_minyanim.py` | `server/tests/test_aliyot_engine.py`, `_filters.py`, `_yahrzeit_customs.py`, `_minyanim.py` (+ `aliyot_engine_helpers.py`, `test_aliyot_engine_extra.py` new) |
| `src/aliyot.ts`, `src/recommendations.ts`, `src/printLayout.ts` | `src/aliyot/aliyot.ts`, `recommendations.ts`, `printLayout.ts` (verbatim) |
| `src/types.ts` (aliyah types), `src/dates.ts` (`formatCivilDate`, `pickerDate`, `isYomKippur`) | `src/aliyot/types.ts`, `src/aliyot/dates.ts` |
| `tests/aliyot.test.ts`, `tests/recommendations.test.ts` | `tests/aliyotSlots.test.ts`, `tests/aliyotRecommendations.test.ts` (+ `tests/aliyotDates.test.ts` new) |

Not extracted (out of scope): `server/roster.py` persistence/save/validation, `server/classifications.py` (the engine only reads each person's `classification` string), `server/gabbai.py` aliyah templates.

## Intentional differences

- No sqlite: people and services are plain dicts; `yahrzeits` is a list and `hebrew_birth_date` a dict (upstream parses JSON text). Yahrzeit custom is a parameter, not read from `community_settings`.
- No auth (`require_gabbai`), no `israel_today()`: `recommendations(people, services, *, selected, today, ...)` takes a required `today` (year-range check `5700 <= year <= current+10`, service-day and prayer checks, all as upstream, 400 `APIError`). Upstream's default date (none given) is `next_service(today)`; the caller computes it. Date-string parsing (`civil_date`) stays with the caller.
- `project_people(people, selected)` ports `_refresh_roster` eligibility and derivations as pure logic, driven by a `kind` field on each person (default `manual`):
  - `manual`: gabbai-entered row; `active` is the caller's flag unless an eligibility date is known.
  - `self` (member) / `son`: `source_active` (default True, the family record's `active`); inactive if `eligible_from > selected`; a `son` with no computable bar-mitzvah date (e.g. birth date without year) is never active. Son derivations when the key is present: `father_tribe` -> tribe; `father_classification` ('א' -> 'דור ב' / 'דור ב-נשוי' per `married`; other non-empty -> 'קבוע'; empty -> ''), overridden by `classification_override` (not None); `married` + `spouse_prayer_name` -> `wife_prayer_name`. `self` with `is_gabbai` and empty classification gets 'א'.
  - `son_in_law`: active only if `daughter_active` AND `daughter_married` (default False) AND `display_name` (his name) non-empty AND eligible. `household_classification` ('א' -> 'חתן', other non-empty -> 'קבוע', empty -> keep) unless a truthy `classification_override`.
  - Eligibility = `eligible_from` (ISO text or date) when the key is present (None = unknown), else derived from `hebrew_birth_date` with `bar_mitzvah_date(..., selected)`. A known `eligible_from` OVERRIDES the `active` flag for manual and son-in-law rows.
  - Not ported (caller's data layer): creating roster rows from the family tree, daughters/sons-in-law lookup, seat allocation resets.
- `service_statistics` reproduces the SQL: counts are call rows (a person in two minyanim counts twice), ordering date desc, mincha first, then minyan, service id, position.
- An unknown `yahrzeit_custom` raises 400 (upstream could not store one).
- Tests: `test_roster.py` ports only the eligibility/classification/calendar tests; the roster-screen count (`_roster_value`, inclusive of today), service save/validation, name sync, HTTP/sqlite tests are not extracted. sqlite/HTTP/auth plumbing not ported elsewhere; `patch(israel_today)` and `validation.israel_today` patches dropped (they only allowed saving future services). Test names and scenarios are kept.
- Client: no `escapeHtml` existed in our `src`, so `printLayout.ts` is ported as is. Our `Relationship` type lacks the extended relatives, so `src/aliyot/types.ts` adds `YahrzeitRelationship`.

## Comparing after Noam pushes

1. `git fetch origin`
2. Behaviour check first: `.venv/bin/python tools/aliyot_compare.py -n 300` (extracts upstream with `git archive origin/main`, runs random cases through upstream's real store and our engine; exit 1 and a diff on any mismatch). It covers manual roster rows only, so family-derived rules still need the textual diff below.
3. `git diff 6d74d0e origin/main -- server/recommendations.py server/hebrew_calendar.py server/settings.py server/roster.py server/classifications.py server/validation.py server/gabbai.py src/aliyot.ts src/recommendations.ts src/printLayout.ts src/types.ts src/dates.ts server/tests/test_recommendations.py server/tests/test_recommendation_filters.py server/tests/test_yahrzeit_customs.py server/tests/test_multiple_minyanim.py server/tests/test_roster.py tests/aliyot.test.ts tests/recommendations.test.ts`
4. Re-port any change into the files above (tests first), noting new differences here. If `hebrew_calendar.py` changed, port it into `server/cloud/aliyot/` rather than altering ours. `validation.py` matters for `APIError` and `civil_date`; `gabbai.py` for the aliyah templates (not extracted).
5. Run the server tests, `npm test`, `npm run typecheck`, the compare tool; replace the commit hash at the top with the new `git rev-parse --short origin/main`.
