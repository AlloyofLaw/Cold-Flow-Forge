// ---------------------------------------------------------------------------
// Electron main process (PRD Section 15: "/app Electron main + preload").
//
// Responsible for: app lifecycle, creating the main window, and wiring up
// IPC handlers that the renderer (ui/) uses to talk to the agent core and
// the local SQLite store.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import path from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import { getDb } from "../store/database";
import { handleUserMessage, createSessionId } from "../core/agent";
import type { ConfirmationDecision, ConfirmationProvider, ConfirmationRequest } from "../core/permissions";
import { listRecentActivity } from "../store/activityLog";
import { getSessionMessages } from "../store/conversations";
import { getTodayCost, getBudgetStatus } from "../store/costLedger";
import { config } from "../config";
import { getVoiceAdapter } from "../voice";
import { registerAllSkills } from "../skills";
import { IPC_CHANNELS } from "./ipcChannels";

let mainWindow: BrowserWindow | undefined;
let activeSessionId: string;

/**
 * `ConfirmationProvider` implementation for the Electron UI (R-2, SEC-6):
 * sends a `confirmationRequest` event to the renderer (which shows a
 * Confirm/Cancel prompt) and waits for a matching `confirmationDecision`
 * event back. This is the real IPC round-trip; tests instead inject a fake
 * `ConfirmationProvider` (see test/confirmation.test.ts) so the same
 * `core/agent.ts` flow can be exercised headlessly.
 */
class ElectronConfirmationProvider implements ConfirmationProvider {
  private readonly pending = new Map<string, (decision: ConfirmationDecision) => void>();

  constructor(private readonly getWindow: () => BrowserWindow | undefined) {}

  async requestConfirmation(request: ConfirmationRequest): Promise<ConfirmationDecision> {
    const window = this.getWindow();
    if (!window) {
      // No UI to confirm with - refuse rather than hang or auto-approve (R-1/R-2).
      return "denied";
    }

    const id = randomUUID();
    return new Promise<ConfirmationDecision>((resolve) => {
      this.pending.set(id, resolve);
      window.webContents.send(IPC_CHANNELS.confirmationRequest, { id, request });
    });
  }

  /** Resolve a pending confirmation request with the user's decision. */
  resolve(id: string, decision: ConfirmationDecision): void {
    const resolver = this.pending.get(id);
    if (!resolver) return;
    this.pending.delete(id);
    resolver(decision);
  }
}

const confirmationProvider = new ElectronConfirmationProvider(() => mainWindow);

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
    return handleUserMessage(activeSessionId, message, confirmationProvider);
  });

  // Renderer -> main: resolve a pending confirmation request (R-2, R-6).
  ipcMain.on(
    IPC_CHANNELS.confirmationDecision,
    (_event, payload: { id: string; decision: ConfirmationDecision }) => {
      confirmationProvider.resolve(payload.id, payload.decision);
    },
  );

  ipcMain.handle(IPC_CHANNELS.getHistory, async () => {
    return getSessionMessages(activeSessionId);
  });

  ipcMain.handle(IPC_CHANNELS.getActivityLog, async (_event, limit?: number) => {
    return listRecentActivity(limit ?? 50);
  });

  ipcMain.handle(IPC_CHANNELS.getStatus, async () => {
    const voiceAdapter = getVoiceAdapter();
    const budget = getBudgetStatus(config.monthlyBudgetUsd);
    return {
      sessionId: activeSessionId,
      hasAnthropicApiKey: config.hasAnthropicApiKey,
      modelMain: config.modelMain,
      monthlyBudgetUsd: config.monthlyBudgetUsd,
      todayCostUsd: getTodayCost(),
      monthCostUsd: budget.monthCostUsd,
      budgetState: budget.state,
      budgetFractionUsed: budget.fractionUsed,
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

app.whenReady().then(async () => {
  // Initialize the SQLite store (creates schema on first run).
  getDb();

  // Connect built-in skills (Phase 1: Google Calendar, read-only). Each
  // skill handles its own stub mode, so this is safe with no accounts
  // connected (FR-7.1).
  await registerAllSkills();

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
