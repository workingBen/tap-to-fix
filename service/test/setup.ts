// Drop only node:sqlite's ExperimentalWarning so test output stays pristine.
const original = process.emitWarning;
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const text = typeof warning === "string" ? warning : warning.message;
  if (text.startsWith("SQLite is an experimental feature")) return;
  return (original as (...a: unknown[]) => void).call(process, warning, ...rest);
}) as typeof process.emitWarning;
