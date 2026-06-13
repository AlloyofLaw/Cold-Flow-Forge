// ---------------------------------------------------------------------------
// Electron preload script: exposes a small, typed `window.jarvis` API to the
// renderer via contextBridge, without enabling nodeIntegration.
// ---------------------------------------------------------------------------

import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS } from "./ipcChannels";
import type { AgentResponse } from "../core/agent";
import type { ConversationMessage } from "../store/conversations";
import type { ActivityLogEntry } from "../store/activityLog";

export interface JarvisStatus {
  sessionId: string;
  hasAnthropicApiKey: boolean;
  modelMain: string;
  monthlyBudgetUsd: number;
  todayCostUsd: number;
  monthCostUsd: number;
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
}

const jarvisBridge: JarvisBridge = {
  sendMessage: (message: string) => ipcRenderer.invoke(IPC_CHANNELS.sendMessage, message),
  getHistory: () => ipcRenderer.invoke(IPC_CHANNELS.getHistory),
  getActivityLog: (limit?: number) => ipcRenderer.invoke(IPC_CHANNELS.getActivityLog, limit),
  getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.getStatus),
};

contextBridge.exposeInMainWorld("jarvis", jarvisBridge);
