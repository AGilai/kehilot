# Private bucket behind CloudFront (Origin Access Control). SPA: unknown paths serve index.html.
resource "aws_s3_bucket" "web" {
  bucket        = "${var.name_prefix}-web"
  force_destroy = true # content is rebuilt from the repo, never the only copy
}

resource "aws_s3_bucket_public_access_block" "web" {
  bucket                  = aws_s3_bucket.web.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_cloudfront_origin_access_control" "web" {
  name                              = "${var.name_prefix}-web"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

resource "aws_cloudfront_response_headers_policy" "web" {
  name    = "${var.name_prefix}-web-security"
  comment = "Security headers for the web app (no CSP yet)"

  security_headers_config {
    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = false
      preload                    = false
      override                   = true
    }
    content_type_options {
      override = true
    }
    frame_options {
      frame_option = "DENY"
      override     = true
    }
    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }
  }
}

# The static /privacy/ page is its own file. S3 has no directory index, and the 403/404 -> index.html
# fallback below would otherwise turn /privacy/ into the SPA, so map it to /privacy/index.html.
resource "aws_cloudfront_function" "privacy_index" {
  name    = "${var.name_prefix}-privacy-index"
  runtime = "cloudfront-js-2.0"
  comment = "Serve /privacy and /privacy/ from privacy/index.html"
  publish = true
  code    = <<-JS
    function handler(event) {
      var request = event.request;
      if (request.uri === '/privacy' || request.uri === '/privacy/') {
        request.uri = '/privacy/index.html';
      }
      return request;
    }
  JS
}

resource "aws_cloudfront_distribution" "web" {
  enabled             = true
  comment             = "${var.name_prefix} web app"
  default_root_object = "index.html"
  price_class         = "PriceClass_100"

  origin {
    domain_name              = aws_s3_bucket.web.bucket_regional_domain_name
    origin_id                = "s3"
    origin_access_control_id = aws_cloudfront_origin_access_control.web.id
  }

  default_cache_behavior {
    target_origin_id       = "s3"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = data.aws_cloudfront_cache_policy.optimized.id
    compress               = true

    response_headers_policy_id = aws_cloudfront_response_headers_policy.web.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.privacy_index.arn
    }
  }

  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }

  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

data "aws_iam_policy_document" "web" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.web.arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.web.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "web" {
  bucket     = aws_s3_bucket.web.id
  policy     = data.aws_iam_policy_document.web.json
  depends_on = [aws_s3_bucket_public_access_block.web]
}

# Placeholder until the app's web build is deployed (plan 3); later deploys overwrite it.
resource "aws_s3_object" "placeholder" {
  bucket        = aws_s3_bucket.web.id
  key           = "index.html"
  source        = "${path.module}/placeholder/index.html"
  etag          = filemd5("${path.module}/placeholder/index.html")
  content_type  = "text/html; charset=utf-8"
  cache_control = "no-cache"
  lifecycle {
    ignore_changes = all
  }
}
