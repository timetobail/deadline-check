resource "azurerm_linux_function_app" "f" {
  site_config {
    application_stack {
      node_version = "22"
    }
  }
}
