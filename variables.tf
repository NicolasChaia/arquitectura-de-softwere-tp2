variable "azure_sid" {
  sensitive = true
}

variable "datadog_key" {
  sensitive = true
}

variable "dockerhub_username" {
  sensitive = true
}

variable "dockerhub_token" {
  sensitive = true
}

variable "region" {
  default = "eastus"
}

variable "ssh_key_group_name" {
  default = "keys"
}

variable "ssh_key_name" {
  default = "SSH-KEY"
}

variable "os_publisher" {
  default = "Canonical"
}

variable "os_offer" {
  default = "ubuntu-24_04-lts"
}

variable "os_sku" {
  default = "server"
}

variable "os_version" {
  default = "latest"
}

variable "machine_sku" {
  default = "Standard_D2as_v4"
}

# Free Trial: 4 vCPU por región. Jumpbox (machine_sku, 2 vCPU) + 2 nodos de 1 vCPU = 4.
# Es el único SKU de 1 vCPU sin créditos de CPU que eastus ofrece a la suscripción
# (perf/results/2-nodos/sku-1vcpu-eastus.txt). Solo admite disco NVMe e imagen Gen2.
variable "node_sku" {
  default = "Standard_F1as_v7"
}