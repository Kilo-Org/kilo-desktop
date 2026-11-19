import browserManifest from "@kilo-desktop/plugin-browser/plugin.json";
import { BROWSER_DEFINITIONS } from "@kilo-desktop/plugin-browser/contracts";
import chatManifest from "@kilo-desktop/plugin-chat/plugin.json";
import { CHAT_DEFINITIONS } from "@kilo-desktop/plugin-chat/contracts";
import coreManifest from "@kilo-desktop/plugin-core/plugin.json";
import { CORE_DEFINITIONS } from "@kilo-desktop/plugin-core/contracts";
import filesManifest from "@kilo-desktop/plugin-files/plugin.json";
import { FILES_DEFINITIONS } from "@kilo-desktop/plugin-files/contracts";
import gitManifest from "@kilo-desktop/plugin-git/plugin.json";
import { GIT_DEFINITIONS } from "@kilo-desktop/plugin-git/contracts";
import notebookManifest from "@kilo-desktop/plugin-notebook/plugin.json";
import { NOTEBOOK_DEFINITIONS } from "@kilo-desktop/plugin-notebook/contracts";
import marketplaceManifest from "@kilo-desktop/plugin-marketplace/plugin.json";
import { MARKETPLACE_DEFINITIONS } from "@kilo-desktop/plugin-marketplace/contracts";
import localInferenceManifest from "@kilo-desktop/plugin-local-inference/plugin.json";
import { LOCAL_INFERENCE_DEFINITIONS } from "@kilo-desktop/plugin-local-inference/contracts";
import environmentsManifest from "@kilo-desktop/plugin-environments/plugin.json";
import { ENVIRONMENTS_DEFINITIONS } from "@kilo-desktop/plugin-environments/contracts";
import anacondaManifest from "@kilo-desktop/plugin-anaconda/plugin.json";
import { ANACONDA_DEFINITIONS } from "@kilo-desktop/plugin-anaconda/contracts";
import boardManifest from "@kilo-desktop/plugin-workspace-board/plugin.json";
import { BOARD_DEFINITIONS } from "@kilo-desktop/plugin-workspace-board/contracts";
import developerManifest from "@kilo-desktop/plugin-developer/plugin.json";
import { DEVELOPER_DEFINITIONS } from "@kilo-desktop/plugin-developer/contracts";
import shellManifest from "@kilo-desktop/plugin-shell/plugin.json";
import { SHELL_DEFINITIONS } from "@kilo-desktop/plugin-shell/contracts";
import terminalManifest from "@kilo-desktop/plugin-terminal/plugin.json";
import { TERMINAL_DEFINITIONS } from "@kilo-desktop/plugin-terminal/contracts";
import workSessionsManifest from "@kilo-desktop/plugin-work-sessions/plugin.json";
import { WORK_SESSIONS_DEFINITIONS } from "@kilo-desktop/plugin-work-sessions/contracts";

import type { BundledPlugin } from "./registrations";

/**
 * Every plugin that ships with the app. The kernel orders them by `requires`;
 * each process attaches its own entries with `withEntries`.
 */
export const BUNDLED_PLUGINS: readonly BundledPlugin[] = [
	{ manifest: coreManifest, definitions: CORE_DEFINITIONS, mainOnly: true },
	{ manifest: shellManifest, definitions: SHELL_DEFINITIONS },
	{ manifest: workSessionsManifest, definitions: WORK_SESSIONS_DEFINITIONS },
	{ manifest: chatManifest, definitions: CHAT_DEFINITIONS },
	{ manifest: gitManifest, definitions: GIT_DEFINITIONS },
	{ manifest: filesManifest, definitions: FILES_DEFINITIONS },
	{ manifest: terminalManifest, definitions: TERMINAL_DEFINITIONS },
	{ manifest: browserManifest, definitions: BROWSER_DEFINITIONS },
	{ manifest: notebookManifest, definitions: NOTEBOOK_DEFINITIONS },
	{ manifest: marketplaceManifest, definitions: MARKETPLACE_DEFINITIONS },
	{ manifest: localInferenceManifest, definitions: LOCAL_INFERENCE_DEFINITIONS },
	{ manifest: environmentsManifest, definitions: ENVIRONMENTS_DEFINITIONS },
	{ manifest: anacondaManifest, definitions: ANACONDA_DEFINITIONS },
	{ manifest: boardManifest, definitions: BOARD_DEFINITIONS },
	{ manifest: developerManifest, definitions: DEVELOPER_DEFINITIONS },
];
