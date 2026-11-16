import {
	definePlugin,
	KernelError,
	mainHost,
	type PluginEntry,
	type PluginSdk,
} from "@kilo-desktop/kernel";
import { KiloServer } from "@kilo-desktop/plugin-core/contracts";
import { Workspaces } from "@kilo-desktop/plugin-work-sessions/contracts";

import { WorkbookTemplatePoint, type WorkbookBackend } from "../contracts";
import { BUILT_IN_TEMPLATES } from "./built-in-templates";
import { kiloPagesCaller } from "./kilo-pages";
import type { PagesToolCaller } from "./pages-tools";
import { provideTemplates } from "./template-registry";
import { provideSessionWorkbooks } from "./session-workbooks";
import { implementWorkbookTools } from "./workbook-tools";
import { provideWorkbooks } from "./workbook-store";

export interface WorkbooksMainOptions {
	/** How Pages is reached; defaults to Kilo's MCP connection. Tests pass an in-memory Pages. */
	readonly pages?: (backend: WorkbookBackend, directory: string | undefined) => PagesToolCaller;
}

/**
 * kilo.workbooks in main: the workbook templates on offer (its built-ins
 * shipped through its own `template` point), each workspace's workbooks and,
 * later, the workbook agent tools.
 */
export function createWorkbooksMainEntry(options: WorkbooksMainOptions = {}): PluginEntry {
	return definePlugin({
		activate(sdk) {
			for (const [id, read] of Object.entries(BUILT_IN_TEMPLATES)) {
				sdk.extensions.implement(WorkbookTemplatePoint, id, { read });
			}
			const templates = provideTemplates(sdk);
			const pages = options.pages ?? kiloPages(sdk);
			provideWorkbooks(sdk, {
				template: templates.find,
				workspace: (id) => workspaceOf(sdk, id),
				pages,
			});
			provideSessionWorkbooks(sdk);
			implementWorkbookTools(sdk, {
				pages: (workbook) =>
					pages(workbook.backend, workspaceOf(sdk, workbook.workspaceId)?.directory),
			});
		},
	});
}

/** A workspace's name and primary folder (where its chats, and Kilo's MCP connections, run). */
function workspaceOf(sdk: PluginSdk, id: string) {
	const workspace = sdk.domainObjects
		.get(Workspaces)
		?.getState()
		.workspaces.find((candidate) => candidate.id === id);
	if (!workspace) return undefined;
	const primary = workspace.folders.find((folder) => folder.isPrimary);
	return { name: workspace.name, ...(primary ? { directory: primary.path } : {}) };
}

function kiloPages(sdk: PluginSdk) {
	return (backend: WorkbookBackend, directory: string | undefined): PagesToolCaller =>
		kiloPagesCaller({
			connect: async () => {
				const server = sdk.domainObjects.get(KiloServer);
				if (!server) throw new KernelError("UNAVAILABLE", "Kilo isn't available.");
				return server.methods.connect(undefined);
			},
			fetch: mainHost(sdk).net.fetch,
			server: backend.server,
			...(directory ? { directory } : {}),
		});
}

export const workbooksMainEntry = createWorkbooksMainEntry();
