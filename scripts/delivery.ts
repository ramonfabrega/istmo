import { config } from "./config";
const production = process.argv.includes("--production");
const cfg = config(production ? ".dev.vars.production" : ".dev.vars");
if (!cfg.ADMIN_TOKEN) throw new Error("ADMIN_TOKEN is required.");
const root = production ? "https://istmo.ramonfabrega.com" : cfg.url;
const response = await fetch(`${root}/api/push/delivery`, {
  headers: { Authorization: `Bearer ${cfg.ADMIN_TOKEN}` },
  signal: AbortSignal.timeout(10000),
});
if (!response.ok)
  throw new Error(`Delivery diagnostics unavailable (${response.status}).`);
console.log(JSON.stringify(await response.json(), null, 2));
