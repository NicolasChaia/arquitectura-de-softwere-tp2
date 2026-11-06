terraform {
  required_version = "~>1.3"
  
  cloud {
    organization = "arqsoft-tp2-squel"

    workspaces {
      name = "tp2"
    }
  }

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~>4.80"
    }

    local = {
      source  = "hashicorp/local"
      version = "~>2.2"
    }

    random = {
      source  = "hashicorp/random"
      version = "~>3.0"
    }
  }
}
