variable "alert_email" {
  description = "Where budget alerts go. Set in terraform.tfvars (gitignored), never in git."
  type        = string
}

variable "monthly_budget_usd" {
  type    = number
  default = 25
}
