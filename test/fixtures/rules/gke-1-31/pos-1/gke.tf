resource "google_container_cluster" "c" {
  min_master_version = "1.31.5-gke.1000"
}
