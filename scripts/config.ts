import fs from "node:fs";
export function config() {
  const vars = fs.existsSync(".dev.vars")
    ? Object.fromEntries(
        fs
          .readFileSync(".dev.vars", "utf8")
          .split("\n")
          .filter((x) => x.includes("="))
          .map((x) => {
            const i = x.indexOf("=");
            return [x.slice(0, i), x.slice(i + 1).replace(/^"|"$/g, "")];
          }),
      )
    : {};
  return {
    url: process.env.ISTMO_URL || "http://localhost:5173",
    ...vars,
    ...process.env,
  } as Record<string, string>;
}
