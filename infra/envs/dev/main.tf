data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  name_prefix  = "kehilot-dev"
  env_name     = "dev"
  auth_urls    = ["shul://auth/callback", "http://localhost:8081/auth/callback", "${module.web.web_url}/auth/callback"]
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
  domain_prefix      = "kehilot-dev"
  callback_urls      = local.auth_urls
  logout_urls        = local.auth_urls
  lambda_zip         = "${path.root}/../../../dist/lambda/api.zip"
  boundary_arn       = local.boundary_arn
  log_retention_days = 14
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
  push_queue_url     = module.push.queue_url
  push_queue_arn     = module.push.queue_arn
  user_pool_id       = module.auth.user_pool_id
  user_pool_arn      = module.auth.user_pool_arn
  cors_origins       = [module.web.web_url, "http://localhost:8081"]
}

module "push" {
  source             = "../../modules/push"
  name_prefix        = local.name_prefix
  env_name           = local.env_name
  lambda_zip         = "${path.root}/../../../dist/lambda/api.zip"
  table_name         = module.data.table_name
  table_arn          = module.data.table_arn
  log_retention_days = 14
  boundary_arn       = local.boundary_arn
}

module "jobs" {
  source              = "../../modules/jobs"
  name_prefix         = local.name_prefix
  env_name            = local.env_name
  lambda_zip          = "${path.root}/../../../dist/lambda/api.zip"
  table_name          = module.data.table_name
  table_arn           = module.data.table_arn
  token_parameter_arn = module.push.token_parameter_arn
  log_retention_days  = 14
  boundary_arn        = local.boundary_arn
}

module "web" {
  source      = "../../modules/web"
  name_prefix = local.name_prefix
}

module "observability" {
  source             = "../../modules/observability"
  name_prefix        = local.name_prefix
  alert_email        = var.alert_email
  function_names     = [module.api.function_name, module.push.function_name, module.jobs.function_name, module.auth.triggers_function_name]
  api_id             = module.api.api_id
  dlq_name           = module.push.dlq_name
  api_log_group_name = module.api.log_group_name
}
