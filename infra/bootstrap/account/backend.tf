# Partial config: bucket is passed at init so no account ID is committed.
#   terraform init -backend-config="bucket=kehilot-tfstate-<account_id>"
terraform {
  backend "s3" {
    key          = "bootstrap/terraform.tfstate"
    region       = "il-central-1"
    use_lockfile = true
  }
}
