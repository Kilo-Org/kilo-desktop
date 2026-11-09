import accountManifest from "@kilo-desktop/plugin-account/plugin.json";
import { ACCOUNT_DEFINITIONS } from "@kilo-desktop/plugin-account/contracts";
import anacondaAccountManifest from "@kilo-desktop/plugin-anaconda-account/plugin.json";
import { ANACONDA_ACCOUNT_DEFINITIONS } from "@kilo-desktop/plugin-anaconda-account/contracts";
import agentManifest from "@kilo-desktop/plugin-agent/plugin.json";
import { AGENT_DEFINITIONS } from "@kilo-desktop/plugin-agent/contracts";
import boardManifest from "@kilo-desktop/plugin-workspace-board/plugin.json";
import { BOARD_DEFINITIONS } from "@kilo-desktop/plugin-workspace-board/contracts";
import browserManifest from "@kilo-desktop/plugin-browser/plugin.json";
import { BROWSER_DEFINITIONS } from "@kilo-desktop/plugin-browser/contracts";
import chatManifest from "@kilo-desktop/plugin-chat/plugin.json";
import { CHAT_DEFINITIONS } from "@kilo-desktop/plugin-chat/contracts";
import developerManifest from "@kilo-desktop/plugin-developer/plugin.json";
import { DEVELOPER_DEFINITIONS } from "@kilo-desktop/plugin-developer/contracts";
import environmentsManifest from "@kilo-desktop/plugin-environments/plugin.json";
import { ENVIRONMENTS_DEFINITIONS } from "@kilo-desktop/plugin-environments/contracts";
import filesManifest from "@kilo-desktop/plugin-files/plugin.json";
import { FILES_DEFINITIONS } from "@kilo-desktop/plugin-files/contracts";
import flagsManifest from "@kilo-desktop/plugin-flags/plugin.json";
import { FLAGS_DEFINITIONS } from "@kilo-desktop/plugin-flags/contracts";
import gitManifest from "@kilo-desktop/plugin-git/plugin.json";
import { GIT_DEFINITIONS } from "@kilo-desktop/plugin-git/contracts";
import marketplaceManifest from "@kilo-desktop/plugin-kilo-marketplace/plugin.json";
import { MARKETPLACE_DEFINITIONS } from "@kilo-desktop/plugin-kilo-marketplace/contracts";
import localInferenceManifest from "@kilo-desktop/plugin-local-inference/plugin.json";
import { LOCAL_INFERENCE_DEFINITIONS } from "@kilo-desktop/plugin-local-inference/contracts";
import notebookManifest from "@kilo-desktop/plugin-notebook/plugin.json";
import { NOTEBOOK_DEFINITIONS } from "@kilo-desktop/plugin-notebook/contracts";
import sessionsManifest from "@kilo-desktop/plugin-sessions/plugin.json";
import { SESSIONS_DEFINITIONS } from "@kilo-desktop/plugin-sessions/contracts";
import shellManifest from "@kilo-desktop/plugin-shell/plugin.json";
import { SHELL_DOMAINS, SHELL_EXTENSION_POINTS } from "@kilo-desktop/plugin-shell/contracts";
import telemetryManifest from "@kilo-desktop/plugin-telemetry/plugin.json";
import { TELEMETRY_DEFINITIONS } from "@kilo-desktop/plugin-telemetry/contracts";
import terminalManifest from "@kilo-desktop/plugin-terminal/plugin.json";
import { TERMINAL_DEFINITIONS } from "@kilo-desktop/plugin-terminal/contracts";
import updatesManifest from "@kilo-desktop/plugin-updates/plugin.json";
import { UPDATES_DEFINITIONS } from "@kilo-desktop/plugin-updates/contracts";
import workbenchManifest from "@kilo-desktop/plugin-workbench/plugin.json";
import { WORKBENCH_DEFINITIONS } from "@kilo-desktop/plugin-workbench/contracts";
import workspacesManifest from "@kilo-desktop/plugin-workspaces/plugin.json";
import { WORKSPACES_DEFINITIONS } from "@kilo-desktop/plugin-workspaces/contracts";

import type { BundledPlugin } from "./registrations";

/**
 * Every plugin that ships with the app. The kernel orders them by `requires`;
 * each process attaches its own entries with `withEntries`. Plugins are added
 * here one at a time as they are rebuilt on the kernel.
 */
export const BUNDLED_PLUGINS: readonly BundledPlugin[] = [
	{
		manifest: shellManifest,
		definitions: { extensionPoints: SHELL_EXTENSION_POINTS, domains: SHELL_DOMAINS },
	},
	{ manifest: flagsManifest, definitions: FLAGS_DEFINITIONS, mainOnly: true },
	{ manifest: telemetryManifest, definitions: TELEMETRY_DEFINITIONS },
	{ manifest: updatesManifest, definitions: UPDATES_DEFINITIONS },
	{ manifest: developerManifest, definitions: DEVELOPER_DEFINITIONS },
	{ manifest: agentManifest, definitions: AGENT_DEFINITIONS },
	{ manifest: accountManifest, definitions: ACCOUNT_DEFINITIONS },
	{ manifest: workspacesManifest, definitions: WORKSPACES_DEFINITIONS },
	{ manifest: sessionsManifest, definitions: SESSIONS_DEFINITIONS },
	{ manifest: workbenchManifest, definitions: WORKBENCH_DEFINITIONS },
	{ manifest: chatManifest, definitions: CHAT_DEFINITIONS },
	{ manifest: terminalManifest, definitions: TERMINAL_DEFINITIONS },
	{ manifest: gitManifest, definitions: GIT_DEFINITIONS },
	{ manifest: filesManifest, definitions: FILES_DEFINITIONS },
	{ manifest: browserManifest, definitions: BROWSER_DEFINITIONS },
	{ manifest: environmentsManifest, definitions: ENVIRONMENTS_DEFINITIONS },
	{ manifest: notebookManifest, definitions: NOTEBOOK_DEFINITIONS },
	{ manifest: anacondaAccountManifest, definitions: ANACONDA_ACCOUNT_DEFINITIONS },
	{ manifest: localInferenceManifest, definitions: LOCAL_INFERENCE_DEFINITIONS },
	{ manifest: marketplaceManifest, definitions: MARKETPLACE_DEFINITIONS },
	{ manifest: boardManifest, definitions: BOARD_DEFINITIONS },
];
