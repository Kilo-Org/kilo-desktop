import fs from "node:fs";
import path from "node:path";

import {
	KernelError,
	type DomainObjectHandle,
	type DomainObjectProvider,
	type KernelLogger,
	type PluginSdk,
} from "@kilo-desktop/kernel";
import { createMainKernel, type MainKernel } from "@kilo-desktop/kernel/main";
import { createMemoryStorage, createTestHost, testPlugin } from "@kilo-desktop/kernel/testing";
import shellManifest from "@kilo-desktop/plugin-shell/plugin.json";
import {
	Notifications,
	SHELL_DEFINITIONS,
	type NotificationContent,
} from "@kilo-desktop/plugin-shell/contracts";
import workSessionsManifest from "@kilo-desktop/plugin-work-sessions/plugin.json";
import {
	Vcs,
	WORK_SESSIONS_DEFINITIONS,
	Workspaces,
	type VcsImplementation,
	type Workspace,
} from "@kilo-desktop/plugin-work-sessions/contracts";

import manifest from "../../../plugin.json";
import {
	GIT_DEFINITIONS,
	GIT_PROTOCOL_SCHEME,
	GithubRepositories,
	Repository,
} from "../../contracts";
import { createGitMainEntry, type GitMainOptions } from "../entry";

/* Boots kilo.git's whole main entry on a real main kernel, with stand-ins for kilo.work-sessions' workspaces and kilo.shell's notifications. */

export const APP_ORIGIN = "kilo-desktop://app";

const unused = () => {
	throw new Error("unused");
};

function isInside(folder: string, candidate: string): boolean {
	const inside = path.relative(folder, candidate);
	return inside === "" || (!inside.startsWith("..") && !path.isAbsolute(inside));
}

function realpathOr(target: string): string {
	try {
		return fs.realpathSync.native(target);
	} catch {
		return path.resolve(target);
	}
}

function workspaceOf(folder: string, index: number): Workspace {
	return {
		id: `workspace-${index}`,
		name: path.basename(folder),
		folders: [{ id: `folder-${index}`, path: folder, isPrimary: true, position: 0 }],
		createdAt: 0,
		updatedAt: 0,
	};
}

/**
 * kilo.work-sessions under its real manifest, providing only its workspaces
 * with the given folders; `authorize` resolves symlinks and short names on
 * both sides like the real one. New workspaces (`newFolderPath`, `create`,
 * `rememberNewFolderLocation`) are recorded, not added to the folders.
 */
function fakeWorkSessions(folders: readonly string[]) {
	let provider: DomainObjectProvider<typeof Workspaces> | undefined;
	const created: Workspace[] = [];
	const rememberedLocations: string[] = [];
	return {
		created,
		rememberedLocations,
		registration: {
			manifest: workSessionsManifest,
			definitions: WORK_SESSIONS_DEFINITIONS,
			entry: {
				activate: (sdk: PluginSdk) => {
					provider = sdk.domainObjects.provide(Workspaces, {
						initialState: { workspaces: [], activeId: null, unavailableFolderIds: [] },
						methods: {
							update: unused,
							remove: unused,
							setActive: unused,
							checkFolders: unused,
							newFolderLocation: unused,
							newFolderPath: ({ parentPath, name }) => {
								const destination = path.join(realpathOr(parentPath), name);
								if (fs.existsSync(destination)) {
									throw new KernelError("VALIDATION", `A folder named "${name}" already exists.`);
								}
								return { path: destination };
							},
							create: ({ name, color, folders: newFolders }) => {
								const workspace: Workspace = {
									...workspaceOf(newFolders[0]!.path, created.length + 100),
									...(name === undefined ? {} : { name }),
									...(color === undefined ? {} : { color }),
								};
								created.push(workspace);
								return workspace;
							},
							rememberNewFolderLocation: ({ path: location }) => {
								rememberedLocations.push(location);
							},
							authorize: async ({ path: target }) => {
								const resolved = realpathOr(target);
								const folder = folders.find((candidate) =>
									isInside(realpathOr(candidate), resolved),
								);
								return folder ? { allowed: true, folder, path: resolved } : { allowed: false };
							},
						},
					});
				},
			},
		},
		publish: () =>
			provider?.setState({
				workspaces: folders.map(workspaceOf),
				activeId: null,
				unavailableFolderIds: [],
			}),
	};
}

/** kilo.shell under its real manifest, providing only notifications; toasts are recorded. */
function fakeShell(toasts: NotificationContent[]) {
	return {
		manifest: shellManifest,
		definitions: SHELL_DEFINITIONS,
		entry: {
			activate: (sdk: PluginSdk) => {
				sdk.domainObjects.provide(Notifications, {
					initialState: { notices: {} },
					methods: {
						toast: (input) => {
							toasts.push(input);
						},
						post: unused,
						dismiss: unused,
					},
				});
			},
		},
	};
}

export interface BootOptions {
	/** Leave kilo.work-sessions out. */
	readonly workSessions?: boolean;
	/** Leave kilo.shell out. */
	readonly shell?: boolean;
	readonly git?: GitMainOptions;
	readonly logger?: KernelLogger;
}

export interface BootedGit {
	readonly kernel: MainKernel;
	readonly repository: DomainObjectHandle<typeof Repository>;
	/** kilo.git's GitHub repositories, absent if not provided. */
	readonly githubRepositories: DomainObjectHandle<typeof GithubRepositories> | null;
	/** Workspaces kilo.work-sessions' `create` was asked for, and the locations offered as the next default. */
	readonly created: readonly Workspace[];
	readonly rememberedLocations: readonly string[];
	/** kilo.git's `vcs` implementation, as another plugin sees it. */
	readonly vcs: VcsImplementation;
	readonly protocol: { handler(request: Request): Promise<Response> };
	/** Toasts kilo.shell was asked to show. */
	readonly toasts: readonly NotificationContent[];
	/** Registers a folder the guard then accepts, as renderers only pass workspace folder paths. */
	addWorkspaceFolder(folder: string): void;
}

const kernels: MainKernel[] = [];

/** Stops every kernel `bootGit` started; call it after each test. */
export async function stopBootedKernels(): Promise<void> {
	await Promise.all(kernels.splice(0).map((kernel) => kernel.stop()));
}

/** Boots kilo.git with its stand-ins and a plugin that reaches git through the `vcs` point. */
export async function bootGit(options: BootOptions = {}): Promise<BootedGit> {
	const folders: string[] = [];
	const toasts: NotificationContent[] = [];
	const workSessions = fakeWorkSessions(folders);
	const handlers = new Map<string, (request: Request) => Response | Promise<Response>>();
	let consumer: PluginSdk | undefined;
	const kernel = createMainKernel({
		host: createTestHost({ rendererOrigins: [APP_ORIGIN] }),
		registrations: [
			{ manifest, definitions: GIT_DEFINITIONS, entry: createGitMainEntry(options.git) },
			testPlugin("test.consumer", {
				manifest: { requires: { "kilo.work-sessions/vcs": "optional" } },
				entry: {
					activate: (sdk) => {
						consumer = sdk;
					},
				},
			}),
			...(options.workSessions === false ? [] : [workSessions.registration]),
			...(options.shell === false ? [] : [fakeShell(toasts)]),
		],
		hostServices: (pluginId) =>
			pluginId === manifest.id
				? {
						storage: createMemoryStorage(`/data/${manifest.id}`),
						protocol: {
							handle(scheme: string, handler: (request: Request) => Response | Promise<Response>) {
								handlers.set(scheme, handler);
								return () => handlers.delete(scheme);
							},
						},
					}
				: {},
		...(options.logger ? { logger: options.logger } : {}),
	});
	kernels.push(kernel);
	await kernel.start();
	return {
		kernel,
		repository: kernel.kernelSdk.domainObjects.get(Repository)!,
		githubRepositories: kernel.kernelSdk.domainObjects.get(GithubRepositories),
		created: workSessions.created,
		rememberedLocations: workSessions.rememberedLocations,
		get vcs() {
			const implementation = consumer?.extensions.exclusive(Vcs).winner?.implementation;
			if (!implementation) throw new Error("No vcs implementation.");
			return implementation;
		},
		protocol: {
			handler: async (request) => {
				const handler = handlers.get(GIT_PROTOCOL_SCHEME);
				if (!handler) throw new Error("kilo-git is not handled.");
				return handler(request);
			},
		},
		toasts,
		addWorkspaceFolder: (folder) => {
			folders.push(folder);
			workSessions.publish();
		},
	};
}
