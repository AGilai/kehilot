# dev environment

Runs from this EC2 with the `kehilot-deployer` instance role (no keys).

    python3 tools/build_lambda.py                      # dist/lambda/api.zip
    terraform -chdir=infra/envs/dev init -backend-config="bucket=kehilot-tfstate-<account_id>"
    terraform -chdir=infra/envs/dev plan -out=dev.tfplan
    terraform -chdir=infra/envs/dev apply dev.tfplan
    .venv/bin/python tools/smoke_dev.py                # end-to-end check

`terraform.tfvars` (gitignored) holds `alert_email`.
