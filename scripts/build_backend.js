const path = require("path");
const { spawnSync } = require("child_process");

const { resolvePythonCommand } = require("./python_command");

const rootDir = path.resolve(__dirname, "..");
const result = spawnSync(
  resolvePythonCommand(rootDir),
  [path.join(__dirname, "build_backend.py")],
  { cwd: rootDir, stdio: "inherit", windowsHide: true },
);

if (result.error) {
  console.error(`Backend build failed to start: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 0);
