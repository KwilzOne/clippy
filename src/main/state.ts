import Store from "electron-store";

import { getChatWindow, getMainWindow, setFont, setFontSize } from "./windows";
import { IpcMessages } from "../ipc-messages";
import { getModelManager, getModelPath, isModelOnDisk } from "./models";
import { EMPTY_SHARED_STATE, SettingsState, SharedState } from "../sharedState";
import { BUILT_IN_MODELS } from "../models";
import { getLogger } from "./logger";
import { setupAppMenu } from "./menu";

export class StateManager {
  public store = new Store<SharedState>({
    defaults: {
      ...EMPTY_SHARED_STATE,
      models: getModelManager().getInitialRendererModelState(),
    },
  });

  constructor() {
    this.ensureCorrectModelState();
    this.ensureCorrectSettingsState();

    this.store.onDidAnyChange(this.onDidAnyChange);

    // Handle settings changes
    this.store.onDidChange("settings", (newValue, oldValue) => {
      this.onSettingsChange(newValue, oldValue);
    });
  }

  public updateModelState() {
    this.store.set("models", getModelManager().getRendererModelState());
  }

  private ensureCorrectSettingsState() {
    const settings = this.store.get("settings");

    // Default model exists?
    if (settings.selectedModel) {
      const model = this.store.get("models")[settings.selectedModel];

      if (!model || !isModelOnDisk(model)) {
        settings.selectedModel = undefined;
      }
    }

    if (settings.topK === undefined) {
      settings.topK = 10;
    }

    if (settings.temperature === undefined) {
      settings.temperature = 0.7;
    }

    this.store.set("settings", settings);
  }

  private ensureCorrectModelState() {
    const models = this.store.get("models");

    if (models === undefined || Object.keys(models).length === 0) {
      this.store.set(
        "models",
        getModelManager().getInitialRendererModelState(),
      );
      return;
    }

    // Make sure we update the fs state for all models
    for (const modelName of Object.keys(models)) {
      const model = models[modelName];

      if (model.imported) {
        if (!isModelOnDisk(model)) {
          delete models[modelName];
        }
      } else {
        model.downloaded = isModelOnDisk(model);
        model.path = getModelPath(model);
      }
    }

    // Make sure all models from the constant are in state
    for (const model of BUILT_IN_MODELS) {
      if (!(model.name in models)) {
        models[model.name] = getModelManager().getManagedModelFromModel(model);
      } else {
        models[model.name].description = model.description;
        models[model.name].homepage = model.homepage;
        models[model.name].size = model.size;
        models[model.name].url = model.url;
      }
    }

    this.store.set("models", models);
  }

  /**
   * Handles settings changes.
   *
   * @param newValue
   * @param oldValue
   */
  private onSettingsChange(newValue: SettingsState, oldValue?: SettingsState) {
    if (!oldValue) {
      return;
    }

    if (oldValue.clippyAlwaysOnTop !== newValue.clippyAlwaysOnTop) {
      getMainWindow()?.setAlwaysOnTop(newValue.clippyAlwaysOnTop);
    }

    if (oldValue.chatAlwaysOnTop !== newValue.chatAlwaysOnTop) {
      getChatWindow()?.setAlwaysOnTop(newValue.chatAlwaysOnTop);
    }

    if (oldValue.defaultFontSize !== newValue.defaultFontSize) {
      setFontSize(newValue.defaultFontSize);
    }

    if (oldValue.defaultFont !== newValue.defaultFont) {
      setFont(newValue.defaultFont);
    }

    // Log the settings change by getting a deep diff
    const diff = Object.keys(newValue).reduce(
      (acc, key) => {
        const typedKey = key as keyof SettingsState;
        if (newValue[typedKey] !== oldValue[typedKey]) {
          acc[typedKey] = newValue[typedKey];
        }

        return acc;
      },
      {} as Record<string, unknown>,
    );

    // Update the menu, which contains state (only if relevant settings changed)
    const diffKeys = Object.keys(diff);
    if (diffKeys.some((k) => k !== "clippyPosition")) {
      setupAppMenu();
    }

    getLogger().info("Settings changed", diff);
  }

  /**
   * Notifies the renderer that the state has changed.
   *
   * @param newValue
   */
  public onDidAnyChange = (newValue: SharedState = this.store.store) => {
    try {
      const win = getMainWindow();
      if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.webContents.send(IpcMessages.STATE_CHANGED, newValue);
      }
    } catch (error) {
      getLogger().warn("Failed to send state change to renderer", error);
    }
  };
}

let _stateManager: StateManager | null = null;

export function getStateManager() {
  if (!_stateManager) {
    _stateManager = new StateManager();
  }

  return _stateManager;
}
