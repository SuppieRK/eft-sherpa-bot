import { accessSync, constants, realpathSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const POSIX_GIT_PATHS = ["/usr/bin/git", "/usr/local/bin/git", "/opt/homebrew/bin/git"];
const WINDOWS_GIT_PATHS = [
  String.raw`C:\Program Files\Git\cmd\git.exe`,
  String.raw`C:\Program Files (x86)\Git\cmd\git.exe`,
];

function isTrustedInstallation(executable) {
  try {
    accessSync(executable, constants.X_OK);
    const resolved = realpathSync(executable);
    if (!statSync(resolved).isFile()) return false;
    if (process.platform === "win32") return true;
    return (statSync(path.dirname(resolved)).mode & 0o022) === 0;
  } catch {
    return false;
  }
}

export function trustedGitExecutable() {
  const candidates = process.platform === "win32" ? WINDOWS_GIT_PATHS : POSIX_GIT_PATHS;
  const executable = candidates.find(isTrustedInstallation);
  if (executable === undefined) {
    throw new Error("Git is not installed in a fixed system directory");
  }
  return executable;
}
