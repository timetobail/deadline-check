resource "aws_elasticache_replication_group" "r" {
  engine         = "valkey"
  engine_version = "8.0"
}
