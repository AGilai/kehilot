# dev environment

Runs from this EC2 with the `kehilot-deployer` instance role (no keys).

    python3 tools/build_lambda.py                      # dist/lambda/api.zip
    terraform -chdir=infra/envs/dev init -backend-config="bucket=kehilot-tfstate-<account_id>"
    terraform -chdir=infra/envs/dev plan -out=dev.tfplan
    terraform -chdir=infra/envs/dev apply dev.tfplan
    .venv/bin/python tools/smoke_dev.py                # end-to-end check

`terraform.tfvars` (gitignored) holds `alert_email`.

## App configuration

After an apply, write the app's (gitignored) `.env.dev` from the Terraform outputs:

    python3 tools/write_app_env.py --env dev

`EXPO_PUBLIC_FEDERATION` stays empty until Google/Apple sign-in is set up. The Cognito domain
(`kehilot-dev.auth.<region>.amazoncognito.com`) and the OAuth settings on the app client exist for that
federation; the app never shows the hosted pages. CORS allows the web URL and `http://localhost:8081`.

## Media bucket

`kehilot-dev-media` holds brochure images (private, SSE-S3, no versioning, `force_destroy = false`). The app
uploads into `up/` with a presigned PUT; unclaimed uploads expire after a day. Attached images live under
`m/<kehila>/<message>` and are shown through short-lived presigned GET URLs. The API role may Put/Get/Delete
objects under those two prefixes only. CORS on the bucket allows the web URL and `http://localhost:8081`.

## Viewing the app

Two ways to see the web app against the dev API:

**(a) Dev server on this EC2.** `npm run web:dev` serves on port 8081 (reads `.env.dev`, see above). On the Mac:

    ssh -L 8081:localhost:8081 ubuntu@<host>

then open `http://localhost:8081`. The browser calls the dev API directly; CORS allows that origin.

**(b) The deployed build** at `web_url` (`terraform -chdir=infra/envs/dev output -raw web_url`, a
`https://<id>.cloudfront.net` address). Publish with `npm run deploy:web` (runs `tools/deploy_web.sh --env dev`:
export, upload with cache headers, `index.html` last, invalidation). The export is heavy; run it alone.
The privacy page is at `<web_url>/privacy/` (a draft, source in `public/privacy/index.html`).
