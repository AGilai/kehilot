output "api_url" {
  value = aws_apigatewayv2_stage.default.invoke_url
}

output "api_id" {
  value = aws_apigatewayv2_api.http.id
}

output "function_name" {
  value = aws_lambda_function.api.function_name
}
