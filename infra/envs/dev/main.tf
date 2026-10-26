data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  name_prefix  = "kehilot-dev"
  boundary_arn = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:policy/kehilot/kehilot-boundary"
}

module "data" {
  source              = "../../modules/data"
  name_prefix         = local.name_prefix
  pitr                = false
  deletion_protection = false
}

module "auth" {
  source             = "../../modules/auth"
  name_prefix        = local.name_prefix
  enable_test_client = true
}

module "api" {
  source             = "../../modules/api"
  name_prefix        = local.name_prefix
  lambda_zip         = "${path.root}/../../../dist/lambda/api.zip"
  table_name         = module.data.table_name
  table_arn          = module.data.table_arn
  issuer_url         = module.auth.issuer_url
  jwt_audience       = compact([module.auth.app_client_id, module.auth.smoke_client_id])
  log_retention_days = 14
  boundary_arn       = local.boundary_arn
}

module "web" {
  source      = "../../modules/web"
  name_prefix = local.name_prefix
}

module "observability" {
  source         = "../../modules/observability"
  name_prefix    = local.name_prefix
  alert_email    = var.alert_email
  function_names = [module.api.function_name]
  api_id         = module.api.api_id
}
