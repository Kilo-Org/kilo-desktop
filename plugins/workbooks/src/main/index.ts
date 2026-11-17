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
	readonly pages?: (backend: WorkbookBackend) => PagesToolCaller;
}

/**
 * kilo.workbooks in main: the workbook templates on offer (its built-ins
 * shipped through its own `template` point), the person's workbooks, each
 * work session's active workbook and the workbook agent tools.
 */
export function createWorkbooksMainEntry(options: WorkbooksMainOptions = {}): PluginEntry {
	return definePlugin({
		activate(sdk) {
			for (const [id, read] of Object.entries(BUILT_IN_TEMPLATES)) {
				sdk.extensions.implement(WorkbookTemplatePoint, id, { read });
			}
			const templates = provideTemplates(sdk);
			const pages = options.pages ?? kiloPages(sdk);
			const workbooks = provideWorkbooks(sdk, {
				template: templates.find,
				workspace: (id) => workspaceOf(sdk, id),
				pages,
			});
			provideSessionWorkbooks(sdk, { recordUse: workbooks.recordUse });
			implementWorkbookTools(sdk, { pages: (workbook) => pages(workbook.backend) });
		},
	});
}

function workspaceOf(sdk: PluginSdk, id: string) {
	const workspace = sdk.domainObjects
		.get(Workspaces)
		?.getState()
		.workspaces.find((candidate) => candidate.id === id);
	return workspace ? { name: workspace.name } : undefined;
}

function kiloPages(sdk: PluginSdk) {
	return (backend: WorkbookBackend): PagesToolCaller =>
		kiloPagesCaller({
			connect: async () => {
				const server = sdk.domainObjects.get(KiloServer);
				if (!server) throw new KernelError("UNAVAILABLE", "Kilo isn't available.");
				return server.methods.connect(undefined);
			},
			fetch: mainHost(sdk).net.fetch,
			server: backend.server,
		});
}

export const workbooksMainEntry = createWorkbooksMainEntry();
