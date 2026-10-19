module "eks" {
  source = "terraform-aws-modules/eks/aws"
  cluster_version = "1.31"
}
