#!/bin/bash
# Métricas de Azure Monitor de ARCA (Container Instances) y de Managed Redis
# para el rango de una prueba de Artillery. Ninguno de los dos tiene agente de
# Datadog, así que esta es la evidencia de si se saturaron.
#
# Uso (desde WSL, con `az login` hecho y la infra levantada):
#   ./azure-metrics.sh results/1-nodo/exchange-stress.json
# Genera, al lado del reporte:
#   results/1-nodo/exchange-stress-azure.txt   (tabla por minuto, para leer)
#   results/1-nodo/exchange-stress-azure.json  (respuesta cruda de az)
#
# El rango sale del propio reporte (aggregate.firstMetricAt / lastMetricAt),
# con 1 minuto de margen de cada lado porque Azure agrega por minuto.
# Conviene correrlo unos 3-5 minutos después de la prueba: Azure Monitor
# publica las métricas con algo de demora.
set -euo pipefail

REPORT="${1:?uso: $0 <reporte-artillery.json>}"
RG="${RG:-tp2_resource_group}"
OUT="${REPORT%.json}-azure"

read -r START END < <(python3 - "$REPORT" <<'EOF'
import json, sys, datetime as dt
a = json.load(open(sys.argv[1]))["aggregate"]
iso = lambda ms: dt.datetime.fromtimestamp(ms / 1000, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
print(iso(a["firstMetricAt"] - 60_000), iso(a["lastMetricAt"] + 60_000))
EOF
)

ARCA_ID=$(az container list -g "$RG" --query "[0].id" -o tsv)
REDIS_ID=$(az resource list -g "$RG" --resource-type Microsoft.Cache/redisEnterprise --query "[0].id" -o tsv)

# Pide solo las métricas que el recurso realmente expone.
available() {
  local id="$1"; shift
  local defs
  defs=$(az monitor metrics list-definitions --resource "$id" --query "[].name.value" -o tsv)
  for m in "$@"; do
    if grep -qx "$m" <<<"$defs"; then echo -n "$m "; else echo "aviso: $m no existe en $(basename "$id")" >&2; fi
  done
}

ARCA_METRICS=$(available "$ARCA_ID" CpuUsage MemoryUsage NetworkBytesReceivedPerSecond NetworkBytesTransmittedPerSecond)
REDIS_METRICS=$(available "$REDIS_ID" percentProcessorTime serverLoad usedmemorypercentage operationsPerSecond connectedclients)

fetch() {
  # shellcheck disable=SC2086
  az monitor metrics list --resource "$1" --metrics $2 \
    --start-time "$START" --end-time "$END" --interval PT1M \
    --aggregation Average Maximum -o json
}

{
  echo '{"arca":'; fetch "$ARCA_ID" "$ARCA_METRICS"
  echo ',"redis":'; fetch "$REDIS_ID" "$REDIS_METRICS"
  echo "}"
} > "$OUT.json"

python3 - "$OUT.json" "$REPORT" "$START" "$END" > "$OUT.txt" <<'EOF'
import json, sys
data, report, start, end = json.load(open(sys.argv[1])), sys.argv[2], sys.argv[3], sys.argv[4]
print(f"Azure Monitor para {report}")
print(f"Rango (UTC): {start} -> {end}, granularidad 1 minuto\n")
for name, label in (("arca", "ARCA (Container Instances, 0.5 vCPU = 500 millicores)"), ("redis", "Managed Redis")):
    print(f"== {label}")
    for metric in data[name]["value"]:
        unit = metric.get("unit", "")
        print(f"-- {metric['name']['value']} ({unit})")
        for series in metric["timeseries"]:
            for p in series["data"]:
                avg, mx = p.get("average"), p.get("maximum")
                if avg is None and mx is None:
                    continue
                extra = ""
                if metric["name"]["value"] == "CpuUsage" and mx is not None:
                    extra = f"   (max = {100 * mx / 500:.0f}% de 0.5 vCPU)"
                print(f"   {p['timeStamp']}  avg={avg if avg is not None else '-':>12}  max={mx if mx is not None else '-':>12}{extra}")
    print()
EOF

echo "listo: $OUT.txt y $OUT.json"
