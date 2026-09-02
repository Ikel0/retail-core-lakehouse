variable "project_name" {
  description = "Nom court utilisé pour nommer les ressources."
  type        = string
  default     = "retail-core"
}

variable "environment" {
  description = "Environnement de déploiement."
  type        = string
  default     = "demo"
}

variable "aws_region" {
  description = "Région AWS cible."
  type        = string
  default     = "eu-west-3"
}

variable "raw_bucket_name" {
  description = "Nom S3 globalement unique pour les zones raw et curated."
  type        = string
}

variable "lambda_package_path" {
  description = "Chemin relatif au module vers l'archive du validateur Lambda."
  type        = string
  default     = "../../dist/validate_kinesis_event.zip"
}
