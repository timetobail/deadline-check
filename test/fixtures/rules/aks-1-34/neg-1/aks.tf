resource "azurerm_kubernetes_cluster" "k" {
  kubernetes_version = "1.34"
  support_plan = "AKSLongTermSupport"
}
