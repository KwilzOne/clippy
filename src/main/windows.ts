import { BrowserWindow, shell, screen, app } from "electron";
import contextMenu from "electron-context-menu";
import { getLogger } from "./logger";

import path from "path";
import { getStateManager } from "./state";
import { getDebugManager } from "./debug";
import { popupAppMenu } from "./menu";

let mainWindow: BrowserWindow | undefined;

/**
 * Get the main window
 *
 * @returns The main window
 */
export function getMainWindow(): BrowserWindow | undefined {
  return mainWindow;
}

export const CLIPPY_WIDTH = 125;
export const CLIPPY_HEIGHT = 100;
export const CLIPPY_MARGIN = 20;

/**
 * Get the default position for Clippy in the bottom-right corner of the primary display work area
 */
export function getClippyDefaultPosition(): { x: number; y: number } {
  const primaryDisplay = screen.getPrimaryDisplay();
  const workArea = primaryDisplay.workArea;

  return {
    x: workArea.x + workArea.width - CLIPPY_WIDTH - CLIPPY_MARGIN,
    y: workArea.y + workArea.height - CLIPPY_HEIGHT - CLIPPY_MARGIN,
  };
}

/**
 * Get the initial position for Clippy, checking saved position or defaulting to bottom-right
 */
export function getClippyInitialPosition(): { x: number; y: number } {
  const settings = getStateManager().store.get("settings");
  const savedPosition = settings?.clippyPosition;

  if (
    savedPosition &&
    typeof savedPosition.x === "number" &&
    typeof savedPosition.y === "number"
  ) {
    // Check if the saved position is visible within any connected display's workArea
    const isVisible = screen.getAllDisplays().some((display) => {
      const { x, y, width, height } = display.workArea;
      return (
        savedPosition.x + CLIPPY_WIDTH / 2 >= x &&
        savedPosition.x + CLIPPY_WIDTH / 2 <= x + width &&
        savedPosition.y + CLIPPY_HEIGHT / 2 >= y &&
        savedPosition.y + CLIPPY_HEIGHT / 2 <= y + height
      );
    });

    if (isVisible) {
      return savedPosition;
    }
  }

  return getClippyDefaultPosition();
}

/**
 * Reset Clippy's position back to the default bottom-right corner
 */
export function resetClippyPosition() {
  const mainWindow = getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  const defaultPos = getClippyDefaultPosition();
  mainWindow.setPosition(defaultPos.x, defaultPos.y);
  getStateManager().store.set("settings.clippyPosition", defaultPos);

  const chatWindow = getChatWindow();
  if (chatWindow && !chatWindow.isDestroyed() && chatWindow.isVisible()) {
    const [width, height] = chatWindow.getSize();
    const position = getPopoverWindowPosition(mainWindow, { width, height });
    chatWindow.setPosition(position.x, position.y);
  }
}

/**
 * Ensure Clippy is still visible on at least one display, resetting to default if off-screen
 */
export function ensureClippyIsVisible() {
  const mainWindow = getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  const [x, y] = mainWindow.getPosition();
  const displays = screen.getAllDisplays();
  const isVisible = displays.some((display) => {
    const { x: dx, y: dy, width: dw, height: dh } = display.workArea;
    return (
      x + CLIPPY_WIDTH / 2 >= dx &&
      x + CLIPPY_WIDTH / 2 <= dx + dw &&
      y + CLIPPY_HEIGHT / 2 >= dy &&
      y + CLIPPY_HEIGHT / 2 <= dy + dh
    );
  });

  if (!isVisible) {
    resetClippyPosition();
  }
}

/**
 * Create the main window
 *
 * @returns The main window
 */
export async function createMainWindow() {
  getLogger().info("Creating main window");

  if (mainWindow && !mainWindow.isDestroyed()) {
    getLogger().info("Main window already exists, skipping creation");
    return;
  }

  const settings = getStateManager().store.get("settings");
  const initialPosition = getClippyInitialPosition();

  mainWindow = new BrowserWindow({
    width: CLIPPY_WIDTH,
    height: CLIPPY_HEIGHT,
    x: initialPosition.x,
    y: initialPosition.y,
    transparent: true,
    hasShadow: false,
    frame: false,
    titleBarStyle: "hidden",
    acceptFirstMouse: true,
    backgroundMaterial: "none",
    resizable: false,
    maximizable: false,
    roundedCorners: false,
    thickFrame: false,
    title: "Clippy",
    alwaysOnTop: settings.clippyAlwaysOnTop,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });

  let moveTimeout: NodeJS.Timeout | undefined;
  mainWindow.on("moved", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    if (moveTimeout) {
      clearTimeout(moveTimeout);
    }
    moveTimeout = setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        return;
      }
      const [x, y] = mainWindow.getPosition();
      getStateManager().store.set("settings.clippyPosition", { x, y });
    }, 300);
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    let retries = 0;
    const maxRetries = 10;
    const loadDevServer = () => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        return;
      }
      const url =
        retries % 2 === 1
          ? MAIN_WINDOW_VITE_DEV_SERVER_URL.replace("localhost", "127.0.0.1")
          : MAIN_WINDOW_VITE_DEV_SERVER_URL;

      mainWindow.loadURL(url).catch((err) => {
        getLogger().warn(
          `Failed to connect to dev server (${url}), retrying...`,
          err,
        );
        if (retries < maxRetries) {
          retries++;
          setTimeout(loadDevServer, 500);
        }
      });
    };

    mainWindow.webContents.on("did-fail-load", (_event, errorCode) => {
      if (errorCode === -102 && retries < maxRetries) {
        retries++;
        setTimeout(loadDevServer, 500);
      }
    });

    loadDevServer();
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  mainWindow.on("system-context-menu", (event) => {
    event.preventDefault();
    popupAppMenu();
  });

  mainWindow.webContents.on("context-menu", (event) => {
    event.preventDefault();
    popupAppMenu();
  });

  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
}

export function setupWindowListener() {
  screen.on("display-metrics-changed", ensureClippyIsVisible);
  screen.on("display-removed", ensureClippyIsVisible);

  app.on(
    "browser-window-created",
    (_event: Electron.Event, browserWindow: BrowserWindow) => {
      const isMainWindow = !browserWindow.getParentWindow();

      getLogger().info(`Creating window (${isMainWindow ? "main" : "child"})`);

      setupWindowOpenHandler(browserWindow);
      setupNavigationHandler(browserWindow);

      if (!isMainWindow) {
        contextMenu({
          window: browserWindow,
        });
      }

      if (getDebugManager().store.get("openDevToolsOnStart")) {
        browserWindow.webContents.openDevTools({ mode: "detach" });
      }

      browserWindow.webContents.on("did-finish-load", () => {
        setFontSize(getStateManager().store.get("settings").defaultFontSize, [
          browserWindow,
        ]);
        setFont(getStateManager().store.get("settings").defaultFont, [
          browserWindow,
        ]);
      });
    },
  );
}

/**
 * Setup the window open handler
 *
 * @param browserWindow The browser window
 */
export function setupWindowOpenHandler(browserWindow: BrowserWindow) {
  browserWindow.webContents.setWindowOpenHandler(({ url, features }) => {
    if (url.startsWith("http")) {
      shell.openExternal(url);

      return { action: "deny" };
    }

    getLogger().info(`window.open() called with features: ${features}`);

    const width = parseInt(features.match(/width=(\d+)/)?.[1] || "400", 10);
    const height = parseInt(features.match(/height=(\d+)/)?.[1] || "600", 10);
    const shouldPositionNextToParent = features.includes(
      "positionNextToParent",
    );
    const newWindowPosition = shouldPositionNextToParent
      ? getPopoverWindowPosition(browserWindow, { width, height })
      : undefined;

    return {
      action: "allow",
      overrideBrowserWindowOptions: {
        frame: false,
        x: newWindowPosition?.x,
        y: newWindowPosition?.y,
        roundedCorners: false,
        minHeight: 400,
        minWidth: 400,
        alwaysOnTop: getStateManager().store.get("settings").chatAlwaysOnTop,
        parent: browserWindow,
      },
    };
  });
}

function setupNavigationHandler(browserWindow: BrowserWindow) {
  browserWindow.webContents.on("will-navigate", (event, url) => {
    event.preventDefault();

    if (url.startsWith("http")) {
      shell.openExternal(url);
    }
  });
}

/**
 * Get the new window position for a popover-like window
 *
 * @param browserWindow The browser window
 * @param size The size of the new window
 * @returns The new window position
 */
export function getPopoverWindowPosition(
  browserWindow: BrowserWindow,
  size: { width: number; height: number },
): { x: number; y: number } {
  const parentBounds = browserWindow.getBounds();
  const { width, height } = size;
  const SPACING = 50; // Distance between windows

  // Get the display matching the parent window
  const display = screen.getDisplayMatching(parentBounds);
  const workArea = display.workArea;

  // Calculate horizontal position (left or right of parent)
  let x: number;
  const leftPosition = parentBounds.x - width - SPACING;

  // If left position would be off-screen, position to the right
  if (leftPosition < workArea.x) {
    x = parentBounds.x + parentBounds.width + SPACING;
  } else {
    x = leftPosition;
  }

  // Ensure window stays within workArea horizontally
  if (x + width > workArea.x + workArea.width) {
    x = workArea.x + workArea.width - width;
  }
  if (x < workArea.x) {
    x = workArea.x;
  }

  // Try to align the bottom of the new window with the parent window
  let y = parentBounds.y + parentBounds.height - height;

  // Ensure window stays within workArea vertically
  if (y + height > workArea.y + workArea.height) {
    y = workArea.y + workArea.height - height;
  }
  if (y < workArea.y) {
    y = workArea.y;
  }

  return { x, y };
}

/**
 * Get the chat window
 *
 * @returns The chat window
 */
export function getChatWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows().find(isChatWindow);
}

/**
 * Check if a window is a chat window
 *
 * @param window The window to check
 * @returns True if the window is a chat window
 */
function isChatWindow(window: BrowserWindow): boolean {
  return window.webContents.getTitle() === "Clippy Chat";
}

/**
 * Toggle the chat window
 */
export function toggleChatWindow() {
  const chatWindow = getChatWindow();

  if (!chatWindow) {
    return;
  }

  if (chatWindow.isVisible()) {
    chatWindow.hide();
  } else {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    const [width, height] = chatWindow.getSize();
    const position = getPopoverWindowPosition(mainWindow, { width, height });

    chatWindow.setPosition(position.x, position.y);
    chatWindow.show();
    chatWindow.focus();
  }
}

/**
 * Minimize the chat window
 */
export function minimizeChatWindow() {
  return getChatWindow()?.minimize();
}

/**
 * Maximize the chat window
 */
export function maximizeChatWindow() {
  if (getChatWindow()?.isMaximized()) {
    return getChatWindow()?.unmaximize();
  }

  return getChatWindow()?.maximize();
}

/**
 * Set the font size for all windows
 *
 * @param fontSize The font size to set
 */
export function setFontSize(
  fontSize: number,
  windows: BrowserWindow[] = BrowserWindow.getAllWindows(),
) {
  windows.forEach((window) => {
    window.webContents.executeJavaScript(
      `document.documentElement.style.setProperty('--font-size', '${fontSize}px');`,
    );
  });
}

/**
 * Set the font for all windows
 *
 * @param font The font to set
 */
export function setFont(
  font: string,
  windows: BrowserWindow[] = BrowserWindow.getAllWindows(),
) {
  windows.forEach((window) => {
    window.webContents.executeJavaScript(
      `document.querySelector('.clippy').setAttribute('data-font', '${font}');`,
    );
  });
}
