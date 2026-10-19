resource "azurerm_kubernetes_cluster" "k" {
  kubernetes_version = "1.33"
  support_plan = "AKSLongTermSupport"
}
