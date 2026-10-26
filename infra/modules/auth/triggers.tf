# Cognito triggers: link federated sign-ins to the native account, and send he/en emails.
# The pool references this function, so the role policy cannot name the pool ARN (that would be a cycle):
# it is scoped to pools of this account and region instead.

data "aws_iam_policy_document" "triggers_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "triggers" {
  name                 = local.triggers_name
  path                 = "/kehilot/"
  assume_role_policy   = data.aws_iam_policy_document.triggers_assume.json
  permissions_boundary = var.boundary_arn
}

data "aws_iam_policy_document" "triggers" {
  statement {
    actions = [
      "cognito-idp:AdminGetUser", "cognito-idp:AdminCreateUser", "cognito-idp:AdminSetUserPassword",
      "cognito-idp:AdminUserGlobalSignOut", "cognito-idp:AdminUpdateUserAttributes",
      "cognito-idp:AdminConfirmSignUp", "cognito-idp:AdminDeleteUser", "cognito-idp:AdminLinkProviderForUser",
    ]
    resources = ["arn:aws:cognito-idp:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:userpool/*"]
  }
  statement {
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.triggers.arn}:*"]
  }
}

resource "aws_iam_role_policy" "triggers" {
  name   = "triggers"
  role   = aws_iam_role.triggers.id
  policy = data.aws_iam_policy_document.triggers.json
}

resource "aws_cloudwatch_log_group" "triggers" {
  name              = "/aws/lambda/${local.triggers_name}"
  retention_in_days = var.log_retention_days
}

# No depends_on on the role policy: the pool depends on this function, so that would be a cycle.
resource "aws_lambda_function" "triggers" {
  function_name    = local.triggers_name
  role             = aws_iam_role.triggers.arn
  runtime          = "python3.12"
  architectures    = ["arm64"]
  handler          = "server.cloud.cognito_triggers.handler"
  filename         = var.lambda_zip
  source_code_hash = filebase64sha256(var.lambda_zip)
  memory_size      = 256
  timeout          = 5

  depends_on = [aws_cloudwatch_log_group.triggers]
}

resource "aws_lambda_permission" "cognito" {
  statement_id  = "AllowCognitoInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.triggers.function_name
  principal     = "cognito-idp.amazonaws.com"
  source_arn    = aws_cognito_user_pool.main.arn
}
