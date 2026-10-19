resource "aws_rds_cluster" "db" {
  engine         = "aurora-postgresql"
  engine_version = "12.22"
}
