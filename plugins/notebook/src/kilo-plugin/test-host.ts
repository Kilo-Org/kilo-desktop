// Runs the notebook Kilo plugin's v2 `setup` against an in-memory stand-in
// for Kilo's promise plugin context: it collects the tools the plugin adds,
// its permission evaluate hook and its session.deleted subscription. A call
// names its location by `directory`/`worktree` (one plugin instance per
// location, as Kilo runs it); `assert` receives each permission check.
import {
	createNteractKiloPlugin,
	type KiloPluginContext,
	type KiloTool,
	type KiloToolResult,
	type PermissionEvaluation,
} from "./index";

type PluginDependencies = Parameters<typeof createNteractKiloPlugin>[0];

export interface PermissionCheck {
	action: string;
	resources: string[];
	save: string[];
	metadata: Record<string, unknown>;
}

export interface TestCall {
	readonly sessionID?: string;
	readonly messageID?: string;
	readonly agent?: string;
	readonly id?: string;
	readonly signal?: AbortSignal;
	readonly directory?: string;
	readonly worktree?: string;
	readonly assert?: (check: PermissionCheck) => Promise<void>;
}

export interface TestTool {
	readonly description: string;
	readonly input: KiloTool["input"];
	execute(args: Record<string, unknown>, call?: TestCall): Promise<KiloToolResult>;
}

export type NotebookToolName =
	| "notebooks_create_cell"
	| "notebooks_dependencies"
	| "notebooks_diagnose"
	| "notebooks_edit_cells"
	| "notebooks_execute"
	| "notebooks_kernel"
	| "notebooks_read"
	| "notebooks_run_cell"
	| "notebooks_save";

export interface TestHooks {
	readonly tool: Readonly<Record<NotebookToolName, TestTool>>;
	/** Runs the plugin's `permission.evaluate` hook on an event and returns it. */
	evaluate(event: PermissionEvaluation): PermissionEvaluation;
	/** Delivers an event to the plugin's subscription and waits for it to be handled. */
	emit(event: { type: string; data?: { sessionID?: string } }): Promise<void>;
}

const DEFAULT_DIRECTORY = "/projects/demo";

/** Drops undefined keys, as Kilo's JSON wire does. */
function wire(check: PermissionCheck): PermissionCheck {
	const metadata = Object.fromEntries(
		Object.entries(check.metadata).filter(([, value]) => value !== undefined),
	);
	return { ...check, metadata };
}

/** The plugin's tool text: its string content, or its first text part. */
export function textOf(result: KiloToolResult): string {
	if (typeof result.content === "string") return result.content;
	const text = result.content.find((part) => part.type === "text");
	return text && "text" in text ? text.text : "";
}

/** Same call shape as the plugin entry's old factory: `bootPlugin(deps)()` resolves the hooks. */
export function bootPlugin(dependencies: PluginDependencies = {}) {
	return async (): Promise<TestHooks> => {
		const plugin = createNteractKiloPlugin(dependencies);
		const instances = new Map<
			string,
			Promise<{ tools: Map<string, KiloTool>; evaluate: ((event: PermissionEvaluation) => void)[] }>
		>();
		const listeners = new Set<
			(event: { type: string; data?: { sessionID?: string } }) => Promise<void>
		>();
		let lastAssert: TestCall["assert"];

		const instance = (directory: string, worktree: string) => {
			const key = `${directory}\0${worktree}`;
			let existing = instances.get(key);
			if (!existing) {
				existing = (async () => {
					const tools = new Map<string, KiloTool>();
					const evaluate: ((event: PermissionEvaluation) => void)[] = [];
					const ctx: KiloPluginContext = {
						location: { directory, project: { directory: worktree } },
						tool: {
							transform: async (callback) => {
								callback({ add: (tool) => void tools.set(tool.name, tool) });
							},
						},
						permission: {
							hook: async (_name, callback) => {
								evaluate.push(callback as (event: PermissionEvaluation) => void);
							},
							assert: async ({ action, resources, save, metadata }) =>
								(lastAssert ?? (async () => undefined))(
									wire({ action, resources, save: save ?? [], metadata: metadata ?? {} }),
								),
						},
						event: {
							subscribe: ({ signal }) => ({
								async *[Symbol.asyncIterator]() {
									const queue: { type: string; data?: { sessionID?: string } }[] = [];
									let wake: (() => void) | undefined;
									const handled: (() => void)[] = [];
									const listener = (event: { type: string; data?: { sessionID?: string } }) =>
										new Promise<void>((resolve) => {
											queue.push(event);
											handled.push(resolve);
											wake?.();
										});
									listeners.add(listener);
									try {
										while (!signal.aborted) {
											if (queue.length === 0) {
												await new Promise<void>((resolve) => (wake = resolve));
												continue;
											}
											yield queue.shift()!;
											handled.shift()?.();
										}
									} finally {
										listeners.delete(listener);
									}
								},
							}),
						},
					};
					await plugin.setup(ctx);
					return { tools, evaluate };
				})();
				instances.set(key, existing);
			}
			return existing;
		};

		const first = await instance(DEFAULT_DIRECTORY, DEFAULT_DIRECTORY);
		const tool = Object.fromEntries(
			[...first.tools.values()].map((kiloTool): [string, TestTool] => [
				kiloTool.name,
				{
					description: kiloTool.description,
					input: kiloTool.input,
					async execute(args, call = {}) {
						const worktree = call.worktree ?? DEFAULT_DIRECTORY;
						const { tools } = await instance(call.directory ?? worktree, worktree);
						lastAssert = call.assert;
						// Kilo validates the input before the tool runs.
						const input = await kiloTool.input["~standard"].validate(args);
						if ("issues" in input && input.issues) {
							throw new Error(input.issues.map((issue) => issue.message).join(", "));
						}
						return tools.get(kiloTool.name)!.execute((input as { value: unknown }).value, {
							sessionID: call.sessionID ?? "kilo-session-1",
							messageID: call.messageID ?? "message-1",
							agent: call.agent ?? "code",
							id: call.id ?? "call-1",
							signal: call.signal ?? new AbortController().signal,
						});
					},
				},
			]),
		) as Record<NotebookToolName, TestTool>;
		return {
			tool,
			evaluate: (event) => {
				for (const hook of first.evaluate) hook(event);
				return event;
			},
			emit: async (event) => {
				// Each listener resolves once the plugin asks for the next event: it has handled this one.
				await Promise.all([...listeners].map((listener) => listener(event)));
			},
		};
	};
}
