// Arranca la app
// ARCA_URI=http://localhost:18080 REDIS_URL=redis://localhost:16379 node app-local.mjs
const { default: config } = await import("../../node/config.js");
if (!process.env.ARCA_URI) throw new Error("falta ARCA_URI");
config.arcaUri = process.env.ARCA_URI;
await import("../../node/app.js");
