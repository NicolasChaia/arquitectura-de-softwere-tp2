#!/bin/bash
# Evidencia de la configuración desplegada, para una carpeta de resultados.
# Uso (desde WSL, en la raíz del repo o en perf/, con la infra levantada):
#   perf/evidencia-infra.sh perf/results/1-nodo
# Genera en esa carpeta:
#   terraform-state-list.txt   recursos del state (sin valores)
#   terraform-output.txt       outputs no sensibles
#   vmss-instances.txt         instancias del VMSS (az vmss list-instances)
#   nodos-lscpu.txt            CPU de cada nodo: define el factor de conversión
#                              de la calibración local (perf/predicciones.md)
#   nodos-pm2.txt              procesos de pm2 en cada nodo (cantidad y modo)
# No guarda secretos: no toca terraform.tfvars ni el state crudo.
set -euo pipefail

OUT="${1:?uso: $0 <carpeta-de-resultados>}"
ROOT="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
stamp() { echo "# $(date -u +%Y-%m-%dT%H:%M:%SZ) - $*"; }

cd "$ROOT"
{ stamp "terraform state list"; terraform state list; } > "$OUT/terraform-state-list.txt"
{ stamp "terraform output"; terraform output; } > "$OUT/terraform-output.txt"
{ stamp "az vmss list-instances"; az vmss list-instances -g tp2_resource_group -n tp2vmss \
    --query "[].{name:name, sku:sku.name, zone:zones[0], state:provisioningState}" -o table; } > "$OUT/vmss-instances.txt"

cd "$ROOT/ansible"
./update_vmss_inventory.sh
ANS=(ansible vmss -i vmss_hosts --private-key ../key.pem -u azureuser)
{ stamp "lscpu en cada nodo"; "${ANS[@]}" -a "lscpu"; } > "$OUT/nodos-lscpu.txt"
{ stamp "pm2 list en cada nodo"; "${ANS[@]}" -a "pm2 list"; } > "$OUT/nodos-pm2.txt"

grep -h "Model name\|^Thread(s) per core\|^CPU(s):" "$OUT/nodos-lscpu.txt" | sort | uniq -c
echo "listo: evidencia en $OUT"
