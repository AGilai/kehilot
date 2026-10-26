output "queue_url" {
  value = aws_sqs_queue.push.url
}

output "queue_arn" {
  value = aws_sqs_queue.push.arn
}

output "dlq_name" {
  value = aws_sqs_queue.dlq.name
}

output "function_name" {
  value = aws_lambda_function.worker.function_name
}

output "token_parameter_arn" {
  value = aws_ssm_parameter.expo_token.arn
}
