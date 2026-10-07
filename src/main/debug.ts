import { DebugState } from "../debugState";
import Store from "electron-store";
import { getMainWindow } from "./windows";
import { IpcMessages } from "../ipc-messages";
import { getLogger } from "./logger";

class DebugManager {
  public store: Store<DebugState>;

  constructor() {
    this.store = new Store<DebugState>({
      name: "debug",
      defaults: {
        simulateDownload: false,
        simulateLoadModel: false,
        simulateNoModelsDownloaded: false,
        openDevToolsOnStart: false,
        enableDragDebug: false,
      },
    });
  }

  /**
   * Notifies the renderer that the state has changed.
   *
   * @param newValue
   */
  public onDidAnyChange = (newValue: DebugState = this.store.store) => {
    try {
      const win = getMainWindow();
      if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.webContents.send(IpcMessages.DEBUG_STATE_CHANGED, newValue);
      }
    } catch (error) {
      getLogger().warn("Failed to send debug state change to renderer", error);
    }
  };
}

let _debugManager: DebugManager | null = null;

/**
 * Get the debug manager
 *
 * @returns The debug manager
 */
export function getDebugManager(): DebugManager {
  if (!_debugManager) {
    _debugManager = new DebugManager();
  }

  return _debugManager;
}
