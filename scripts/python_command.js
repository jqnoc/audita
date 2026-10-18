const fs = require("fs");
const path = require("path");

function resolvePythonCommand(rootDir) {
  if (process.env.PYTHON) return process.env.PYTHON;

  const venvPython = path.join(
    rootDir,
    ".venv",
    process.platform === "win32" ? "Scripts" : "bin",
    process.platform === "win32" ? "python.exe" : "python",
  );
  if (fs.existsSync(venvPython)) return venvPython;

  if (process.env.VIRTUAL_ENV) {
    const activePython = path.join(
      process.env.VIRTUAL_ENV,
      process.platform === "win32" ? "Scripts" : "bin",
      process.platform === "win32" ? "python.exe" : "python",
    );
    if (fs.existsSync(activePython)) return activePython;
  }

  return process.platform === "win32" ? "python" : "python3";
}

module.exports = { resolvePythonCommand };
