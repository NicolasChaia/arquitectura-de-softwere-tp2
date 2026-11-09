const URL_ = process.argv[2];
const rnd = () => String(Math.floor(Math.random() * (99999999 - 1000000 + 1)) + 1000000);
async function kind(dni) {
  const r = await fetch(URL_, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dni }) });
  const b = await r.json().catch(() => null);
  return r.status >= 500 ? "E" : b?.ok ? "A" : "R";
}
const pats = {}; const byNonError = { allA: 0, allR: 0, mixed: 0 };
const dnis = Array.from({ length: 200 }, rnd);
await Promise.all(dnis.map(async d => {
  const ks = []; for (let i = 0; i < 6; i++) ks.push(await kind(d));
  const p = ks.slice().sort().join(""); pats[p] = (pats[p] || 0) + 1;
  const ne = ks.filter(k => k !== "E");
  if (ne.length) byNonError[ne.every(k => k === "A") ? "allA" : ne.every(k => k === "R") ? "allR" : "mixed"]++;
}));
const totE = Object.entries(pats).reduce((s, [p, n]) => s + n * [...p].filter(c => c === "E").length, 0);
console.log("errores sobre 1200 llamadas:", totE, (100 * totE / 1200).toFixed(1) + "%");
console.log("DNIs (sin contar los E): siempre aprobado", byNonError.allA, "| siempre rechazado", byNonError.allR, "| mezclado", byNonError.mixed);
console.log("patrones más comunes:", Object.entries(pats).sort((a, b) => b[1] - a[1]).slice(0, 8));
