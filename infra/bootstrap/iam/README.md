# kehilot-deployer role (one-time, by an account admin)

Gives the development EC2 instance a role that can manage only `kehilot-*` resources, so Terraform runs
there without access keys. A permissions boundary (`kehilot-boundary`) caps the role and every role it
creates; the role cannot create IAM users or access keys, or change its own guardrails.

Run in AWS CloudShell (region eu-central-1), with the two files from this folder:

    bash setup-deployer-role.sh <ec2-instance-id>

Scope notes: Cognito, API Gateway and ACM are limited by region (eu-central-1, il-central-1, us-east-1)
rather than by name, and CloudFront is account-wide, because those services have no name-based ARNs at
creation time. Route 53 is not included: DNS delegation for the app subdomain is done by hand.

## Next: account bootstrap

After the role exists, `infra/bootstrap/account` creates the Terraform state bucket
(`kehilot-tfstate-<account_id>`) and the `kehilot-monthly` budget. Put `alert_email` in
`infra/bootstrap/account/terraform.tfvars` (gitignored), then:

    terraform -chdir=infra/bootstrap/account init -backend-config="bucket=kehilot-tfstate-<account_id>"
    terraform -chdir=infra/bootstrap/account plan -out=boot.tfplan && terraform -chdir=infra/bootstrap/account apply boot.tfplan

(On a brand-new account, run the first apply with the `backend.tf` block removed, then add it back and
`init -migrate-state`.) The budget counts only costs tagged `project=kehilot`; activate the `project` tag
once in Billing → Cost allocation tags.
