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

# Region for the jumpbox only (see network.tf): another region has its own
# 4 vCPU Free Trial quota. SSH-only traffic, so the distance does not matter.
variable "jumpbox_region" {
  default = "eastus2"
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