# Shared storage for every node of the VMSS (accounts, rates and exchange log).
# Azure Managed Redis, platform as a service.

# The instance name becomes part of a public DNS name, so it must be globally unique
resource "random_string" "redis_name" {
  length  = 10
  lower   = true
  upper   = false
  special = false
  numeric = false
}

resource "azurerm_managed_redis" "tp2_redis" {
  name                = "tp2redis-${random_string.redis_name.result}"
  resource_group_name = azurerm_resource_group.tp2_resource_group.name
  location            = azurerm_resource_group.tp2_resource_group.location

  # Smallest Balanced SKU. Can be scaled up later (scaling down is not supported)
  sku_name = "Balanced_B0"

  # No replica: halves the cost; acceptable for a TP (no availability SLA).
  # Changing this forces a new instance.
  high_availability_enabled = false

  default_database {
    # Needed to get primary_access_key (defaults to false)
    access_keys_authentication_enabled = true

    # TLS on port 10000
    client_protocol = "Encrypted"

    # The app runs Lua scripts and MULTI over several keys (e.g. account:1 and
    # account:2 in the same script). With OSSCluster (default) or
    # EnterpriseCluster those fail with CROSSSLOT, so no sharding at all.
    # Changing this recreates the database (data loss).
    clustering_policy = "NoCluster"

    # Accounts/rates/log must never be silently evicted
    eviction_policy = "NoEviction"
  }
}

# Connection data for the node app (node/config.js reads it). It contains the
# access key, so it is git-ignored and written as a sensitive file (the key is
# not printed by terraform apply). node/zip ships it to the VMSS nodes.
resource "local_sensitive_file" "redis_config" {
  filename        = "${path.module}/node/redis.json"
  file_permission = "0600"
  content = jsonencode({
    host     = azurerm_managed_redis.tp2_redis.hostname
    port     = azurerm_managed_redis.tp2_redis.default_database[0].port
    password = azurerm_managed_redis.tp2_redis.default_database[0].primary_access_key
    tls      = true
  })
}

# Non-sensitive, for evidence (terraform output)
output "redis_hostname" {
  value = azurerm_managed_redis.tp2_redis.hostname
}