import { KernelError, mainHost, type PluginSdk } from "@kilo-desktop/kernel";

import {
	DEFAULT_PAGES_MCP_SERVER,
	Workbooks,
	workbookSchema,
	type Workbook,
	type WorkbookBackend,
	type WorkbookTemplate,
} from "../contracts";
import { createWorkbookContent } from "./create-workbook";
import { kickoffText } from "./kickoff";
import type { PagesToolCaller } from "./pages-tools";

interface SavedWorkbooks extends Record<string, unknown> {
	workbooks: unknown[];
}

export interface WorkbookStoreDeps {
	readonly template: (id: string) => WorkbookTemplate | undefined;
	/** The workspace's name and the folder whose Kilo instance holds the MCP connection. */
	readonly workspace: (
		id: string,
	) => { readonly name: string; readonly directory?: string } | undefined;
	readonly pages: (backend: WorkbookBackend, directory: string | undefined) => PagesToolCaller;
	readonly now?: () => Date;
	readonly newId?: () => string;
}

/**
 * Provides `kilo.workbooks/workbooks`: every workspace's workbook references,
 * saved in this plugin's kv store. Saved entries are re-validated on load and
 * any that no longer parse are dropped (with a warning) rather than failing
 * the plugin. The store holds references only; the content is in Pages, and
 * `create` records a workbook only once its whole Pages copy has succeeded.
 */
export function provideWorkbooks(sdk: PluginSdk, deps: WorkbookStoreDeps): void {
	const now = deps.now ?? (() => new Date());
	const newId = deps.newId ?? (() => globalThis.crypto.randomUUID());
	const store = mainHost(sdk).storage.kv<SavedWorkbooks>({
		namespace: "workbooks",
		defaults: { workbooks: [] },
	});

	const loaded: Workbook[] = [];
	for (const saved of store.get("workbooks")) {
		const parsed = workbookSchema.safeParse(saved);
		if (parsed.success) loaded.push(parsed.data);
		else sdk.logger.warn("Dropped a saved workbook that no longer matches its schema.");
	}

	const workbooks = sdk.domainObjects.provide(Workbooks, {
		initialState: { workbooks: loaded },
		methods: {
			create: async ({ workspaceId, templateId, name, values }) => {
				const template = deps.template(templateId);
				if (!template) throw new KernelError("NOT_FOUND", `No workbook template "${templateId}".`);
				const workspace = deps.workspace(workspaceId);
				if (!workspace) throw new KernelError("NOT_FOUND", `No workspace "${workspaceId}".`);
				const backend: WorkbookBackend = { kind: "pages-mcp", server: DEFAULT_PAGES_MCP_SERVER };
				const content = await createWorkbookContent(deps.pages(backend, workspace.directory), {
					template,
					name,
					values,
					workspaceLabel: workspace.name,
				});
				return addWorkbook({ workspaceId, name, templateId, backend, ...content });
			},
			add: (input) => addWorkbook(input),
			rename: ({ id, name }) => {
				const renamed = { ...find(id), name };
				save(
					workbooks.state.workbooks.map((workbook) => (workbook.id === id ? renamed : workbook)),
				);
				return renamed;
			},
			forget: ({ id }) => {
				const remaining = workbooks.state.workbooks.filter((workbook) => workbook.id !== id);
				if (remaining.length === workbooks.state.workbooks.length) return { forgotten: false };
				save(remaining);
				return { forgotten: true };
			},
			kickoff: async ({ workbookId, focus, fresh }) => {
				const workbook = find(workbookId);
				const pages = deps.pages(workbook.backend, deps.workspace(workbook.workspaceId)?.directory);
				const [brief, guide] = await Promise.all([
					readMarkdown(pages, { project_id: workbook.projectId }),
					readMarkdown(pages, { page_id: workbook.guidePageId }),
				]);
				const firstMove = fresh ? deps.template(workbook.templateId)?.firstMove : undefined;
				return kickoffText(workbook, {
					...(brief ? { brief } : {}),
					...(guide ? { guide } : {}),
					...(firstMove ? { firstMove } : {}),
					...(focus ? { focus } : {}),
				});
			},
		},
	});

	/** A page's markdown, or undefined when Pages can't be read (the kick-off then points at it instead). */
	async function readMarkdown(
		pages: PagesToolCaller,
		target: Readonly<Record<string, string>>,
	): Promise<string | undefined> {
		try {
			const page = (await pages.call("read_page", { ...target, comments: "none" })) as {
				blocks?: { markdown?: string }[];
			};
			const text = (page?.blocks ?? [])
				.map((block) => block.markdown ?? "")
				.join("\n\n")
				.trim();
			return text || undefined;
		} catch (error) {
			sdk.logger.warn(`Couldn't read a workbook page for the kick-off: ${String(error)}`);
			return undefined;
		}
	}

	function addWorkbook(input: Omit<Workbook, "id" | "createdAt">): Workbook {
		const workbook: Workbook = { ...input, id: newId(), createdAt: now().toISOString() };
		save([...workbooks.state.workbooks, workbook]);
		return workbook;
	}

	function find(id: string): Workbook {
		const workbook = workbooks.state.workbooks.find((candidate) => candidate.id === id);
		if (!workbook) throw new KernelError("NOT_FOUND", `No workbook "${id}".`);
		return workbook;
	}

	function save(next: Workbook[]) {
		store.set({ workbooks: next });
		workbooks.setState({ workbooks: next });
	}
}
