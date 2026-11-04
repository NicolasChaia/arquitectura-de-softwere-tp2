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