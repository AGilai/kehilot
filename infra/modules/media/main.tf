# Brochure images: private bucket, presigned PUT into up/, checked copy into m/. Versioning stays off so a
# delete is final. force_destroy is false because the bucket holds people's content.
resource "aws_s3_bucket" "media" {
  bucket        = "${var.name_prefix}-media"
  force_destroy = false
}

resource "aws_s3_bucket_public_access_block" "media" {
  bucket                  = aws_s3_bucket.media.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "media" {
  bucket = aws_s3_bucket.media.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "media" {
  bucket = aws_s3_bucket.media.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "media" {
  bucket = aws_s3_bucket.media.id

  rule {
    id     = "expire-unattached-uploads"
    status = "Enabled"

    filter {
      prefix = "up/"
    }

    expiration {
      days = 1
    }
  }

  rule {
    id     = "expire-report-images"
    status = "Enabled"

    filter {
      prefix = "reports/"
    }

    expiration {
      days = 181 # reports live 180 days (item TTL); their pictures go a day later
    }
  }

  rule {
    id     = "expire-exports"
    status = "Enabled"

    filter {
      prefix = "x/"
    }

    expiration {
      days = 1
    }
  }

  rule {
    id     = "abort-incomplete-multipart"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "media" {
  bucket = aws_s3_bucket.media.id

  cors_rule {
    allowed_methods = ["PUT", "GET", "HEAD"]
    allowed_origins = var.cors_origins
    allowed_headers = ["content-type"]
    max_age_seconds = 600
  }
}

data "aws_iam_policy_document" "media" {
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.media.arn, "${aws_s3_bucket.media.arn}/*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "media" {
  bucket     = aws_s3_bucket.media.id
  policy     = data.aws_iam_policy_document.media.json
  depends_on = [aws_s3_bucket_public_access_block.media]
}
