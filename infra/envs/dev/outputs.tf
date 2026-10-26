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
