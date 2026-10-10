import { config } from "./config";
const cfg = config();
async function collect() {
  for (const source of ["up", "usgs"]) {
    try {
      const res = await fetch(`${cfg.url}/api/admin/collect`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.ADMIN_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ source }),
        signal: AbortSignal.timeout(55000),
      });
      console.log(new Date().toISOString(), await res.json());
    } catch (e) {
      console.error(source, String(e));
    }
  }
}
do {
  await collect();
  if (!process.argv.includes("--watch")) break;
  await new Promise((r) => setTimeout(r, 60000));
} while (true);
