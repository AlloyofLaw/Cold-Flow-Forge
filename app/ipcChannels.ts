// ---------------------------------------------------------------------------
// Shared IPC channel names between the Electron main process and the
// renderer (preload bridge). Kept in one place so both sides stay in sync.
// ---------------------------------------------------------------------------

export const IPC_CHANNELS = {
  sendMessage: "jarvis:send-message",
  getHistory: "jarvis:get-history",
  getActivityLog: "jarvis:get-activity-log",
  getStatus: "jarvis:get-status",
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
