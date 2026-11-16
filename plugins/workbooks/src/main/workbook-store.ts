import { randomUUID } from "node:crypto";

import { KernelError, mainHost, type PluginSdk } from "@kilo-desktop/kernel";

import { Workbooks, workbookSchema, type Workbook } from "../contracts";

interface SavedWorkbooks extends Record<string, unknown> {
	workbooks: unknown[];
}

/**
 * Provides `kilo.workbooks/workbooks`: every workspace's workbook references,
 * saved in this plugin's kv store. Saved entries are re-validated on load and
 * any that no longer parse are dropped (with a warning) rather than failing
 * the plugin. The store holds references only; the content is in Pages.
 */
export function provideWorkbooks(
	sdk: PluginSdk,
	options: { readonly now?: () => Date; readonly newId?: () => string } = {},
): void {
	const now = options.now ?? (() => new Date());
	const newId = options.newId ?? randomUUID;
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
			add: (input) => {
				const workbook: Workbook = { ...input, id: newId(), createdAt: now().toISOString() };
				save([...workbooks.state.workbooks, workbook]);
				return workbook;
			},
			rename: ({ id, name }) => {
				const existing = find(id);
				const renamed = { ...existing, name };
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
		},
	});

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
