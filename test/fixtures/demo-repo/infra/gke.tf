resource "google_container_cluster" "shop" {
  name               = "shop"
  location           = "us-central1"
  min_master_version = "1.31"
}
