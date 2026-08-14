# Kilo Telemetry Reference — Agentic Desktop

Source repo audit: `packages/kilo-vscode/` + `packages/opencode/src/kilocode/` + `packages/kilo-telemetry/`
Scope: events relevant to a Desktop client backed by the Kilo CLI.

---

## Architecture

All telemetry routes to **PostHog**.

```
Desktop UI → TelemetryService.capture(event, props)
  → POST /telemetry/capture  (Kilo CLI child process)
    → Telemetry.track()      (packages/kilo-telemetry)
      → PostHog
```

The CLI also fires a separate set of events automatically — the Desktop does not need to instrument those.

### Consent

In VS Code, `vscode.env.isTelemetryEnabled` gates every capture. The Desktop must implement an equivalent opt-in/opt-out flag and:

1. Gate every `capture()` call on the flag.
2. Propagate changes to the CLI via `POST /telemetry/setEnabled` so the CLI-side events follow the same preference.

### Common properties (merge into every Desktop event)

| Property     | Value                      |
| ------------ | -------------------------- |
| `appName`    | `"agentic-desktop"`        |
| `appVersion` | app version string         |
| `platform`   | `"electron"`               |
| `machineId`  | stable anonymous device ID |

---

## Events the Desktop must implement

These originate in the UI layer and must be explicitly captured. The CLI does **not** fire them.

### `FEEDBACK_SUBMITTED` — "Feedback Submitted"

|                        |                                                                        |
| ---------------------- | ---------------------------------------------------------------------- |
| **Kilocode reference** | `packages/kilo-vscode/webview-ui/src/context/feedback.tsx:57`          |
| **Trigger**            | User clicks 👍 or 👎 on an assistant message, or clears a prior rating |
| **Gate**               | Only fire when telemetry is opted in                                   |

**Payload:**

```ts
{
  providerID: string,
  modelID: string,
  rating: "up" | "down" | "cleared",
  variant?: string,
  previousRating?: "up" | "down",
  // Kilo Gateway provider only:
  sessionID?: string,
  messageID?: string,
  parentMessageID?: string,
}
```

**Notes:** `messageID` / `parentMessageID` are SSE message IDs from the CLI stream. `providerID === "kilo"` indicates a Kilo Gateway-routed model.

---

### `WORK_STYLE_ONBOARDING_SHOWN` — "Work Style Onboarding Shown"

|                        |                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Kilocode reference** | `packages/kilo-vscode/webview-ui/src/context/work-style.tsx:98`                                                     |
| **Trigger**            | Work-style onboarding UI becomes visible for the first time; fire once (guard with a persisted `acknowledged` flag) |

**Payload:** _(none)_

---

### `WORK_STYLE_SELECTED` — "Work Style Selected"

|                        |                                                                 |
| ---------------------- | --------------------------------------------------------------- |
| **Kilocode reference** | `packages/kilo-vscode/webview-ui/src/context/work-style.tsx:79` |
| **Trigger**            | User picks a work style in the onboarding flow                  |

**Payload:**

```ts
{
	style: "autonomous" | "interactive" | "skipped";
}
```

---

### `NOTIFICATION_CLICKED` — "Notification Clicked"

|                        |                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| **Kilocode reference** | `packages/kilo-vscode/webview-ui/src/components/chat/KiloNotifications.tsx:84`                   |
| **Trigger**            | User clicks an actionable button in an in-chat notification banner (e.g. "Try model" suggestion) |

**Payload:**

```ts
{ actionText: string, suggestModelId?: string }
```

---

### `MARKETPLACE_TAB_VIEWED` — "Marketplace Tab Viewed"

|                        |                                                                                     |
| ---------------------- | ----------------------------------------------------------------------------------- |
| **Kilocode reference** | `packages/kilo-vscode/webview-ui/src/components/marketplace/MarketplaceView.tsx:88` |
| **Trigger**            | Marketplace view mounts / user navigates to it                                      |

**Payload:** _(none)_

---

### `MARKETPLACE_INSTALL_BUTTON_CLICKED` — "Marketplace Install Button Clicked"

|                        |                                                                                     |
| ---------------------- | ----------------------------------------------------------------------------------- |
| **Kilocode reference** | `packages/kilo-vscode/webview-ui/src/components/marketplace/MarketplaceView.tsx:92` |
| **Trigger**            | User clicks install on a marketplace item                                           |

**Payload:**

```ts
{ itemId: string, itemType: string, itemName: string }
```

---

### `MARKETPLACE_ITEM_INSTALLED` — "Marketplace Item Installed"

|                        |                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------ |
| **Kilocode reference** | `packages/kilo-vscode/webview-ui/src/components/marketplace/MarketplaceView.tsx:103` |
| **Trigger**            | Marketplace item install completes successfully                                      |

**Payload:**

```ts
{
  itemId: string,
  itemType: string,
  itemName: string,
  target: "project" | "global",
  hasParameters?: true,
  installationMethodName?: string,
}
```

---

### `MARKETPLACE_ITEM_REMOVED` — "Marketplace Item Removed"

|                        |                                                                                     |
| ---------------------- | ----------------------------------------------------------------------------------- |
| **Kilocode reference** | `packages/kilo-vscode/webview-ui/src/components/marketplace/MarketplaceView.tsx:61` |
| **Trigger**            | Marketplace item removal confirmed                                                  |

**Payload:**

```ts
{ itemId: string, itemType: string, itemName: string, target: "project" | "global" }
```

---

## Events the CLI fires automatically

The Kilo CLI child process fires these independently. The Desktop's only responsibility is to propagate the telemetry opt-in flag via `POST /telemetry/setEnabled`. No Desktop instrumentation needed.

These are defined in `packages/kilo-telemetry/src/events.ts` (`TelemetryEvent` enum).

| Event                      | String                     | Trigger                                                                                         |
| -------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------- |
| `CLI_START`                | "CLI Start"                | CLI process starts                                                                              |
| `CLI_EXIT`                 | "CLI Exit"                 | CLI process exits                                                                               |
| `SESSION_START`            | "Session Start"            | New session created                                                                             |
| `SESSION_END`              | "Session End"              | Session ends                                                                                    |
| `SESSION_MESSAGE`          | "Session Message"          | Message sent in a session                                                                       |
| `LLM_COMPLETION`           | "LLM Completion"           | LLM step completes; includes token counts, cost, latency                                        |
| `PLAN_FOLLOWUP`            | "Plan Followup"            | User responds to plan prompt: `dismissed`, `new_session`, `continue`, `keep_refining`, `custom` |
| `SUGGESTION_SHOWN`         | "Suggestion Shown"         | `suggest` tool result shown to user                                                             |
| `SUGGESTION_ACCEPTED`      | "Suggestion Accepted"      | User accepts a suggestion action                                                                |
| `MCP_SERVER_CONNECTED`     | "MCP Server Connected"     | MCP server connects successfully                                                                |
| `MCP_SERVER_ERROR`         | "MCP Server Error"         | MCP connection error                                                                            |
| `INDEXING_STARTED`         | "Indexing Started"         | Codebase indexing begins                                                                        |
| `INDEXING_COMPLETED`       | "Indexing Completed"       | Codebase indexing finishes                                                                      |
| `INDEXING_FILE_COUNT`      | "Indexing File Count"      | File count reported during indexing                                                             |
| `INDEXING_BATCH_RETRY`     | "Indexing Batch Retry"     | Batch retry during indexing                                                                     |
| `INDEXING_ERROR`           | "Indexing Error"           | Indexing error                                                                                  |
| `SHARE_CREATED`            | "Share Created"            | Session share link created                                                                      |
| `SHARE_DELETED`            | "Share Deleted"            | Session share link deleted                                                                      |
| `AUTH_SUCCESS`             | "Auth Success"             | User authenticates                                                                              |
| `AUTH_LOGOUT`              | "Auth Logout"              | User logs out                                                                                   |
| `TELEMETRY_DISABLED`       | "Telemetry Disabled"       | User opts out of telemetry                                                                      |
| `FEEDBACK_SUBMITTED`       | "Feedback Submitted"       | CLI-tier feedback (separate from the UI-tier event above)                                       |
| `ERROR`                    | "Error"                    | General error                                                                                   |
| `COMMAND_USED`             | "Command Used"             | Slash command used in chat                                                                      |
| `TOOL_USED`                | "Tool Used"                | Tool invocation                                                                                 |
| `AGENT_USED`               | "Agent Used"               | Agent switch                                                                                    |
| `REMOTE_CONNECTION_OPENED` | "Remote Connection Opened" | Remote session opened                                                                           |

---

## Events not applicable to the Desktop

These exist in the VS Code extension but have no Desktop equivalent:

| Event                        | Reason excluded                                              |
| ---------------------------- | ------------------------------------------------------------ |
| `TITLE_BUTTON_CLICKED`       | VS Code sidebar title bar native buttons                     |
| `AUTOCOMPLETE_*` (7 events)  | VS Code inline code completion; no code editor in Desktop v1 |
| `GHOST_SERVICE_DISABLED`     | VS Code autocomplete service toggle                          |
| `INLINE_ASSIST_AUTO_TASK`    | VS Code inline assist keybinding                             |
| `AGENT_MANAGER_*` (6 events) | VS Code worktree/Agent Manager panel; not in Desktop v1      |
| `"Continue in Worktree"`     | VS Code worktree concept                                     |

---

## Desktop-specific events to add (not in kilocode)

These are not in the VS Code extension but are natural Desktop additions:

| Suggested event             | Trigger                                               |
| --------------------------- | ----------------------------------------------------- |
| `APP_OPENED`                | Electron app launch                                   |
| `WORKSPACE_ADDED`           | User adds a workspace/project folder                  |
| `WORKSPACE_REMOVED`         | User removes a workspace                              |
| `SESSION_CREATED_FROM_HOME` | User sends from the home composer                     |
| `SETTINGS_CHANGED`          | User changes a setting (with `settingKey` in payload) |

---

## Defined but not yet fired in kilocode (consider for Desktop)

These are in the `TelemetryEventName` enum in kilocode but have no active call sites — either never implemented or stale. Consider whether they are worth implementing in the Desktop from scratch:

`TASK_CREATED`, `TASK_COMPLETED`, `TASK_CONVERSATION_MESSAGE`, `CONTEXT_CONDENSED`, `MODE_SWITCH`, `MODE_SETTINGS_CHANGED`, `CUSTOM_MODE_CREATED`, `CHECKPOINT_CREATED`, `CHECKPOINT_RESTORED`, `CHECKPOINT_DIFFED`, `PROMPT_ENHANCED`, `ACCOUNT_CONNECT_CLICKED`, `ACCOUNT_CONNECT_SUCCESS`, `ACCOUNT_LOGOUT_CLICKED`, `ACCOUNT_LOGOUT_SUCCESS`, `SCHEMA_VALIDATION_ERROR`, `DIFF_APPLICATION_ERROR`, `CONSECUTIVE_MISTAKE_ERROR`, `COMMIT_MSG_GENERATED`, `MEMORY_WARNING_SHOWN`, `ASK_APPROVAL`, `SUGGESTION_BUTTON_CLICKED`
