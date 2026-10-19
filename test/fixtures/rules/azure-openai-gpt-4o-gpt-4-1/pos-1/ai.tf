resource "azurerm_cognitive_deployment" "chat" {
  model {
    name    = "gpt-4.1-mini"
    version = "2025-04-14"
