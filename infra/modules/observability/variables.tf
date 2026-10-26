variable "name_prefix" {
  type = string
}

variable "alert_email" {
  type = string
}

variable "function_names" {
  type = list(string)
}

variable "api_id" {
  type = string
}

variable "dlq_name" {
  type = string
}

variable "api_log_group_name" {
  description = "API Lambda log group; scanned for failed push enqueues"
  type        = string
}
