// ---------------------------------------------------------------------------
// Electron main process (PRD Section 15: "/app Electron main + preload").
//
// Responsible for: app lifecycle, creating the main window, and wiring up
// IPC handlers that the renderer (ui/) uses to talk to the agent core and
// the local SQLite store.
// ---------------------------------------------------------------------------

import path from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import { getDb } from "../store/database";
import { handleUserMessage, createSessionId } from "../core/agent";
import { listRecentActivity } from "../store/activityLog";
import { getSessionMessages } from "../store/conversations";
import { getCurrentMonthCost, getTodayCost } from "../store/costLedger";
import { config } from "../config";
import { getVoiceAdapter } from "../voice";
import { IPC_CHANNELS } from "./ipcChannels";

let mainWindow: BrowserWindow | undefined;
let activeSessionId: string;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    title: "JARVIS",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "..", "ui", "index.html"));
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.sendMessage, async (_event, message: string) => {
    return handleUserMessage(activeSessionId, message);
  });

  ipcMain.handle(IPC_CHANNELS.getHistory, async () => {
    return getSessionMessages(activeSessionId);
  });

  ipcMain.handle(IPC_CHANNELS.getActivityLog, async (_event, limit?: number) => {
    return listRecentActivity(limit ?? 50);
  });

  ipcMain.handle(IPC_CHANNELS.getStatus, async () => {
    const voiceAdapter = getVoiceAdapter();
    return {
      sessionId: activeSessionId,
      hasAnthropicApiKey: config.hasAnthropicApiKey,
      modelMain: config.modelMain,
      monthlyBudgetUsd: config.monthlyBudgetUsd,
      todayCostUsd: getTodayCost(),
      monthCostUsd: getCurrentMonthCost(),
      voiceAdapter: {
        id: voiceAdapter.id,
        name: voiceAdapter.name,
        processingLocation: voiceAdapter.processingLocation,
        supportsInput: voiceAdapter.supportsInput,
        supportsOutput: voiceAdapter.supportsOutput,
      },
    };
  });
}

app.whenReady().then(() => {
  // Initialize the SQLite store (creates schema on first run).
  getDb();

  activeSessionId = createSessionId();

  registerIpcHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
