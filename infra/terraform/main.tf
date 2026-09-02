locals {
  resource_prefix = "${var.project_name}-${var.environment}"
  lambda_package  = "${path.module}/${var.lambda_package_path}"
}

resource "aws_s3_bucket" "lakehouse" {
  bucket = var.raw_bucket_name
}

resource "aws_s3_bucket_public_access_block" "lakehouse" {
  bucket                  = aws_s3_bucket.lakehouse.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "lakehouse" {
  bucket = aws_s3_bucket.lakehouse.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "lakehouse" {
  bucket = aws_s3_bucket.lakehouse.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "lakehouse" {
  bucket = aws_s3_bucket.lakehouse.id
  rule {
    id     = "raw-cost-control"
    status = "Enabled"
    filter {
      prefix = "raw/"
    }
    transition {
      days          = 30
      storage_class = "STANDARD_IA"
    }
    transition {
      days          = 90
      storage_class = "GLACIER_IR"
    }
  }
}

resource "aws_kinesis_stream" "retail_events" {
  name             = "${local.resource_prefix}-events"
  shard_count      = 1
  retention_period = 24
  encryption_type  = "KMS"
  kms_key_id       = "alias/aws/kinesis"

  shard_level_metrics = [
    "IncomingBytes",
    "IncomingRecords",
    "WriteProvisionedThroughputExceeded",
  ]
}

data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "event_validator" {
  name               = "${local.resource_prefix}-event-validator"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

resource "aws_iam_role_policy" "event_validator" {
  name = "least-privilege-data-access"
  role = aws_iam_role.event_validator.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:PutObject"]
        Resource = ["${aws_s3_bucket.lakehouse.arn}/raw/events/*"]
      },
      {
        Effect   = "Allow"
        Action   = ["kinesis:DescribeStream", "kinesis:GetRecords", "kinesis:GetShardIterator"]
        Resource = [aws_kinesis_stream.retail_events.arn]
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = ["${aws_cloudwatch_log_group.event_validator.arn}:*"]
      },
    ]
  })
}

resource "aws_cloudwatch_log_group" "event_validator" {
  name              = "/aws/lambda/${local.resource_prefix}-event-validator"
  retention_in_days = 30
}

resource "aws_lambda_function" "event_validator" {
  function_name    = "${local.resource_prefix}-event-validator"
  role             = aws_iam_role.event_validator.arn
  handler          = "validate_kinesis_event.handler"
  runtime          = "python3.12"
  filename         = local.lambda_package
  source_code_hash = filebase64sha256(local.lambda_package)
  timeout          = 30
  memory_size      = 256

  environment {
    variables = {
      SCHEMA_VERSION = "retail-event/2.1"
    }
  }

  depends_on = [aws_cloudwatch_log_group.event_validator]
}

resource "aws_cloudwatch_metric_alarm" "kinesis_throttling" {
  alarm_name          = "${local.resource_prefix}-kinesis-write-throttling"
  alarm_description   = "Détecte un manque de capacité d'écriture sur le flux retail."
  namespace           = "AWS/Kinesis"
  metric_name         = "WriteProvisionedThroughputExceeded"
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 2
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  dimensions = {
    StreamName = aws_kinesis_stream.retail_events.name
  }
}

resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  alarm_name          = "${local.resource_prefix}-lambda-errors"
  alarm_description   = "Détecte les erreurs du validateur d'événements."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  dimensions = {
    FunctionName = aws_lambda_function.event_validator.function_name
  }
}
