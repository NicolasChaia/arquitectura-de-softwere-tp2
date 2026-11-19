// Ráfaga concurrente de POST /exchange para mostrar el rate limit (429).
const [base, nArg] = process.argv.slice(2);
const n = Number(nArg) || 700;
const body = (i) => JSON.stringify({
  baseCurrency: "USD", counterCurrency: "ARS", baseAccountId: 100, counterAccountId: 101,
  baseAmount: 100, dni: String(10000000 + i),
});
const t0 = Date.now();
const res = await Promise.all(Array.from({ length: n }, (_, i) =>
  fetch(`${base}/exchange`, { method: "POST", headers: { "Content-Type": "application/json" }, body: body(i) })
    .then(async (r) => ({ status: r.status, headers: [...r.headers], text: await r.text() }))
    .catch((e) => ({ status: "error", text: String(e.cause?.code ?? e.message) }))));
const sent = Date.now() - t0;
const counts = {};
for (const r of res) counts[r.status] = (counts[r.status] || 0) + 1;
console.log(`${n} POST /exchange concurrentes, respondidos en ${sent} ms`);
console.log("códigos:", JSON.stringify(counts));
const r429 = res.find((r) => r.status === 429);
if (r429) {
  console.log("\nuna de las respuestas 429:");
  console.log("HTTP 429");
  for (const [k, v] of r429.headers) if (k !== "date" && k !== "connection" && k !== "keep-alive") console.log(`${k}: ${v}`);
  console.log("\n" + r429.text);
} else {
  console.log("no hubo 429");
}
