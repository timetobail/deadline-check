resource "aws_db_instance" "db" {
  engine         = "mysql"
  engine_version = "14.1"
}
