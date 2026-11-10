resource "random_string" "jumpbox_name" {
  length  = 10
  lower   = true
  upper   = false
  special = false
  numeric = false
}

# Create a public IP address
resource "azurerm_public_ip" "jumpbox_public_ip" {
  name                = "jumpbox_public_ip"
  location            = var.jumpbox_region
  resource_group_name = azurerm_resource_group.tp2_resource_group.name
  allocation_method   = "Static"
  sku                 = "Standard"
  domain_name_label   = random_string.jumpbox_name.result
}

# Configure NIC
resource "azurerm_network_interface" "jumpbox_nic" {
  name                = "jumpbox_nic"
  location            = var.jumpbox_region
  resource_group_name = azurerm_resource_group.tp2_resource_group.name

  ip_configuration {
    name                          = "jumpbox_nic_config"
    subnet_id                     = azurerm_subnet.tp2_sn_jumpbox.id
    private_ip_address_allocation = "Dynamic"
    public_ip_address_id          = azurerm_public_ip.jumpbox_public_ip.id
  }
}

# Associate NSG to NIC
resource "azurerm_network_interface_security_group_association" "jumpbox_nic_nsg" {
  network_interface_id      = azurerm_network_interface.jumpbox_nic.id
  network_security_group_id = azurerm_network_security_group.ssh_sg.id
}

# Create jumpbox VM
resource "azurerm_linux_virtual_machine" "jumpbox" {
  name                  = "jumpbox"
  resource_group_name   = azurerm_resource_group.tp2_resource_group.name
  location              = var.jumpbox_region
  size                  = var.machine_sku
  admin_username        = "azureuser"
  network_interface_ids = [azurerm_network_interface.jumpbox_nic.id]

  admin_ssh_key {
    username   = "azureuser"
    public_key = data.azurerm_ssh_public_key.ssh_key.public_key
  }

  os_disk {
    storage_account_type = "Standard_LRS"
    caching              = "ReadWrite"
  }

  source_image_reference {
    publisher = var.os_publisher
    offer     = var.os_offer
    sku       = var.os_sku
    version   = var.os_version
  }

  # Store the FQDN
  provisioner "local-exec" {
    command = "echo ${azurerm_public_ip.jumpbox_public_ip.fqdn} > ansible/jumpbox_dns"
  }
}
