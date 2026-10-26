output "api_url" {
  value = module.api.api_url
}

output "web_url" {
  value = module.web.web_url
}

output "user_pool_id" {
  value = module.auth.user_pool_id
}

output "app_client_id" {
  value = module.auth.app_client_id
}

output "smoke_client_id" {
  value = module.auth.smoke_client_id
}

output "table_name" {
  value = module.data.table_name
}

output "region" {
  value = data.aws_region.current.region
}

output "cognito_domain" {
  value = module.auth.domain
}

output "web_bucket" {
  value = module.web.bucket_name
}

output "web_distribution_id" {
  value = module.web.distribution_id
}

output "media_bucket" {
  value = module.media.bucket_name
}
