resource "azurerm_cognitive_deployment" "stt" {
  model {
    format  = "OpenAI"
    name    = "whisper"
    version = "001"
