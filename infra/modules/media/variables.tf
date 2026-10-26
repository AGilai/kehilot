variable "name_prefix" {
  type = string
}

variable "cors_origins" {
  description = "Origins allowed to PUT a brochure image straight to the bucket (presigned URLs)"
  type        = list(string)
}
