resource "google_cloudfunctions2_function" "f" {
  build_config {
    runtime = "nodejs22"
  }
}
