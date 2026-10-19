resource "azurerm_cognitive_deployment" "stt" {
  model {
    name = "gpt-4o-mini-transcribe"
