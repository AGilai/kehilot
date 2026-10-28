locals {
  function_name = "${var.name_prefix}-jobs"
}

data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

# --- Jobs Lambda role ---
resource "aws_iam_role" "jobs" {
  name                 = local.function_name
  path                 = "/kehilot/"
  assume_role_policy   = data.aws_iam_policy_document.assume.json
  permissions_boundary = var.boundary_arn
}

data "aws_iam_policy_document" "jobs" {
  # push_receipts lists push tickets (Query) and deletes tickets and dead devices (DeleteItem).
  # seat_reminders:
  #   Query          lists the registry, families and seat-week rows it reads;
  #   GetItem        reads one setting, layout, family or SEATWK row;
  #   BatchGetItem   reads a family's adults' memberships;
  #   PutItem        claims the conditional SEATREM#<friday>#<n> marker (once-only send);
  #   UpdateItem     updates registry and family rows the repo layer touches;
  #   DeleteItem     releases a SEATREM marker when queueing fails;
  #   Scan           the one-time registry backfill.
  statement {
    actions = [
      "dynamodb:Query",
      "dynamodb:GetItem",
      "dynamodb:BatchGetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      "dynamodb:Scan",
    ]
    resources = [var.table_arn]
  }
  # seat_reminders queues one seat_reminder job per Kehila on the push queue.
  statement {
    actions   = ["sqs:SendMessage"]
    resources = [var.push_queue_arn]
  }
  statement {
    actions   = ["ssm:GetParameter"]
    resources = [var.token_parameter_arn]
  }
  statement {
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.jobs.arn}:*"]
  }
}

resource "aws_iam_role_policy" "jobs" {
  name   = "jobs"
  role   = aws_iam_role.jobs.id
  policy = data.aws_iam_policy_document.jobs.json
}

resource "aws_cloudwatch_log_group" "jobs" {
  name              = "/aws/lambda/${local.function_name}"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "jobs" {
  function_name    = local.function_name
  role             = aws_iam_role.jobs.arn
  runtime          = "python3.12"
  architectures    = ["arm64"]
  handler          = "server.cloud.jobs.handler"
  filename         = var.lambda_zip
  source_code_hash = filebase64sha256(var.lambda_zip)
  memory_size      = 256
  timeout          = 60

  environment {
    variables = {
      TABLE_NAME     = var.table_name
      ENV_NAME       = var.env_name
      PUSH_QUEUE_URL = var.push_queue_url
    }
  }

  depends_on = [aws_cloudwatch_log_group.jobs, aws_iam_role_policy.jobs]
}

# --- Scheduler: invokes the jobs function only ---
data "aws_iam_policy_document" "scheduler_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "scheduler" {
  name                 = "${var.name_prefix}-jobs-scheduler"
  path                 = "/kehilot/"
  assume_role_policy   = data.aws_iam_policy_document.scheduler_assume.json
  permissions_boundary = var.boundary_arn
}

data "aws_iam_policy_document" "scheduler" {
  statement {
    actions   = ["lambda:InvokeFunction"]
    resources = [aws_lambda_function.jobs.arn]
  }
}

resource "aws_iam_role_policy" "scheduler" {
  name   = "invoke-jobs"
  role   = aws_iam_role.scheduler.id
  policy = data.aws_iam_policy_document.scheduler.json
}

resource "aws_scheduler_schedule_group" "jobs" {
  name = var.name_prefix
}

resource "aws_scheduler_schedule" "push_receipts" {
  name                = "${var.name_prefix}-push-receipts"
  group_name          = aws_scheduler_schedule_group.jobs.name
  schedule_expression = "rate(15 minutes)"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.jobs.arn
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ job = "push_receipts" })

    retry_policy {
      maximum_retry_attempts       = 2
      maximum_event_age_in_seconds = 3600
    }
  }

  depends_on = [aws_iam_role_policy.scheduler]
}

resource "aws_scheduler_schedule" "seat_reminders" {
  name                         = "${var.name_prefix}-seat-reminders"
  group_name                   = aws_scheduler_schedule_group.jobs.name
  schedule_expression          = "cron(*/5 * ? * THU-FRI *)"
  schedule_expression_timezone = "Asia/Jerusalem"
  state                        = var.seat_reminders_state

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.jobs.arn
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ job = "seat_reminders" })

    # A retry never outlives the next 5-minute tick.
    retry_policy {
      maximum_retry_attempts       = 1
      maximum_event_age_in_seconds = 240
    }
  }

  depends_on = [aws_iam_role_policy.scheduler]
}
