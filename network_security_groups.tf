resource "azurerm_network_security_group" "ssh_sg" {
  name                = "ssh_sg"
  location            = var.jumpbox_region
  resource_group_name = azurerm_resource_group.tp2_resource_group.name

  security_rule {
    name                       = "SSH"
    priority                   = 1001
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "22"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }
}

resource "azurerm_network_security_group" "vmss_http_sg" {
  name                = "vmss_http_sg"
  location            = azurerm_resource_group.tp2_resource_group.location
  resource_group_name = azurerm_resource_group.tp2_resource_group.name

  security_rule {
    name                       = "HTTP"
    priority                   = 1001
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "3000"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }
}
