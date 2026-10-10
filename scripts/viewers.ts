import { config } from "./config";
const production = process.argv.includes("--production");
const cfg = config(production ? ".dev.vars.production" : ".dev.vars");
const url = production ? "https://istmo.ramonfabrega.com" : cfg.url;
if (!cfg.ADMIN_TOKEN)
  throw new Error(
    "ADMIN_TOKEN is required (environment or ignored .dev.vars file).",
  );
const response = await fetch(`${url}/api/admin/viewers`, {
  headers: { Authorization: `Bearer ${cfg.ADMIN_TOKEN}` },
  signal: AbortSignal.timeout(10000),
});
if (!response.ok)
  throw new Error(`Viewer count unavailable (${response.status}).`);
const count = (await response.json()) as {
  active: number;
  windowSeconds: number;
  startedAt: number;
  capacity: number;
};
console.log(
  JSON.stringify(
    { environment: production ? "production" : "local", ...count },
    null,
    2,
  ),
);
