// ---------------------------------------------------------------------------
// Renderer process script (PRD Section 15: "/ui Renderer UI").
//
// Talks to the main process exclusively through the `window.jarvis` bridge
// exposed by app/preload.ts. Renders the conversation, the activity log, and
// a small status panel (voice adapter, Brain model, cost meter).
// ---------------------------------------------------------------------------

import type { JarvisBridge, JarvisStatus } from "../app/preload";
import type { ConversationMessage } from "../store/conversations";
import type { ActivityLogEntry } from "../store/activityLog";

declare global {
  interface Window {
    jarvis: JarvisBridge;
  }
}

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

function formatUsd(amount: number): string {
  return `$${amount.toFixed(4)}`;
}

function renderMessage(container: HTMLElement, role: ConversationMessage["role"], content: string): void {
  if (role === "system") return;

  const bubble = document.createElement("div");
  bubble.className = `message ${role}`;

  const roleLabel = document.createElement("span");
  roleLabel.className = "role";
  roleLabel.textContent = role === "user" ? "You" : "JARVIS";

  const body = document.createElement("div");
  body.textContent = content;

  bubble.appendChild(roleLabel);
  bubble.appendChild(body);
  container.appendChild(bubble);
}

function renderActivityEntry(container: HTMLElement, entry: ActivityLogEntry): void {
  const item = document.createElement("div");
  item.className = "activity-entry";

  const meta = document.createElement("div");
  meta.className = "meta";

  const left = document.createElement("span");
  left.textContent = `${entry.skill}.${entry.tool} (Tier ${entry.tier})`;

  const right = document.createElement("span");
  right.textContent = new Date(entry.createdAt).toLocaleTimeString();

  meta.appendChild(left);
  meta.appendChild(right);

  const summary = document.createElement("div");
  summary.textContent = entry.summary ?? entry.outcome;

  item.appendChild(meta);
  item.appendChild(summary);
  container.appendChild(item);
}

async function refreshStatus(): Promise<void> {
  const status: JarvisStatus = await window.jarvis.getStatus();

  byId<HTMLElement>("status-line").textContent = status.hasAnthropicApiKey
    ? `Connected to ${status.modelMain}`
    : "Stub mode (no ANTHROPIC_API_KEY set)";

  byId<HTMLElement>("status-voice").textContent = `${status.voiceAdapter.name} (${status.voiceAdapter.processingLocation})`;
  byId<HTMLElement>("status-brain").textContent = status.hasAnthropicApiKey
    ? status.modelMain
    : "Stub (no API key)";
  byId<HTMLElement>("status-cost-today").textContent = formatUsd(status.todayCostUsd);
  byId<HTMLElement>("status-cost-month").textContent = formatUsd(status.monthCostUsd);
  byId<HTMLElement>("status-budget").textContent = `${formatUsd(status.monthlyBudgetUsd)} / mo`;

  const dot = byId<HTMLElement>("status-dot");
  dot.style.background = status.hasAnthropicApiKey ? "#4dff88" : "#ffcc4d";
}

async function refreshActivityLog(): Promise<void> {
  const log = await window.jarvis.getActivityLog(20);
  const container = byId<HTMLElement>("activity-log");
  container.innerHTML = "";
  for (const entry of log) {
    renderActivityEntry(container, entry);
  }
}

async function loadHistory(): Promise<void> {
  const history = await window.jarvis.getHistory();
  const container = byId<HTMLElement>("conversation");
  container.innerHTML = "";
  for (const message of history) {
    renderMessage(container, message.role, message.content);
  }
  container.scrollTop = container.scrollHeight;
}

function setupForm(): void {
  const form = byId<HTMLFormElement>("message-form");
  const input = byId<HTMLInputElement>("message-input");
  const button = form.querySelector("button") as HTMLButtonElement;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = input.value.trim();
    if (!message) return;

    const conversation = byId<HTMLElement>("conversation");
    renderMessage(conversation, "user", message);
    conversation.scrollTop = conversation.scrollHeight;

    input.value = "";
    input.disabled = true;
    button.disabled = true;

    try {
      const response = await window.jarvis.sendMessage(message);
      renderMessage(conversation, "assistant", response.reply);
      conversation.scrollTop = conversation.scrollHeight;
      await Promise.all([refreshActivityLog(), refreshStatus()]);
    } catch (error) {
      renderMessage(conversation, "assistant", `Error: ${(error as Error).message}`);
    } finally {
      input.disabled = false;
      button.disabled = false;
      input.focus();
    }
  });
}

async function init(): Promise<void> {
  setupForm();
  await Promise.all([loadHistory(), refreshActivityLog(), refreshStatus()]);
}

void init();
