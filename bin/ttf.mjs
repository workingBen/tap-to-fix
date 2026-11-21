#!/usr/bin/env node
import { homedir } from "node:os";
import { main } from "./lib/commands.mjs";

const code = await main(process.argv.slice(2), {
  env: process.env,
  home: homedir(),
  fetchImpl: fetch,
  cwd: process.cwd(),
  out: (s) => console.log(s),
  err: (s) => console.error(s),
});
process.exit(code);
