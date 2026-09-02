output "lakehouse_bucket" {
  value       = aws_s3_bucket.lakehouse.id
  description = "Bucket des zones raw et curated."
}

output "event_stream_name" {
  value       = aws_kinesis_stream.retail_events.name
  description = "Nom du flux d'événements retail."
}

output "event_validator_name" {
  value       = aws_lambda_function.event_validator.function_name
  description = "Nom de la fonction de validation événementielle."
}
