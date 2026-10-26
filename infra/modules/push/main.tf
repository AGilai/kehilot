locals {
  function_name = "${var.name_prefix}-push-worker"
}

# --- Queue and dead-letter queue ---
resource "aws_sqs_queue" "dlq" {
  name                      = "${var.name_prefix}-push-dlq"
  message_retention_seconds = 1209600
  sqs_managed_sse_enabled   = true
}

resource "aws_sqs_queue" "push" {
  name                       = "${var.name_prefix}-push"
  visibility_timeout_seconds = 360
  sqs_managed_sse_enabled    = true
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq.arn
    maxReceiveCount     = 5
  })
}

# --- Expo access token: placeholder, the real value is set by hand and never overwritten ---
resource "aws_ssm_parameter" "expo_token" {
  name  = "/kehilot/${var.env_name}/expo-access-token"
  type  = "SecureString"
  value = "none"

  lifecycle {
    ignore_changes = [value]
  }
}

# --- Worker role ---
data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "worker" {
  name                 = local.function_name
  path                 = "/kehilot/"
  assume_role_policy   = data.aws_iam_policy_document.assume.json
  permissions_boundary = var.boundary_arn
}

data "aws_iam_policy_document" "worker" {
  # push_worker.py reads members, messages, channels, profiles, devices (GetItem, Query) and
  # writes tickets / removes dead devices (PutItem, DeleteItem). It never queries a GSI.
  statement {
    actions   = ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:PutItem", "dynamodb:DeleteItem"]
    resources = [var.table_arn]
  }
  statement {
    actions = [
      "sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:ChangeMessageVisibility", "sqs:GetQueueAttributes",
    ]
    resources = [aws_sqs_queue.push.arn]
  }
  statement {
    actions   = ["ssm:GetParameter"]
    resources = [aws_ssm_parameter.expo_token.arn]
  }
  statement {
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.worker.arn}:*"]
  }
}

resource "aws_iam_role_policy" "worker" {
  name   = "push-worker"
  role   = aws_iam_role.worker.id
  policy = data.aws_iam_policy_document.worker.json
}

resource "aws_cloudwatch_log_group" "worker" {
  name              = "/aws/lambda/${local.function_name}"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "worker" {
  function_name    = local.function_name
  role             = aws_iam_role.worker.arn
  runtime          = "python3.12"
  architectures    = ["arm64"]
  handler          = "server.cloud.push_worker.handler"
  filename         = var.lambda_zip
  source_code_hash = filebase64sha256(var.lambda_zip)
  memory_size      = 256
  timeout          = 60

  environment {
    variables = {
      TABLE_NAME     = var.table_name
      PUSH_QUEUE_URL = aws_sqs_queue.push.url
      ENV_NAME       = var.env_name
    }
  }

  depends_on = [aws_cloudwatch_log_group.worker, aws_iam_role_policy.worker]
}

resource "aws_lambda_event_source_mapping" "push" {
  event_source_arn        = aws_sqs_queue.push.arn
  function_name           = aws_lambda_function.worker.arn
  batch_size              = 10
  function_response_types = ["ReportBatchItemFailures"]
}
