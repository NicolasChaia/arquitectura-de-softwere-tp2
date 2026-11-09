// Distribución de resultados y latencias de ARCA con DNIs aleatorios del rango válido.
// Uso: node arca-distribucion.mjs http://localhost:18080/validar 5000 20
const [URL_, N_ = "5000", C_ = "20"] = process.argv.slice(2);
const N = Number(N_), CONC = Number(C_);
const rnd = () => String(Math.floor(Math.random() * (99999999 - 1000000 + 1)) + 1000000);
async function call(dni) {
  const t0 = performance.now();
  const r = await fetch(URL_, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dni }) });
  const txt = await r.text(); const ms = performance.now() - t0;
  let body = null; try { body = JSON.parse(txt); } catch {}
  const kind = r.status >= 500 ? "error" : body?.ok === true ? "approved" : body?.ok === false ? "rejected" : `other${r.status}`;
  return { kind, ms };
}
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const out = []; const dnis = Array.from({ length: N }, rnd); let i = 0;
await Promise.all(Array.from({ length: CONC }, async () => { while (i < dnis.length) out.push(await call(dnis[i++])); }));
console.log(`== ${N} DNIs aleatorios, concurrencia ${CONC}`);
for (const k of ["approved", "rejected", "error"]) {
  const xs = out.filter(o => o.kind === k).map(o => o.ms);
  console.log(`${k.padEnd(9)} n=${String(xs.length).padStart(5)} (${(100 * xs.length / N).toFixed(1)}%)  min=${q(xs,0).toFixed(0)} p50=${q(xs,.5).toFixed(0)} p95=${q(xs,.95).toFixed(0)} max=${Math.max(...xs).toFixed(0)} ms`);
}
const other = out.filter(o => o.kind.startsWith("other")); if (other.length) console.log("otros:", other.length);
