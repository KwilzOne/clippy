import { shouldQuit } from "./squirrel-startup";

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (shouldQuit) {
  app.quit();
}

import fs from "fs";
import { app, BrowserWindow } from "electron";
import { loadElectronLlm } from "@electron/llm";
import { setupIpcListeners } from "./ipc";
import { createMainWindow, setupWindowListener } from "./windows";
import { getModelManager } from "./models";
import { setupAutoUpdater } from "./update";
import { setupAppMenu } from "./menu";

async function onReady() {
  console.info(`Welcome to Clippy v${app.getVersion()}`);

  await setupAutoUpdater();
  await loadLlm();
  setupAppMenu();
  setupIpcListeners();
  setupWindowListener();
  await createMainWindow();
}

async function loadLlm() {
  await loadElectronLlm({
    getModelPath: (modelAlias: string) => {
      const model = getModelManager().getModelByName(modelAlias);
      if (!model || !model.path || !fs.existsSync(model.path)) {
        console.warn(
          `Model ${modelAlias} does not exist on disk, skipping LLM load`,
        );
        return undefined;
      }
      console.info(`Loading model ${modelAlias} from ${model.path}`);
      return model.path;
    },
  });
}

app.on("ready", onReady);

app.on("before-quit", () => {
  try {
    getModelManager().cancelAllDownloads();
  } catch (error) {
    console.error("Error cancelling downloads on quit", error);
  }
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});
