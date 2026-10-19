module "gke" {
  source = "terraform-google-modules/kubernetes-engine/google"
  kubernetes_version = "1.35"
}
