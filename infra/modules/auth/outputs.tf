output "user_pool_id" {
  value = aws_cognito_user_pool.main.id
}

output "user_pool_arn" {
  value = aws_cognito_user_pool.main.arn
}

output "app_client_id" {
  value = aws_cognito_user_pool_client.app.id
}

output "smoke_client_id" {
  value = var.enable_test_client ? aws_cognito_user_pool_client.smoke[0].id : null
}

output "issuer_url" {
  value = "https://cognito-idp.${data.aws_region.current.region}.amazonaws.com/${aws_cognito_user_pool.main.id}"
}
