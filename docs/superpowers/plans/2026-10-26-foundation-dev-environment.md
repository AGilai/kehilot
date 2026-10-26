# Kehilot Foundation (dev environment) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the `dev` AWS environment in Tel Aviv from Terraform: Cognito, DynamoDB, an HTTP API with
a Python Lambda that answers `/health`, `/v1/me` and a tenant-guarded `/v1/kehilot/{k}`, a web bucket behind
CloudFront, alarms and a budget. A smoke test proves sign-in works and one Kehila cannot read another.

**Architecture:** Terraform modules under `infra/modules/*` wired by `infra/envs/dev`, state in an S3 bucket
created by `infra/bootstrap/account`. The Lambda is a new package `server/cloud/` (router, identity,
authorization, DynamoDB repository) packaged by `tools/build_lambda.py`. Everything later (messages, push,
jobs, the app) builds on the `require()` guard and the repository introduced here.

**Tech Stack:** Terraform 1.17.0 (`~/tools/terraform`), AWS provider 6.x pinned exactly, Python 3.12
(Lambda `python3.12`, `arm64`), boto3, moto, `unittest` (the repo's existing test runner), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-26-aws-architecture-design.md` (approved 2026-10-26). UX:
`docs/UX-DESIGN.md` (not used by this plan).

**This is plan 1 of 4.** Later plans: (2) backend port: messages, channels, invites, replies, change feed,
push worker, jobs, Noam's domain logic and its 81 tests; (3) app: Cognito sign-in, Kehila switcher, the
approved UX, web deploy; (4) prod: `kehilot.meyodea.com` subzone, SES, GitHub OIDC deploys, prod env.

## Global Constraints

- Region `il-central-1` for everything regional; `us-east-1` only for CloudFront certificates (plan 4).
- AWS account `180521634103` is never hard-coded: use `data "aws_caller_identity"` or variables (spec §7a).
- Every resource name starts `kehilot-<env>-` (state bucket: `kehilot-tfstate-<account_id>`); tags
  `project=kehilot`, `env=<env>` via provider `default_tags`.
- Every IAM role Terraform creates: `path = "/kehilot/"` and
  `permissions_boundary = "arn:aws:iam::<account_id>:policy/kehilot/kehilot-boundary"`. Without both, the
  deployer role is denied (`infra/bootstrap/iam/kehilot-permissions.json`).
- Log groups: `/aws/lambda/kehilot-<env>-*` or `/kehilot/<env>/*`; retention 14 days in dev, 30 in prod.
- SSM parameters under `/kehilot/<env>/`.
- Terraform `required_version = ">= 1.11"`; S3 backend with `use_lockfile = true`; provider versions pinned
  exactly (`= x.y.z`) in each root's `versions.tf`.
- Lambda: `runtime = "python3.12"`, `architectures = ["arm64"]`, zip from `tools/build_lambda.py`,
  `source_code_hash = filebase64sha256(zip)`. No layers.
- Data keys always start with the Kehila: `K#<k>`. Kehila and user IDs are ULIDs
  (`^[0-9A-HJKMNP-TV-Z]{26}$`). Our own `userId` is never the Cognito `sub` (spec §7a).
- API throttling: rate 20 req/s, burst 50.
- No personal data in logs: never log tokens, emails or request bodies.
- Commands run as `ubuntu` on this EC2; AWS credentials come only from the `kehilot-deployer` instance role.
  No access keys anywhere. Do not run Terraform and the test suite at the same time (2 GB RAM box).
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; work on branch `redesign`.

## Review Focus

1. **A member of Kehila A asks for Kehila B** → 404 with the same body as a non-existent Kehila, so the
   existence of other Kehilot does not leak. Test in Task 3 (`test_other_kehila_is_404`) and the smoke test
   in Task 8.
2. **Two first requests from one new user at the same moment** → one `userId`, not two. Test in Task 2
   (`test_concurrent_first_login_keeps_one_user_id`).
3. **A path segment carrying key syntax** (`/v1/kehilot/A%23B`, lower-case, too long) → 400, never a
   DynamoDB key built from it. Test in Task 3 (`test_bad_kehila_id_is_400`).
4. **Unknown path or method under `/v1/`** → JSON 404/405, not a 500 or a stack trace. Test in Task 3
   (`test_unknown_route_is_json_404`, `test_wrong_method_is_405`).
5. **Request without or with a bad JWT** → 401 from API Gateway before the Lambda runs; `/health` still 200.
   Checked in the smoke test, Task 8 (`check_unauthenticated`).

---

## File Structure

| Path | Responsibility |
|---|---|
| `server/cloud/__init__.py` | package marker |
| `server/cloud/ids.py` | `new_id()` ULID generator, `ID_RE` |
| `server/cloud/repo.py` | `Repo`: all DynamoDB reads/writes for this plan |
| `server/cloud/identity.py` | `Caller` from JWT claims; `resolve_user_id()` |
| `server/cloud/authz.py` | `require()` tenant/role guard |
| `server/cloud/handler.py` | Lambda entry `handler(event, context)`, router, JSON responses |
| `server/cloud/routes_core.py` | handlers for `/health`, `/v1/me`, `/v1/kehilot/{k}` |
| `server/tests/cloud/test_*.py` | unit tests with moto |
| `server/requirements-dev.txt` | boto3, moto pins (tests only; boto3 is provided by Lambda at runtime) |
| `tools/build_lambda.py` | deterministic zip of `server/` + vendored `pyluach` |
| `tools/smoke_dev.py` | end-to-end check against deployed dev |
| `infra/bootstrap/account/` | state bucket, budget (local state, then migrated into the bucket) |
| `infra/modules/{auth,data,api,web,observability}/` | one concern each, `main.tf`/`variables.tf`/`outputs.tf` |
| `infra/envs/dev/` | `versions.tf`, `backend.tf`, `main.tf`, `variables.tf`, `outputs.tf` |
| `.github/workflows/ci.yml` | tests + `terraform fmt -check` + `validate`, no AWS access |

---

### Task 1: Python tooling and ULIDs

**Files:**
- Create: `server/requirements-dev.txt`, `server/cloud/__init__.py`, `server/cloud/ids.py`,
  `server/tests/cloud/__init__.py`, `server/tests/cloud/test_ids.py`
- Modify: `package.json` (`test:server` script), `.gitignore`

**Interfaces:**
- Produces: `new_id() -> str` (26-char Crockford base32 ULID, millisecond time prefix, random tail);
  `ID_RE: re.Pattern` = `^[0-9A-HJKMNP-TV-Z]{26}$`.

- [ ] **Step 1: Make a venv.** `ensurepip` is missing on this box: `sudo apt-get install -y python3.12-venv`,
  then `python3 -m venv .venv && .venv/bin/pip install -r server/requirements.txt -r server/requirements-dev.txt`.
  `requirements-dev.txt` pins the current `boto3` and `moto[dynamodb,cognitoidp]` releases exactly (`==`),
  chosen at install time.
- [ ] **Step 2: Write failing tests** in `test_ids.py`:

```python
def test_shape(self):
    self.assertRegex(new_id(), ID_RE)
def test_time_sortable(self):
    a = new_id(); time.sleep(0.002); b = new_id()
    self.assertLess(a, b)
def test_unique(self):
    self.assertEqual(len({new_id() for _ in range(1000)}), 1000)
```

- [ ] **Step 3: Run** `.venv/bin/python -m unittest server.tests.cloud.test_ids -v` → fails (no module).
- [ ] **Step 4: Implement `new_id()`** with `time.time_ns() // 1_000_000` (48 bits) + `secrets.token_bytes(10)`
  (80 bits), encoded as 26 Crockford base32 characters. No dependency.
- [ ] **Step 5: Run** the same command → 3 tests pass. Also run
  `.venv/bin/python -m unittest discover -s server/tests -v` → the existing 81 tests still pass. Change
  `test:server` in `package.json` to `.venv/bin/python -m unittest discover -s server/tests -t . -v` if
  discovery of the `cloud` subpackage needs the top-level dir.
- [ ] **Step 6: Commit.** Add `infra/**/.terraform/`, `*.tfstate`, `*.tfstate.*`, `infra/**/terraform.tfvars`,
  `dist/` to `.gitignore` in the same commit.

### Task 2: DynamoDB repository and caller identity

**Files:**
- Create: `server/cloud/repo.py`, `server/cloud/identity.py`, `server/tests/cloud/helpers.py`,
  `server/tests/cloud/test_identity.py`

**Interfaces:**
- Consumes: `new_id()`.
- Produces:
  - `TABLE_SCHEMA: dict` in `repo.py`: `pk`/`sk` string keys, GSI `gsi1` on `gsi1pk`/`gsi1sk`,
    `PAY_PER_REQUEST`. The Terraform `data` module (Task 5) must match it exactly.
  - `class Repo(table)` with:
    - `get_user_id(sub: str) -> str | None` (item `pk=U#<sub>`, `sk=SUB`, attr `userId`)
    - `create_user_id(sub: str, user_id: str, email: str) -> str`: conditional put
      (`attribute_not_exists(pk)`). On `ConditionalCheckFailedException` it returns the stored `userId`.
    - `get_kehila(k: str) -> dict | None` (`K#<k>`/`META`)
    - `get_membership(k: str, user_id: str) -> dict | None` (`K#<k>`/`M#<user_id>`)
    - `list_memberships(user_id: str) -> list[dict]` (query `gsi1`, `gsi1pk=U#<user_id>`)
    - `put_kehila(k, name)` and `put_membership(k, user_id, role, classification='')`: setup helpers for
      tests and the smoke test. Membership sets `gsi1pk=U#<user_id>`, `gsi1sk=K#<k>`.
  - `identity.py`: `@dataclass Caller(sub: str, email: str, groups: tuple[str, ...])`;
    `caller_from_event(event) -> Caller` reads `requestContext.authorizer.jwt.claims` (`sub`, `email`,
    `cognito:groups`, where groups may be a `"[a b]"` string or missing); `resolve_user_id(repo, caller) -> str`.
  - `helpers.py`: `make_table() -> boto3 Table` inside `moto.mock_aws`, built from `TABLE_SCHEMA`.

- [ ] **Step 1: Write failing tests** in `test_identity.py` (class decorated `@mock_aws`, env
  `AWS_DEFAULT_REGION=il-central-1`):
  - `test_first_call_creates_user_id`: `resolve_user_id` returns a value matching `ID_RE`, and
    `get_user_id(sub)` then returns the same value.
  - `test_second_call_returns_same_id`.
  - `test_concurrent_first_login_keeps_one_user_id`: call `create_user_id(sub, "A"*26, e)` then
    `create_user_id(sub, "B"*26, e)`; the second returns `"A"*26`.
  - `test_groups_claim_formats`: `"[platform-admin]"` → `("platform-admin",)`, missing → `()`.
- [ ] **Step 2: Run** `.venv/bin/python -m unittest server.tests.cloud.test_identity -v` → fails.
- [ ] **Step 3: Implement** `repo.py` and `identity.py` with the signatures above.
- [ ] **Step 4: Run** → pass.
- [ ] **Step 5: Commit.**

### Task 3: Router, `require()` and the first three routes

**Files:**
- Create: `server/cloud/authz.py`, `server/cloud/routes_core.py`, `server/cloud/handler.py`,
  `server/tests/cloud/test_handler.py`

**Interfaces:**
- Consumes: `Repo`, `caller_from_event`, `resolve_user_id`, `ID_RE`, `server.validation.APIError`.
- Produces:
  - `ROLES = ('listener', 'member', 'gabbai')`.
  - `require(repo, user_id: str, k: str, roles: tuple[str, ...] = ROLES) -> dict` (the membership). Raises
    `APIError(400, …)` if `k` fails `ID_RE`. Raises `APIError(404, 'הקהילה לא נמצאה.')` if there is no
    membership or the Kehila does not exist (same message in both cases). Raises `APIError(403, …)` if
    the role is not in `roles`.
  - `@dataclass Ctx(repo: Repo, caller: Caller, user_id: str, body: dict | None)`.
  - `handler(event: dict, context) -> dict`: API Gateway HTTP API payload v2.0. Matches
    `event['requestContext']['http']['method']` and `event['rawPath']` against
    `ROUTES: list[tuple[str, re.Pattern, Callable[[Ctx, dict], tuple[int, dict]]]]`. Responses are
    `{"statusCode", "headers": {"content-type": "application/json; charset=utf-8"}, "body": json.dumps(..., ensure_ascii=False)}`.
    It returns 404 `{"error": "not_found"}` when no path matches, and 405 when the path matches but the
    method does not. `APIError` becomes `{"error": message}` with its status. Any other exception is
    logged as its type name plus `context.aws_request_id`, and returns 500 `{"error": "internal"}`.
  - The table name comes from env var `TABLE_NAME`; the boto3 resource is created once per container.
  - Routes:
    - `GET /health` → 200 `{"ok": true}` (no identity lookup).
    - `GET /v1/me` → 200 `{"userId", "email", "kehilot": [{"kehilaId", "name", "role"}]}`.
    - `GET /v1/kehilot/{k}` → `require(..., ROLES)`, 200 `{"kehilaId", "name", "role", "classification"}`.
- [ ] **Step 1: Write failing tests** in `test_handler.py`. A helper `event(method, path, sub="s1", email="a@example.test")`
  builds a v2 event with JWT claims. Seed two Kehilot `KA`, `KB` (valid ULIDs from `new_id()`), and make
  the caller a `member` of `KA` only.
  - `test_health`: 200, body `{"ok": true}`.
  - `test_me_lists_only_my_kehilot`: one entry, `kehilaId == KA`, `role == "member"`.
  - `test_own_kehila_is_200`.
  - `test_other_kehila_is_404`: `KB` → 404, and its body equals the body for a random unused ULID.
  - `test_bad_kehila_id_is_400`: paths `/v1/kehilot/A%23B`, `/v1/kehilot/abc`, and `"/v1/kehilot/" + "0"*27` → 400.
  - `test_listener_blocked_by_role_filter`: call `require(repo, uid, KA, ('gabbai',))` directly → `APIError` 403.
  - `test_unknown_route_is_json_404`: `GET /v1/nope` → 404 with a JSON body.
  - `test_wrong_method_is_405`: `POST /v1/me` → 405.
  - `test_unexpected_error_is_500_without_details`: patch `Repo.list_memberships` to raise `RuntimeError("secret")`; the body is `{"error": "internal"}` and does not contain `"secret"`.
- [ ] **Step 2: Run** `.venv/bin/python -m unittest server.tests.cloud.test_handler -v` → fails.
- [ ] **Step 3: Implement** `authz.py`, `routes_core.py`, `handler.py`.
- [ ] **Step 4: Run** all tests (`npm run test:server`) → the new tests and the 81 old ones pass.
- [ ] **Step 5: Commit.**

### Task 4: Lambda package builder

**Files:**
- Create: `tools/build_lambda.py`, `server/tests/cloud/test_build_lambda.py`

**Interfaces:**
- Produces: `build(out: Path = Path("dist/lambda/api.zip")) -> Path`. CLI: `python3 tools/build_lambda.py`.
  The zip contains `server/__init__.py`, `server/validation.py`, `server/hebrew_calendar.py`,
  `server/cloud/**.py` and `pyluach/` (installed with
  `pip install --no-deps --target <tmp> pyluach==2.3.0`). It contains no tests, `__pycache__`, `app.py`,
  `store.py` or `data/`. Entries are sorted and every timestamp is fixed (`1980-01-01`), so the same
  source gives the same bytes. The Lambda handler string is `server.cloud.handler.handler`.
- [ ] **Step 1: Write failing tests**:
  - `test_contents`: the zip names include `server/cloud/handler.py` and `pyluach/__init__.py`, and none
    contains `tests/` or `__pycache__`.
  - `test_deterministic`: build twice and the SHA-256 is equal.
  - `test_imports`: extract to a temp dir, then `subprocess.run([sys.executable, "-I", "-c", "import server.cloud.handler"], cwd=tmp)` → exit 0.
- [ ] **Step 2: Run** → fails. **Step 3: Implement.** **Step 4: Run** → pass.
- [ ] **Step 5: Commit.**

### Task 5: Bootstrap state bucket and budget; Terraform modules `data` and `auth`

**Files:**
- Create: `infra/bootstrap/account/{versions.tf,main.tf,variables.tf,outputs.tf}`,
  `infra/modules/data/*.tf`, `infra/modules/auth/*.tf`
- Modify: `infra/bootstrap/iam/README.md` (link to the account bootstrap and the manual tag step)

**Interfaces:**
- `bootstrap/account` → output `state_bucket` (`kehilot-tfstate-<account_id>`: versioning on, SSE-S3, all public
  access blocked, `prevent_destroy`). Also `aws_budgets_budget` `kehilot-monthly`: $25 limit, notifications
  at 40% ($10) and 100% to `var.alert_email`, filtered to cost-allocation tag `user:project$kehilot`.
- `modules/data`: inputs `name_prefix`, `pitr` (bool), `deletion_protection` (bool); outputs `table_name`,
  `table_arn`. The table is `${name_prefix}` (e.g. `kehilot-dev`) and its keys and GSI match `TABLE_SCHEMA`
  (Task 2). TTL is on `expiresAt`.
- `modules/auth`: inputs `name_prefix`, `enable_test_client` (bool). Pool `${name_prefix}-users`: email
  sign-in, email auto-verify, password min length 12, `deletion_protection` off in dev. Client
  `${name_prefix}-app`: no secret, `ALLOW_USER_SRP_AUTH` and `ALLOW_REFRESH_TOKEN_AUTH`. Group
  `platform-admin`. Optional client `${name_prefix}-smoke` with `ALLOW_ADMIN_USER_PASSWORD_AUTH`, created
  only when `enable_test_client`. Outputs: `user_pool_id`, `user_pool_arn`, `app_client_id`,
  `smoke_client_id` (or null), `issuer_url` = `https://cognito-idp.<region>.amazonaws.com/<pool_id>`.

- [ ] **Step 1: Write `bootstrap/account`** (local backend first). The user puts their alert email in
  `infra/bootstrap/account/terraform.tfvars` (gitignored). Ask them; do not put it in git.
- [ ] **Step 2: Apply the bootstrap:** `terraform -chdir=infra/bootstrap/account init && terraform -chdir=infra/bootstrap/account apply`
  → the bucket and the budget are created. Then add a `backend "s3"` block (key `bootstrap/terraform.tfstate`,
  region `il-central-1`, `use_lockfile = true`) and run `init -migrate-state` → `terraform state list` still
  shows both resources and the local `terraform.tfstate` is gone.
- [ ] **Step 3: Ask the user to activate the `project` cost-allocation tag** (Billing → Cost allocation tags).
  The deployer role cannot do it, and the budget only counts tagged costs once it is active.
- [ ] **Step 4: Write `modules/data` and `modules/auth`**, then run `terraform fmt -recursive infra` →
  no diff.
- [ ] **Step 5: Commit.**

### Task 6: Terraform modules `api`, `web`, `observability`

**Files:**
- Create: `infra/modules/api/*.tf`, `infra/modules/web/*.tf`, `infra/modules/web/placeholder/index.html`,
  `infra/modules/observability/*.tf`

**Interfaces:**
- `modules/api`: inputs `name_prefix`, `lambda_zip`, `table_name`, `table_arn`, `issuer_url`,
  `jwt_audience` (list), `log_retention_days`, `boundary_arn`, `throttle_rate = 20`, `throttle_burst = 50`.
  - Creates an IAM role `${name_prefix}-api` (path `/kehilot/`, boundary). Its inline policy allows
    `dynamodb:GetItem/PutItem/UpdateItem/DeleteItem/Query/TransactWriteItems/BatchGetItem` on the table
    and `table/*/index/*`, plus logs on its own log group.
  - Creates Lambda `${name_prefix}-api` (python3.12, arm64, 256 MB, 10 s, env `TABLE_NAME`), with log group
    `/aws/lambda/${name_prefix}-api` at that retention.
  - Creates HTTP API `${name_prefix}-http`: a JWT authorizer (issuer, audience); route `GET /health` with
    no auth; route `ANY /v1/{proxy+}` with JWT; `$default` stage with auto-deploy, the throttles above, and
    access logs to `/kehilot/<env>/api-access`; plus the Lambda permission.
  - Outputs: `api_url`, `api_id`, `function_name`.
- `modules/web`: input `name_prefix`. Creates a private bucket `${name_prefix}-web` with OAC, and a
  CloudFront distribution: default root `index.html`, 403/404 → `/index.html` with 200 (SPA), managed
  policies `CachingOptimized` for assets, `PriceClass_100`. The placeholder `index.html` is uploaded with
  `Cache-Control: no-cache`. Outputs: `bucket_name`, `distribution_id`, `web_url`
  (`https://<domain>.cloudfront.net`).
- `modules/observability`: inputs `name_prefix`, `alert_email`, `function_names` (list), `api_id`.
  Creates SNS topic `${name_prefix}-alerts` with an email subscription. Alarms, each sending to the topic:
  `${name_prefix}-api-5xx` (HTTP API `5xx` ≥ 5 in 5 min) and `${name_prefix}-<fn>-errors` (Lambda `Errors`
  ≥ 1 in 5 min). Output: `topic_arn`.
- [ ] **Step 1: Write the three modules.** Run `terraform fmt -recursive infra` → no diff.
- [ ] **Step 2: Commit.**

### Task 7: `envs/dev` wiring and first apply

**Files:**
- Create: `infra/envs/dev/{versions.tf,backend.tf,main.tf,variables.tf,outputs.tf}`,
  `infra/envs/dev/README.md` (the commands below)

**Interfaces:**
- Consumes: every module output above.
- Produces (outputs): `api_url`, `web_url`, `user_pool_id`, `app_client_id`, `smoke_client_id`,
  `table_name`, `region`. Plans 2–4 read these by these names.
- `versions.tf`: `required_version = ">= 1.11"`, `hashicorp/aws` pinned to the exact current 6.x version.
  Provider region `il-central-1`, with `default_tags { project = "kehilot", env = "dev" }`.
- `main.tf`: `locals { name_prefix = "kehilot-dev", boundary_arn = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:policy/kehilot/kehilot-boundary" }`;
  `data { pitr = false, deletion_protection = false }`; `auth { enable_test_client = true }`;
  `log_retention_days = 14`; `lambda_zip = "${path.root}/../../../dist/lambda/api.zip"`.
- [ ] **Step 1: Build and init:** run `python3 tools/build_lambda.py`, then
  `terraform -chdir=infra/envs/dev init -backend-config="bucket=<state_bucket>"` → "successfully initialized".
- [ ] **Step 2: Validate and plan:** `terraform -chdir=infra/envs/dev validate && terraform -chdir=infra/envs/dev plan -out=dev.tfplan`
  → no errors. Read the plan: every IAM role has path `/kehilot/` and the boundary, and every name starts
  `kehilot-dev`.
- [ ] **Step 3: Apply** `terraform -chdir=infra/envs/dev apply dev.tfplan` → it completes. If AccessDenied
  names an action the deployer lacks, stop and report the action. Do not widen permissions. Policy changes
  go through the user re-running `infra/bootstrap/iam/setup-deployer-role.sh`.
- [ ] **Step 4: Check** `curl -s "$(terraform -chdir=infra/envs/dev output -raw api_url)/health"` → `{"ok": true}`,
  and `curl -s -o /dev/null -w '%{http_code}' "$(... output -raw web_url)"` → `200`.
- [ ] **Step 5: Ask the user to confirm the SNS subscription email.** Then commit.

### Task 8: Smoke test against dev

**Files:**
- Create: `tools/smoke_dev.py`

**Interfaces:**
- Consumes: the dev outputs (`terraform output -json`), `Repo.put_kehila`, `Repo.put_membership`, `new_id`.
- Produces: CLI `.venv/bin/python tools/smoke_dev.py`. It exits 0 when every check passes and prints one
  line per check. It always cleans up the users and items it created, even on failure.
- Checks, in order:
  - `check_health`: 200.
  - `check_unauthenticated`: `GET /v1/me` with no token → 401, and with `Bearer garbage` → 401.
  - `check_sign_in`: `admin_create_user` two users `smoke-a+<rand>@example.invalid`,
    `smoke-b+<rand>@example.invalid`, then `admin_set_user_password(Permanent=True)` and
    `admin_initiate_auth(ADMIN_USER_PASSWORD_AUTH)` on the smoke client. `GET /v1/me` returns 200, and
    each user has a distinct `userId`.
  - `check_tenant_isolation`: seed Kehilot A and B, with user a a member of A and user b a member of B.
    a gets 200 on A and 404 on B; b gets 404 on A; and a's `kehilot` lists only A.
- [ ] **Step 1: Write the script.** Run it → all 4 checks pass.
- [ ] **Step 2: Run it a second time** → it passes again, so cleanup worked and nothing collided.
- [ ] **Step 3: Commit.**

### Task 9: CI without AWS

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Runs on push and pull_request to `redesign` and `main`. Jobs:
  - `python`: Python 3.12, `pip install -r server/requirements.txt -r server/requirements-dev.txt`, then
    `python -m unittest discover -s server/tests -t . -v`.
  - `node`: Node 24, `npm ci && npm test`.
  - `terraform`: `hashicorp/setup-terraform` pinned to 1.17.0, then `terraform fmt -check -recursive infra`
    and `terraform init -backend=false && terraform validate` in `infra/envs/dev` and
    `infra/bootstrap/account`. Create an empty `dist/lambda/api.zip` placeholder first, so `filebase64sha256` resolves.
  - No AWS credentials. OIDC deploys are plan 4.
- [ ] **Step 1: Write the workflow** and run each job's commands locally once (not in parallel) → all pass.
- [ ] **Step 2: Commit and push**, then ask the user to check that the Actions run is green. There is no
  `gh` CLI here.
