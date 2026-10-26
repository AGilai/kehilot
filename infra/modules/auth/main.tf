data "aws_region" "current" {}

resource "aws_cognito_user_pool" "main" {
  name                     = "${var.name_prefix}-users"
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  password_policy {
    minimum_length                   = 12
    require_lowercase                = false
    require_uppercase                = false
    require_numbers                  = false
    require_symbols                  = false
    temporary_password_validity_days = 7
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }
}

resource "aws_cognito_user_pool_client" "app" {
  name                          = "${var.name_prefix}-app"
  user_pool_id                  = aws_cognito_user_pool.main.id
  generate_secret               = false
  explicit_auth_flows           = ["ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]
  prevent_user_existence_errors = "ENABLED"
}

resource "aws_cognito_user_pool_client" "smoke" {
  count               = var.enable_test_client ? 1 : 0
  name                = "${var.name_prefix}-smoke"
  user_pool_id        = aws_cognito_user_pool.main.id
  generate_secret     = false
  explicit_auth_flows = ["ALLOW_ADMIN_USER_PASSWORD_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]
}

resource "aws_cognito_user_group" "platform_admin" {
  name         = "platform-admin"
  user_pool_id = aws_cognito_user_pool.main.id
}
