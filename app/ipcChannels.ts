// ---------------------------------------------------------------------------
// Shared IPC channel names between the Electron main process and the
// renderer (preload bridge). Kept in one place so both sides stay in sync.
// ---------------------------------------------------------------------------

export const IPC_CHANNELS = {
  sendMessage: "jarvis:send-message",
  getHistory: "jarvis:get-history",
  getActivityLog: "jarvis:get-activity-log",
  getStatus: "jarvis:get-status",
  /**
   * Main -> renderer: a Tier 1+ tool call needs confirmation (R-2). Sent as
   * an `ipcRenderer.send`/`webContents.send` event (not invoke/handle),
   * because the main process must PAUSE the tool-use loop and wait for the
   * user's decision before continuing.
   */
  confirmationRequest: "jarvis:confirmation-request",
  /**
   * Renderer -> main: the user's confirm/cancel decision for a pending
   * confirmation request (R-2, R-6). Resolves the corresponding pending
   * promise in the main process's `ElectronConfirmationProvider`.
   */
  confirmationDecision: "jarvis:confirmation-decision",
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
