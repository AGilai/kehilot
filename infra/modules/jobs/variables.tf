variable "name_prefix" {
  type = string
}

variable "env_name" {
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

variable "token_parameter_arn" {
  description = "SSM parameter holding the Expo access token"
  type        = string
}

variable "log_retention_days" {
  type = number
}

variable "boundary_arn" {
  description = "Permissions boundary every role must carry (policy/kehilot/kehilot-boundary)"
  type        = string
}

variable "push_queue_url" {
  description = "Push SQS queue URL (PUSH_QUEUE_URL for seat_reminders)"
  type        = string
}

variable "push_queue_arn" {
  description = "Push SQS queue ARN (sqs:SendMessage)"
  type        = string
}

variable "seat_reminders_state" {
  description = "State of the seat_reminders schedule"
  type        = string
  default     = "ENABLED"

  validation {
    condition     = contains(["ENABLED", "DISABLED"], var.seat_reminders_state)
    error_message = "seat_reminders_state must be ENABLED or DISABLED."
  }
}
