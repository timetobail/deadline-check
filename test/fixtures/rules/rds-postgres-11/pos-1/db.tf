resource "aws_db_instance" "db" {
  engine         = "postgres"
  engine_version = "11"
}
