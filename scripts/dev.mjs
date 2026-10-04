import { spawn } from "node:child_process";
const children = [
  spawn(process.execPath, ["--env-file-if-exists=.env", "server/index.mjs"], {
    stdio: "inherit",
    windowsHide: true,
  }),
  spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "--host",
      "127.0.0.1",
      "--port",
      process.env.WEB_PORT || "5173",
    ],
    { stdio: "inherit", windowsHide: true },
  ),
];
let exiting = false;
function stop(code = 0) {
  if (exiting) return;
  exiting = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}
for (const child of children) {
  child.on("error", (e) => {
    console.error(e.message);
    stop(1);
  });
  child.on("exit", (code) => stop(code || 0));
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
