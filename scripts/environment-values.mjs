import { readFile } from "node:fs/promises";

function parseEnvironmentFile(contents) {
  const values = new Map();
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) throw new Error(`Invalid environment line: ${rawLine}`);
    const name = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (values.has(name)) throw new Error(`Duplicate environment value: ${name}`);
    values.set(name, value);
  }
  return values;
}

export async function loadEnvironmentValues(path = ".dev.vars.operator") {
  let values = new Map();
  try {
    values = parseEnvironmentFile(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  for (const [name, value] of Object.entries(process.env)) {
    if (typeof value === "string" && value.trim().length > 0) values.set(name, value.trim());
  }
  return values;
}

export function requireValue(values, name) {
  const value = values.get(name);
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing required environment value: ${name}`);
  }
  return value;
}
