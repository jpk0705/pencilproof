import { spawn } from "node:child_process";

const forwarded = process.argv.slice(2);
const nextArgs = ["dev", "--hostname", "0.0.0.0"];

for (let index = 0; index < forwarded.length; index += 1) {
  const argument = forwarded[index];
  if (argument === "--host") {
    index += 1;
    continue;
  }
  if (argument === "--strictPort") continue;
  nextArgs.push(argument);
}

const nextCommand = process.platform === "win32" ? "next.cmd" : "next";
const child = spawn(nextCommand, nextArgs, { stdio: "inherit" });

const forwardSignal = (signal) => child.kill(signal);
process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
