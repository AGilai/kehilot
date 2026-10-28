# Getting started (contributors without AWS access)

You can develop, test and see every change on your own machine. Deploying to dev, the live smoke test, Terraform and
dev data stay with the repo owner, who reviews and deploys each PR.

## 1. Setup

Needs Node 22, Python 3.11+ and git.

```
git clone https://github.com/AGilai/kehilot.git && cd kehilot
git checkout redesign
npm ci
python3 -m venv .venv
.venv/bin/python -m pip install -r server/requirements.txt -r server/requirements-dev.txt
cp .env.dev.example .env.dev
```

`.env.dev` holds only public identifiers. Never commit it (it is gitignored).

## 2. See your changes

| Command | What you get |
| --- | --- |
| `npm run web:fixtures` | The app in the browser with invented data and no server. Fastest loop for UI work. Add `?lang=he` or `?lang=en`. |
| `npm run web:dev` | Your code at `http://localhost:8081`, talking to the real dev server. Keep port 8081: it is the only local origin the API allows. Sign up with email and password, then ask the owner for an invite to a community. |
| `npm run ios` / `npm run android` | Local native builds (see README), against dev via the same `.env.dev`. |

Server changes you make are not on dev until they are deployed, so test them through the server tests.

## 3. Tests (all run offline; the server tests use a fake AWS)

```
npm test
npm run typecheck
.venv/bin/python -m unittest discover -s server/tests
```

All three must pass before a PR.

## 4. Read first

- `docs/UX-DESIGN.md`: the design spec and the owner's decisions. Every UI change follows it; new screens get a
  design section first.
- `server/API.md`: the API contract.
- `docs/superpowers/plans/`: the implementation plans (the latest ones show the current work).
- Aliyot: `server/cloud/aliyot/engine.py` is extracted from `main`; `docs/ALIYOT-UPSTREAM.md` explains how it is kept
  in sync.

## 5. Rules

- Invented names and phones only in code, tests, docs and screenshots. Never real congregants' data.
- No secrets, `.env*`, Terraform state or plans in commits. No personal data in logs.
- Dates on screen: Hebrew date first, Gregorian in brackets ("י״א בחשוון (23.10)").
- Members never get whole-hall seating data; names on seats are for gabbaim only.

## 6. Pull requests

1. Branch from `redesign`, open the PR into `redesign`. Small PRs, one topic each.
2. Say what you changed, the test results, and screenshots for UI.
3. Agree on the area first (for example aliyot), so two people do not edit the same files at once.
4. The owner reviews, runs the tests, merges, deploys to dev and runs the smoke test.
