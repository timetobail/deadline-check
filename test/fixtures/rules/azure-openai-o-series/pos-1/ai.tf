resource "azurerm_cognitive_deployment" "d" {
  model {
    name    = "o3-mini"
    version = "2025-01-31"
