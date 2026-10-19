resource "aws_elasticache_replication_group" "r" {
  engine         = "redis"
  engine_version = "6.2"
}
