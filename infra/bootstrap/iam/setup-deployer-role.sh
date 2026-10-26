#!/usr/bin/env bash
# One-time setup, run by an account administrator in AWS CloudShell (eu-central-1).
# Creates the kehilot-deployer role, limited to kehilot-* resources by a permissions boundary,
# and attaches it to the development EC2 instance so Terraform there needs no access keys.
#
# Usage: bash setup-deployer-role.sh <ec2-instance-id>
# Safe to re-run: existing items are kept, and the policies are updated to this version.
set -euo pipefail

INSTANCE_ID="${1:?usage: bash setup-deployer-role.sh <ec2-instance-id>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
REGION="${AWS_REGION:-eu-central-1}"
ROLE=kehilot-deployer
BOUNDARY_ARN="arn:aws:iam::${ACCOUNT_ID}:policy/kehilot/kehilot-boundary"
PERMS_ARN="arn:aws:iam::${ACCOUNT_ID}:policy/kehilot/kehilot-deployer"
DOC="$(sed "s/ACCOUNT_ID/${ACCOUNT_ID}/g" "$HERE/kehilot-permissions.json")"

echo "Account ${ACCOUNT_ID}, region ${REGION}, instance ${INSTANCE_ID}"

upsert_policy() { # name arn
  if aws iam get-policy --policy-arn "$2" >/dev/null 2>&1; then
    # Keep at most 5 versions: drop the oldest non-default one first.
    old=$(aws iam list-policy-versions --policy-arn "$2" \
      --query 'Versions[?IsDefaultVersion==`false`]|sort_by(@,&CreateDate)[0].VersionId' --output text)
    count=$(aws iam list-policy-versions --policy-arn "$2" --query 'length(Versions)' --output text)
    if [ "$count" -ge 5 ] && [ "$old" != "None" ]; then
      aws iam delete-policy-version --policy-arn "$2" --version-id "$old"
    fi
    aws iam create-policy-version --policy-arn "$2" --policy-document "$DOC" --set-as-default >/dev/null
    echo "updated policy $1"
  else
    aws iam create-policy --policy-name "$1" --path /kehilot/ --policy-document "$DOC" \
      --tags Key=project,Value=kehilot >/dev/null
    echo "created policy $1"
  fi
}

# The boundary and the deployer's own permissions are the same document: whatever the deployer
# creates must carry the boundary, so nothing it creates can do more than it can.
upsert_policy kehilot-boundary "$BOUNDARY_ARN"
upsert_policy kehilot-deployer "$PERMS_ARN"

TRUST='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
if ! aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  aws iam create-role --role-name "$ROLE" --path /kehilot/ \
    --assume-role-policy-document "$TRUST" \
    --permissions-boundary "$BOUNDARY_ARN" \
    --max-session-duration 3600 \
    --tags Key=project,Value=kehilot >/dev/null
  echo "created role $ROLE"
fi
aws iam put-role-permissions-boundary --role-name "$ROLE" --permissions-boundary "$BOUNDARY_ARN"
aws iam attach-role-policy --role-name "$ROLE" --policy-arn "$PERMS_ARN"

if ! aws iam get-instance-profile --instance-profile-name "$ROLE" >/dev/null 2>&1; then
  aws iam create-instance-profile --instance-profile-name "$ROLE" --path /kehilot/ >/dev/null
  aws iam add-role-to-instance-profile --instance-profile-name "$ROLE" --role-name "$ROLE"
  echo "created instance profile $ROLE; waiting for IAM to propagate"
  sleep 15
fi

current=$(aws ec2 describe-iam-instance-profile-associations --region "$REGION" \
  --filters "Name=instance-id,Values=${INSTANCE_ID}" "Name=state,Values=associated" \
  --query 'IamInstanceProfileAssociations[0].AssociationId' --output text)
if [ "$current" = "None" ]; then
  aws ec2 associate-iam-instance-profile --region "$REGION" --instance-id "$INSTANCE_ID" \
    --iam-instance-profile Name="$ROLE" >/dev/null
  echo "attached $ROLE to $INSTANCE_ID"
else
  echo "instance already has a profile ($current); not replacing it. Replace it by hand if intended."
fi
echo done
