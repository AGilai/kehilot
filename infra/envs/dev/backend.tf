# Partial config: terraform init -backend-config="bucket=kehilot-tfstate-<account_id>"
terraform {
  backend "s3" {
    key          = "dev/terraform.tfstate"
    region       = "il-central-1"
    use_lockfile = true
  }
}
