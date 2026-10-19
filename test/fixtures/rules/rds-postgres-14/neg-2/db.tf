resource "aws_rds_cluster" "db" {
  engine         = "aurora-postgresql"
  engine_version = "16.4"
}
