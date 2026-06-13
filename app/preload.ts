// ---------------------------------------------------------------------------
// Electron preload script: exposes a small, typed `window.jarvis` API to the
// renderer via contextBridge, without enabling nodeIntegration.
// ---------------------------------------------------------------------------

import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS } from "./ipcChannels";
import type { AgentResponse } from "../core/agent";
import type { ConfirmationDecision, ConfirmationRequest } from "../core/permissions";
import type { ConversationMessage } from "../store/conversations";
import type { ActivityLogEntry } from "../store/activityLog";

/** A pending confirmation request sent from the main process (R-2). */
export interface ConfirmationRequestEvent {
  id: string;
  request: ConfirmationRequest;
}

export interface JarvisStatus {
  sessionId: string;
  hasAnthropicApiKey: boolean;
  modelMain: string;
  monthlyBudgetUsd: number;
  todayCostUsd: number;
  monthCostUsd: number;
  /** FR-8.3: "ok" | "approaching" (>=80% of cap) | "exceeded" (>=100%, restricted mode). */
  budgetState: "ok" | "approaching" | "exceeded";
  /** `monthCostUsd / monthlyBudgetUsd` (0 if there is no cap). */
  budgetFractionUsed: number;
  voiceAdapter: {
    id: string;
    name: string;
    processingLocation: string;
    supportsInput: boolean;
    supportsOutput: boolean;
  };
}

export interface JarvisBridge {
  sendMessage(message: string): Promise<AgentResponse>;
  getHistory(): Promise<ConversationMessage[]>;
  getActivityLog(limit?: number): Promise<ActivityLogEntry[]>;
  getStatus(): Promise<JarvisStatus>;
  /**
   * Subscribe to confirmation prompts (R-2). The callback is invoked once
   * per pending Tier 1+ tool call that needs the user's confirm/cancel
   * decision; respond via `sendConfirmationDecision`. Returns an
   * unsubscribe function.
   */
  onConfirmationRequest(callback: (event: ConfirmationRequestEvent) => void): () => void;
  /** Send the user's confirm/cancel decision back to the main process. */
  sendConfirmationDecision(id: string, decision: ConfirmationDecision): void;
}

const jarvisBridge: JarvisBridge = {
  sendMessage: (message: string) => ipcRenderer.invoke(IPC_CHANNELS.sendMessage, message),
  getHistory: () => ipcRenderer.invoke(IPC_CHANNELS.getHistory),
  getActivityLog: (limit?: number) => ipcRenderer.invoke(IPC_CHANNELS.getActivityLog, limit),
  getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.getStatus),
  onConfirmationRequest: (callback) => {
    const listener = (_event: unknown, payload: ConfirmationRequestEvent) => callback(payload);
    ipcRenderer.on(IPC_CHANNELS.confirmationRequest, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.confirmationRequest, listener);
  },
  sendConfirmationDecision: (id, decision) => {
    ipcRenderer.send(IPC_CHANNELS.confirmationDecision, { id, decision });
  },
};

contextBridge.exposeInMainWorld("jarvis", jarvisBridge);
