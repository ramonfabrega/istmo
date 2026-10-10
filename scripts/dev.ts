import { spawn } from "node:child_process";
const children: ReturnType<typeof spawn>[] = [];
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  process.exitCode = 0;
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
const launch = (args: string[]) => {
  const child = spawn(process.execPath, args, { stdio: "inherit" });
  children.push(child);
  child.on("exit", (code) => {
    if (!stopping) {
      console.error(
        `A dev process exited (${code}); stopping the other processes.`,
      );
      stop();
    }
  });
  return child;
};
launch(["node_modules/vite/bin/vite.js", "--host", "0.0.0.0"]);
for (let i = 0; i < 60 && !stopping; i++) {
  try {
    const r = await fetch("http://localhost:5173/api/stations");
    if (r.ok) {
      launch(["--import", "tsx", "scripts/replay.ts"]);
      launch(["--import", "tsx", "scripts/collect.ts", "--watch"]);
      break;
    }
  } catch {}
  if (i === 59) {
    console.error("App did not become ready. Run bun run setup first.");
    stop();
  }
  await new Promise((r) => setTimeout(r, 500));
}
