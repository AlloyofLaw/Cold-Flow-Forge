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
   * confirmation request (R-2, R-6), optionally including a TOTP code for
   * Tier 3 requests (R-2a). Resolves the corresponding pending promise in
   * the main process's `ElectronConfirmationProvider`.
   */
  confirmationDecision: "jarvis:confirmation-decision",
  /**
   * One-time TOTP setup (R-2a): main -> renderer call to generate a new TOTP
   * secret (stored in the credential vault) and return the `otpauth://` URI
   * + base32 secret for the user to add to Google Authenticator.
   */
  totpSetup: "jarvis:totp-setup",
  /** Whether a TOTP secret has already been configured (R-2a). */
  totpStatus: "jarvis:totp-status",
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
