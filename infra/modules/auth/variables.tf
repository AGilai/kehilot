variable "name_prefix" {
  type = string
}

variable "enable_test_client" {
  description = "Adds a client allowing ADMIN_USER_PASSWORD_AUTH, used only by tools/smoke_dev.py. Dev only."
  type        = bool
  default     = false
}

variable "domain_prefix" {
  description = "Cognito domain prefix: <prefix>.auth.<region>.amazoncognito.com"
  type        = string
}

variable "callback_urls" {
  type = list(string)
}

variable "logout_urls" {
  type = list(string)
}

variable "identity_providers" {
  description = "Federated providers the app client accepts besides COGNITO (Google, SignInWithApple), added with Task 19"
  type        = list(string)
  default     = []
}

variable "lambda_zip" {
  description = "Path to dist/lambda/api.zip built by tools/build_lambda.py"
  type        = string
}

variable "boundary_arn" {
  type = string
}

variable "log_retention_days" {
  type = number
}
