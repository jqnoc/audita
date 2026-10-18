/**
 * Audita's Electron main process.
 *
 * The local Flask backend remains the single data layer in development and
 * production.  Electron only owns the desktop window and backend lifecycle.
 */

const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { spawn } = require("child_process");
const net = require("net");
const path = require("path");

const { resolvePythonCommand } = require("./scripts/python_command");

let mainWindow = null;
let splashWindow = null;
let backendProcess = null;
let backendPort = 0;
let quitting = false;

const isPackaged = app.isPackaged;
const appRoot = isPackaged ? path.join(process.resourcesPath, "app") : __dirname;
const backendPath = isPackaged
  ? path.join(
      process.resourcesPath,
      "backend",
      process.platform === "win32" ? "audita-backend.exe" : "audita-backend",
    )
  : path.join(appRoot, "app.py");
const preferredPort = 48735;

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(preferredPort, "127.0.0.1", () => {
      server.close(() => resolve(preferredPort));
    });
    server.once("error", () => {
      const fallback = net.createServer();
      fallback.listen(0, "127.0.0.1", () => {
        const address = fallback.address();
        fallback.close(() => resolve(typeof address === "object" && address ? address.port : 0));
      });
      fallback.once("error", reject);
    });
  });
}

function startBackend(port) {
  const env = {
    ...process.env,
    AUDITA_PORT: String(port),
    PYTHONIOENCODING: "utf-8",
  };
  const command = isPackaged ? backendPath : resolvePythonCommand(appRoot);
  const args = isPackaged ? [] : [backendPath];
  const cwd = isPackaged ? path.dirname(backendPath) : appRoot;

  backendProcess = spawn(command, args, {
    cwd,
    env,
    stdio: "pipe",
    windowsHide: true,
  });
  backendProcess.stdout.on("data", (data) => console.log(`[Audita] ${data.toString().trim()}`));
  backendProcess.stderr.on("data", (data) => console.error(`[Audita] ${data.toString().trim()}`));
  backendProcess.once("error", (error) => console.error(`Failed to start Audita backend: ${error.message}`));
  backendProcess.once("close", (code) => {
    console.log(`Audita backend exited with code ${code}`);
    backendProcess = null;
  });
}

function stopBackend() {
  if (!backendProcess) return;
  backendProcess.kill();
  backendProcess = null;
}

function waitForBackend(port, retries = 120, interval = 250) {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    const check = () => {
      const socket = net.createConnection({ port, host: "127.0.0.1" }, () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        attempt += 1;
        if (attempt >= retries) {
          reject(new Error("Audita backend did not start in time."));
          return;
        }
        setTimeout(check, interval);
      });
    };
    check();
  });
}

function notifyWindowState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("window-state-changed", mainWindow.isMaximized());
  }
}

async function createWindow() {
  splashWindow = new BrowserWindow({
    width: 360,
    height: 380,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    title: "Audita",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  splashWindow.loadFile(path.join(appRoot, "static", "splash.html"));
  splashWindow.once("ready-to-show", () => splashWindow.show());

  try {
    backendPort = await findFreePort();
    startBackend(backendPort);
    await waitForBackend(backendPort);
  } catch (error) {
    console.error(error);
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
    dialog.showErrorBox("Audita could not start", error.message);
    app.quit();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 900,
    minHeight: 640,
    title: "Audita",
    backgroundColor: "#0d1117",
    show: false,
    frame: false,
    maximizable: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  mainWindow.on("maximize", notifyWindowState);
  mainWindow.on("unmaximize", notifyWindowState);
  mainWindow.loadURL(`http://127.0.0.1:${backendPort}`);
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
    splashWindow = null;
    notifyWindowState();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http") && !url.startsWith(`http://127.0.0.1:${backendPort}`)) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

ipcMain.on("app-quit", () => app.quit());
ipcMain.on("app-minimize", () => {
  if (mainWindow) mainWindow.minimize();
});
ipcMain.on("app-toggle-maximize", () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.handle("app-window-state", () => ({
  isMaximized: Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isMaximized()),
}));

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  stopBackend();
  app.quit();
});
app.on("before-quit", () => {
  if (!quitting) {
    quitting = true;
    stopBackend();
  }
});
