import fs from "node:fs";
import { randomBytes, createECDH } from "node:crypto";
let contents = fs.existsSync(".dev.vars")
  ? fs.readFileSync(".dev.vars", "utf8")
  : "";
if (contents && !contents.endsWith("\n")) contents += "\n";
for (const key of ["INGEST_TOKEN", "ADMIN_TOKEN"])
  if (!contents.includes(key + "="))
    contents += `${key}=${randomBytes(32).toString("hex")}\n`;
if (!contents.includes("VAPID_PUBLIC_KEY=")) {
  const ec = createECDH("prime256v1");
  ec.generateKeys();
  contents += `VAPID_PUBLIC_KEY=${ec.getPublicKey().toString("base64url")}\nVAPID_PRIVATE_KEY=${ec.getPrivateKey().toString("base64url")}\nVAPID_SUBJECT=https://studio.bengal-barb.ts.net:8443\n`;
}
fs.writeFileSync(".dev.vars", contents, { mode: 0o600 });
console.log("Local secrets ready in .dev.vars (not committed).");
