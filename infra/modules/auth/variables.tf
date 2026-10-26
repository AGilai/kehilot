variable "name_prefix" {
  type = string
}

variable "enable_test_client" {
  description = "Adds a client allowing ADMIN_USER_PASSWORD_AUTH, used only by tools/smoke_dev.py. Dev only."
  type        = bool
  default     = false
}
