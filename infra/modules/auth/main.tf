data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

locals {
  triggers_name = "${var.name_prefix}-cognito-triggers"
}

resource "aws_cognito_user_pool" "main" {
  name                     = "${var.name_prefix}-users"
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  password_policy {
    minimum_length                   = 8
    require_lowercase                = false
    require_uppercase                = false
    require_numbers                  = false
    require_symbols                  = false
    temporary_password_validity_days = 7
  }

  # Changing the email on an account needs a code sent to the new address first
  user_attribute_update_settings {
    attributes_require_verification_before_update = ["email"]
  }

  lambda_config {
    pre_sign_up    = aws_lambda_function.triggers.arn
    custom_message = aws_lambda_function.triggers.arn
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

  # Short-lived id/access tokens limit a stolen token after a global sign-out. The refresh token lasts
  # 10 years (the Cognito maximum) so the phone app stays signed in; sign-out and deletion revoke it.
  id_token_validity       = 15
  access_token_validity   = 15
  refresh_token_validity  = 3650
  enable_token_revocation = true
  token_validity_units {
    id_token      = "minutes"
    access_token  = "minutes"
    refresh_token = "days"
  }

  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  callback_urls                        = var.callback_urls
  logout_urls                          = var.logout_urls
  supported_identity_providers         = concat(["COGNITO"], var.identity_providers)
}

# The app never shows the hosted pages; it sends identity_provider= directly.
resource "aws_cognito_user_pool_domain" "main" {
  domain                = var.domain_prefix
  user_pool_id          = aws_cognito_user_pool.main.id
  managed_login_version = 1
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
