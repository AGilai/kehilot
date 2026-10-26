terraform {
  required_version = ">= 1.11"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "= 6.70.0"
    }
  }
}

provider "aws" {
  region = "il-central-1"
  default_tags {
    tags = { project = "kehilot", env = "dev" }
  }
}
