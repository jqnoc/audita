/**
 * Audita's narrow Electron renderer bridge.
 *
 * The renderer has no Node.js access; it only receives the window controls
 * needed by the frameless desktop shell.
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("audita", {
  isElectron: true,
  quit: () => ipcRenderer.send("app-quit"),
  minimize: () => ipcRenderer.send("app-minimize"),
  toggleMaximize: () => ipcRenderer.send("app-toggle-maximize"),
  getWindowState: () => ipcRenderer.invoke("app-window-state"),
  onWindowStateChanged: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, isMaximized) => callback(Boolean(isMaximized));
    ipcRenderer.on("window-state-changed", listener);
    return () => ipcRenderer.removeListener("window-state-changed", listener);
  },
});
