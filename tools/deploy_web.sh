#!/usr/bin/env bash
# Build the web app and publish it to the environment's S3 bucket + CloudFront.
# Usage: bash tools/deploy_web.sh --env dev
set -euo pipefail

ENV_NAME=""
while [ $# -gt 0 ]; do
  case "$1" in
    --env) ENV_NAME="${2:-}"; shift 2 ;;
    *) echo "usage: $0 --env dev" >&2; exit 2 ;;
  esac
done
if [ "$ENV_NAME" != "dev" ]; then
  echo "only --env dev is supported for now" >&2
  exit 2
fi

cd "$(dirname "$0")/.."
tf_out() { terraform -chdir="infra/envs/$ENV_NAME" output -raw "$1"; }

BUCKET="$(tf_out web_bucket)"
DIST_ID="$(tf_out web_distribution_id)"
WEB_URL="$(tf_out web_url)"

DIST=dist/web
# Start from an empty output dir and a cleared Metro cache: EXPO_PUBLIC_* values are inlined at build time,
# and a cached fixture build would otherwise ship fixture data with no API URL.
rm -rf "$DIST"
npm run export:web -- --clear

[ -f "$DIST/index.html" ] || { echo "missing $DIST/index.html after export" >&2; exit 1; }
# Checked before any sync: sync --delete would otherwise remove the live privacy page.
[ -f "$DIST/privacy/index.html" ] || { echo "missing $DIST/privacy/index.html after export" >&2; exit 1; }
[ -f "$DIST/terms/index.html" ] || { echo "missing $DIST/terms/index.html after export" >&2; exit 1; }
# The platform contact is not in git: fill it into both pages; stops here (before any sync) when it is missing or invalid.
python3 tools/fill_contact.py --env "$ENV_NAME" --dist "$DIST"
API_URL="$(tf_out api_url)"
if ! grep -rqF "${API_URL%/}" "$DIST/_expo/static/js"; then
  echo "the bundle does not contain the $ENV_NAME API URL; refusing to deploy" >&2
  exit 1
fi

# 1. New files first, nothing deleted: a client still on the old index.html keeps finding its old bundles.
#    Everything except index.html: no-cache by default, then hashed assets as immutable.
aws s3 sync "$DIST" "s3://$BUCKET" --exclude index.html \
  --exclude "_expo/static/*" --cache-control "no-cache"
aws s3 sync "$DIST/_expo/static" "s3://$BUCKET/_expo/static" \
  --cache-control "public,max-age=31536000,immutable"
# sync's guessed type for .html is text/html; make the privacy page explicit.
if [ -f "$DIST/privacy/index.html" ]; then
  aws s3 cp "$DIST/privacy/index.html" "s3://$BUCKET/privacy/index.html" \
    --content-type "text/html; charset=utf-8" --cache-control "no-cache"
fi
if [ -f "$DIST/terms/index.html" ]; then
  aws s3 cp "$DIST/terms/index.html" "s3://$BUCKET/terms/index.html" \
    --content-type "text/html; charset=utf-8" --cache-control "no-cache"
fi

# 2. index.html next, so it never points at assets that are not uploaded yet.
aws s3 cp "$DIST/index.html" "s3://$BUCKET/index.html" \
  --content-type "text/html; charset=utf-8" --cache-control "no-cache"

# 3. Prune last: old hashed files go only after the new index.html is live.
aws s3 sync "$DIST" "s3://$BUCKET" --delete --exclude index.html \
  --exclude "_expo/static/*" --cache-control "no-cache"
aws s3 sync "$DIST/_expo/static" "s3://$BUCKET/_expo/static" --delete \
  --cache-control "public,max-age=31536000,immutable"

# 4. Invalidate the entry points.
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths /index.html /privacy /privacy/ '/privacy/*' /terms /terms/ '/terms/*' >/dev/null

echo "Deployed to $WEB_URL"
