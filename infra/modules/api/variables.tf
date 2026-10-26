variable "name_prefix" {
  type = string
}

variable "lambda_zip" {
  description = "Path to dist/lambda/api.zip built by tools/build_lambda.py"
  type        = string
}

variable "table_name" {
  type = string
}

variable "table_arn" {
  type = string
}

variable "issuer_url" {
  type = string
}

variable "jwt_audience" {
  type = list(string)
}

variable "log_retention_days" {
  type = number
}

variable "boundary_arn" {
  description = "Permissions boundary every role must carry (policy/kehilot/kehilot-boundary)"
  type        = string
}

variable "throttle_rate" {
  type    = number
  default = 20
}

variable "throttle_burst" {
  type    = number
  default = 50
}
