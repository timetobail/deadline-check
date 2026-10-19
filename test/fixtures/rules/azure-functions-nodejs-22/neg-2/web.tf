resource "azurerm_linux_web_app" "w" {
  site_config {
    application_stack {
      node_version = "22-lts"
    }
  }
}
