import { BookIcon } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import {
	definePlugin,
	KernelDialogs,
	KernelError,
	type DomainObjectProvider,
	type PluginEntry,
} from "@kilo-desktop/kernel";
import { KiloWorkStyle } from "@kilo-desktop/plugin-core/contracts";
import { renderShell, type GuestPlugin } from "@kilo-desktop/plugin-shell/testing";

import manifest from "../../../plugin.json";
import {
	Workspaces,
	WORK_SESSIONS_DEFINITIONS,
	WorkspaceSource,
	type CreateWorkspaceInput,
	type NewFolderDetails,
	type Workspace,
	type WorkspaceSourceProps,
} from "../../contracts";
import { activateWorkspaces } from "./index";

const workspacesWebEntry = definePlugin({ activate: activateWorkspaces });

const APP: Workspace = {
	id: "w-app",
	name: "App",
	color: "#5EA0F7",
	folders: [
		{ id: "f-app", path: "/projects/app", isPrimary: true, position: 0 },
		{ id: "f-docs", path: "/projects/docs", isPrimary: false, position: 1 },
	],
	createdAt: 1,
	updatedAt: 1,
};

/** Stands in for kilo.work-sessions' main workspaces area: workspaces kept in memory. */
function fakeWorkspacesMain(
	initial: Workspace[],
	options: { unavailable?: string[]; newFolderLocation?: string | null } = {},
) {
	const calls = {
		create: vi.fn<(input: CreateWorkspaceInput) => void>(),
		update: vi.fn(),
		remove: vi.fn(),
		setActive: vi.fn(),
	};
	let failNext: string | undefined;
	const entry: PluginEntry = {
		activate(sdk) {
			const set = (list: Workspace[], activeId: string | null) => {
				workspaces.setState({
					workspaces: list,
					activeId,
					unavailableFolderIds: options.unavailable ?? [],
				});
				sdk.context.set("hasWorkspaces", list.length > 0);
			};
			const fail = () => {
				if (!failNext) return;
				const message = failNext;
				failNext = undefined;
				throw new KernelError("VALIDATION", message);
			};
			const workspaces: DomainObjectProvider<typeof Workspaces> = sdk.domainObjects.provide(
				Workspaces,
				{
					initialState: {
						workspaces: initial,
						activeId: null,
						unavailableFolderIds: options.unavailable ?? [],
					},
					methods: {
						create: (input) => {
							calls.create(input);
							fail();
							const created: Workspace = {
								id: `w-${workspaces.state.workspaces.length + 1}`,
								name: input.name || "new",
								...(input.color ? { color: input.color } : {}),
								folders: input.folders.map((folder, position) => ({
									...folder,
									id: `f-${position}`,
									position,
								})),
								createdAt: 1,
								updatedAt: 1,
							};
							set([...workspaces.state.workspaces, created], workspaces.state.activeId);
							return created;
						},
						update: (input) => {
							calls.update(input);
							fail();
							const updated = { ...APP, ...input, folders: APP.folders } as Workspace;
							set(
								workspaces.state.workspaces.map((w) => (w.id === input.id ? updated : w)),
								workspaces.state.activeId,
							);
							return updated;
						},
						remove: ({ id }) => {
							calls.remove(id);
							fail();
							set(
								workspaces.state.workspaces.filter((w) => w.id !== id),
								workspaces.state.activeId,
							);
							return { deleted: true };
						},
						setActive: ({ id }) => {
							calls.setActive(id);
							set(workspaces.state.workspaces, id);
						},
						authorize: () => ({ allowed: false }),
						checkFolders: () => {},
						newFolderLocation: () => ({ path: options.newFolderLocation ?? null }),
						newFolderPath: ({ parentPath, name }) => ({ path: `${parentPath}/${name}` }),
						rememberNewFolderLocation: () => {},
					},
				},
			);
			set(initial, null);
		},
	};
	return { entry, calls, failNextWith: (message: string) => (failNext = message) };
}

async function renderApp(
	options: {
		workspaces?: Workspace[];
		unavailable?: string[];
		desktop?: boolean;
		pickedFolders?: string[];
		onboarding?: boolean;
		localStorage?: Record<string, string>;
		newFolderLocation?: string | null;
		guests?: GuestPlugin[];
	} = {},
) {
	const fake = fakeWorkspacesMain(options.workspaces ?? [], {
		...(options.unavailable ? { unavailable: options.unavailable } : {}),
		...(options.newFolderLocation === undefined
			? {}
			: { newFolderLocation: options.newFolderLocation }),
	});
	const open = vi.fn(() => ({ paths: options.pickedFolders ?? [] }));
	const host = await renderShell(
		[
			{
				manifest,
				definitions: WORK_SESSIONS_DEFINITIONS,
				main: fake.entry,
				web: workspacesWebEntry,
			},
			...(options.guests ?? []),
		],
		{
			desktop: options.desktop ?? true,
			core: (sdk) => {
				sdk.context.set("termsAccepted", true);
				sdk.domainObjects.provide(KiloWorkStyle, {
					initialState: { style: null },
					methods: { conflicts: () => ({ keys: [] }), apply: () => undefined },
				});
			},
			onboarding: options.onboarding ?? false,
			...(options.localStorage ? { localAppearance: options.localStorage } : {}),
			pathForFile: (file) => `/dropped/${file.name}`,
			beforeRender: (main) => {
				main.kernelSdk.domainObjects.provide(KernelDialogs, {
					initialState: {},
					methods: { open, save: () => ({ path: null }) } as never,
				});
			},
		},
	);
	const run = (command: "add-workspace" | "manage-workspaces") =>
		host.renderer.commands.execute(`kilo.work-sessions/${command}`);
	return { ...fake, open, host, run };
}

const formDialog = () => page.getByTestId("workspace-form-dialog");
const createDialog = () => page.getByTestId("workspace-create-dialog");
const manager = () => page.getByTestId("workspace-manager-dialog");

/** Opens New workspace on its Local folder source. */
async function addFromLocalFolder(run: (command: "add-workspace") => Promise<unknown>) {
	await run("add-workspace");
	await createDialog()
		.getByRole("button", { name: /Local folder/ })
		.click();
}

describe("Manage workspaces", () => {
	it("explains there are none yet, and creates one from the footer", async () => {
		const { run } = await renderApp();

		await run("manage-workspaces");

		await expect.element(manager().getByText("No workspaces yet")).toBeVisible();
		await manager().getByRole("button", { name: "Create workspace" }).click();
		await expect
			.element(createDialog().getByRole("heading", { name: "New workspace", exact: true }))
			.toBeVisible();
	});

	it("edits and deletes listed workspaces", async () => {
		const { run, calls } = await renderApp({ workspaces: [APP] });
		await run("manage-workspaces");

		await manager().getByRole("button", { name: "Edit App" }).click();
		await expect
			.element(formDialog().getByRole("heading", { name: "Edit workspace" }))
			.toBeVisible();
		await formDialog().getByRole("button", { name: "Save" }).click();
		await vi.waitFor(() => expect(calls.update).toHaveBeenCalled());

		await run("manage-workspaces");
		await manager().getByRole("button", { name: "Delete App" }).click();
		await page.getByRole("button", { name: "Delete workspace" }).click();
		await vi.waitFor(() => expect(calls.remove).toHaveBeenCalledWith("w-app"));
	});

	it("keeps the delete confirmation open with the reason when deleting fails", async () => {
		const { run, failNextWith } = await renderApp({ workspaces: [APP] });
		await run("manage-workspaces");
		await manager().getByRole("button", { name: "Delete App" }).click();
		failNextWith("Workspace is in use.");

		await page.getByRole("button", { name: "Delete workspace" }).click();

		await expect.element(page.getByText("Workspace is in use.")).toBeVisible();
	});

	it("opens edit or delete for a given workspace, as other plugins do", async () => {
		const { host, calls } = await renderApp({ workspaces: [APP] });

		await host.renderer.commands.execute("kilo.work-sessions/edit-workspace", {
			workspaceId: "w-app",
		});
		await expect
			.element(formDialog().getByRole("heading", { name: "Edit workspace" }))
			.toBeVisible();
		await userEvent.keyboard("{Escape}");

		await host.renderer.commands.execute("kilo.work-sessions/delete-workspace", {
			workspaceId: "w-app",
		});
		await page.getByRole("button", { name: "Delete workspace" }).click();
		await vi.waitFor(() => expect(calls.remove).toHaveBeenCalledWith("w-app"));
	});

	it("marks folders that can't be read", async () => {
		const { run } = await renderApp({ workspaces: [APP], unavailable: ["f-docs"] });
		await run("manage-workspaces");

		await manager().getByRole("button", { name: "Edit App" }).click();

		await expect.element(formDialog().getByTestId("workspace-folder-unavailable")).toBeVisible();
	});
});

describe("Add workspace", () => {
	it("picks folders, chooses the primary and a colour, then creates and activates it", async () => {
		const { run, calls, open } = await renderApp({
			pickedFolders: ["/projects/app", "/projects/docs"],
		});

		await addFromLocalFolder(run);
		await createDialog().getByTestId("workspace-folder-dropzone").click();
		await vi.waitFor(() =>
			expect(open).toHaveBeenCalledWith({ directory: true, multiple: true }, expect.anything()),
		);
		await createDialog().getByRole("button", { name: "Make primary" }).click();
		await createDialog().getByRole("button", { name: "Green", exact: true }).click();
		await createDialog().getByRole("button", { name: "Create workspace" }).click();

		await vi.waitFor(() =>
			expect(calls.create).toHaveBeenCalledWith(
				expect.objectContaining({
					color: "#34D399",
					folders: [
						{ path: "/projects/docs", isPrimary: true },
						{ path: "/projects/app", isPrimary: false },
					],
					source: "dialog",
				}),
			),
		);
		await vi.waitFor(() => expect(calls.setActive).toHaveBeenCalledWith("w-1"));
		await expect.element(createDialog()).not.toBeInTheDocument();
	});

	it("makes the next folder primary when the primary is removed", async () => {
		const { run, calls } = await renderApp({ pickedFolders: ["/projects/app", "/projects/docs"] });
		await addFromLocalFolder(run);
		await createDialog().getByTestId("workspace-folder-dropzone").click();
		await expect.element(createDialog().getByText("docs", { exact: true })).toBeVisible();

		await createDialog().getByRole("button", { name: "Remove /projects/app" }).click();
		await createDialog().getByRole("button", { name: "Create workspace" }).click();

		await vi.waitFor(() =>
			expect(calls.create).toHaveBeenCalledWith(
				expect.objectContaining({ folders: [{ path: "/projects/docs", isPrimary: true }] }),
			),
		);
	});

	it("keeps a workspace's custom colour", async () => {
		const { run } = await renderApp({ workspaces: [{ ...APP, color: "#123456" }] });
		await run("manage-workspaces");

		await manager().getByRole("button", { name: "Edit App" }).click();

		await expect
			.element(formDialog().getByRole("button", { name: "Custom color #123456" }))
			.toHaveAttribute("aria-pressed", "true");
	});

	it("needs at least one folder", async () => {
		const { run } = await renderApp();
		await addFromLocalFolder(run);

		await expect
			.element(createDialog().getByRole("button", { name: "Create workspace" }))
			.toBeDisabled();
	});

	it("accepts dropped folders and refuses anything else", async () => {
		const { run } = await renderApp();
		await addFromLocalFolder(run);
		await expect.element(createDialog().getByTestId("workspace-folder-dropzone")).toBeVisible();
		const dropZone = createDialog().getByTestId("workspace-folder-dropzone").element();
		const dataTransfer = {
			items: [
				{
					webkitGetAsEntry: () => ({ isDirectory: true }),
					getAsFile: () => new File([], "ProjectDir"),
				},
				{
					webkitGetAsEntry: () => ({ isDirectory: false }),
					getAsFile: () => new File([], "notes.txt"),
				},
			],
		};
		for (const type of ["dragover", "drop"]) {
			const event = new Event(type, { bubbles: true, cancelable: true });
			Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
			dropZone.dispatchEvent(event);
		}

		await expect.element(page.getByText("ProjectDir", { exact: true })).toBeVisible();
		await expect.element(page.getByText("Only folders can be added to a workspace.")).toBeVisible();
	});

	it("explains a workspace that can't be saved", async () => {
		const { run, failNextWith } = await renderApp({ pickedFolders: ["/projects/app"] });
		await addFromLocalFolder(run);
		await createDialog().getByTestId("workspace-folder-dropzone").click();
		await expect.element(createDialog().getByText("app", { exact: true })).toBeVisible();
		failNextWith("Workspace folders must be unique.");

		await createDialog().getByRole("button", { name: "Create workspace" }).click();

		await expect.element(page.getByText("Workspace folders must be unique.")).toBeVisible();
	});

	it("says folders can only be chosen in the desktop app", async () => {
		const { run } = await renderApp({ desktop: false });
		await addFromLocalFolder(run);

		await expect
			.element(createDialog().getByText("Folder selection requires the desktop app."))
			.toBeVisible();
	});
});

describe("New workspace in a new folder", () => {
	it("makes an empty folder named after the workspace at the remembered location", async () => {
		const { run, calls } = await renderApp({ newFolderLocation: "/projects" });
		await addFromLocalFolder(run);

		await createDialog().getByRole("button", { name: "New folder" }).click();
		await createDialog().getByTestId("workspace-name").fill("Fresh Idea");
		await expect
			.element(createDialog().getByTestId("workspace-location-preview"))
			.toHaveAttribute("title", "/projects/Fresh Idea");
		await createDialog().getByRole("button", { name: "Create workspace" }).click();

		await vi.waitFor(() =>
			expect(calls.create).toHaveBeenCalledWith(
				expect.objectContaining({
					name: "Fresh Idea",
					folders: [{ path: "/projects/Fresh Idea", isPrimary: true }],
					createFolders: ["/projects/Fresh Idea"],
					source: "dialog-new-folder",
				}),
			),
		);
		await vi.waitFor(() => expect(calls.setActive).toHaveBeenCalledWith("w-1"));
		await expect.element(createDialog()).not.toBeInTheDocument();
	});

	it("puts the new folder where the person chooses", async () => {
		const { run, calls, open } = await renderApp({
			newFolderLocation: "/projects",
			pickedFolders: ["/elsewhere"],
		});
		await addFromLocalFolder(run);
		await createDialog().getByRole("button", { name: "New folder" }).click();
		await createDialog().getByTestId("workspace-name").fill("Notes");

		await createDialog().getByRole("button", { name: "Change location" }).click();
		await vi.waitFor(() =>
			expect(open).toHaveBeenCalledWith(
				{ directory: true, multiple: false, defaultPath: "/projects" },
				expect.anything(),
			),
		);
		await createDialog().getByRole("button", { name: "Create workspace" }).click();

		await vi.waitFor(() =>
			expect(calls.create).toHaveBeenCalledWith(
				expect.objectContaining({ createFolders: ["/elsewhere/Notes"] }),
			),
		);
	});

	it("needs a name and a location", async () => {
		const { run } = await renderApp({ newFolderLocation: null });
		await addFromLocalFolder(run);
		await createDialog().getByRole("button", { name: "New folder" }).click();
		await createDialog().getByTestId("workspace-name").fill("Notes");

		await expect.element(createDialog().getByText("No location chosen")).toBeVisible();
		await expect
			.element(createDialog().getByRole("button", { name: "Create workspace" }))
			.toBeDisabled();
	});
});

/** acme.templates: a workspace source that makes its folder with kilo.work-sessions' form. */
function templateSource(
	create: (details: NewFolderDetails) => Promise<Workspace>,
	prepare?: () => void,
): GuestPlugin {
	function TemplateSource({ NewFolderForm }: WorkspaceSourceProps) {
		return (
			<NewFolderForm
				description="Name it and choose where it goes."
				suggestedName="starter"
				pendingLabel="Copying…"
				errorTitle="Couldn't copy the template"
				create={create}
			/>
		);
	}
	return {
		manifest: {
			manifestVersion: 1,
			id: "acme.templates",
			displayName: "Acme templates",
			version: "1.0.0",
			requires: { "kilo.work-sessions/workspace-source": "optional" },
			contributes: {
				extensions: {
					"kilo.work-sessions/workspace-source": [
						{
							id: "template",
							title: "Template",
							description: "Start from a template.",
							priority: 10,
						},
					],
				},
			},
		},
		web: definePlugin({
			activate(sdk) {
				sdk.extensions.implement(WorkspaceSource, "template", {
					icon: BookIcon,
					Component: TemplateSource,
					...(prepare ? { prepare } : {}),
				});
			},
		}),
	};
}

describe("workspace sources", () => {
	it("lists contributed sources by priority, and comes back from one", async () => {
		const { run } = await renderApp({ guests: [templateSource(vi.fn())] });
		await run("add-workspace");

		const sources = createDialog().getByRole("button", { name: /folder|template/i });
		await expect.element(sources.nth(1)).toBeVisible();
		expect(sources.elements().map((source) => source.textContent)).toEqual([
			"TemplateStart from a template.",
			"Local folderUse folders on this computer, or create a new one.",
		]);

		await sources.nth(0).click();
		await expect
			.element(
				createDialog()
					.getByTestId("workspace-source-chosen")
					.getByText("Template", { exact: true }),
			)
			.toBeVisible();
		await createDialog().getByRole("button", { name: "Change how to start" }).click();
		await expect
			.element(createDialog().getByRole("heading", { name: "New workspace", exact: true }))
			.toBeVisible();
	});

	it("lets each source warm up once every time the dialog opens", async () => {
		const prepare = vi.fn();
		const { run } = await renderApp({ guests: [templateSource(vi.fn(), prepare)] });

		await run("add-workspace");
		await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));
		await createDialog()
			.getByRole("button", { name: /Template/ })
			.click();
		await createDialog().getByRole("button", { name: "Change how to start" }).click();
		expect(prepare).toHaveBeenCalledTimes(1);

		await userEvent.keyboard("{Escape}");
		await expect.element(createDialog()).not.toBeInTheDocument();
		await run("add-workspace");
		await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(2));
	});

	it("still opens when a source fails to warm up", async () => {
		const { run } = await renderApp({
			guests: [
				templateSource(vi.fn(), () => {
					throw new Error("boom");
				}),
			],
		});

		await run("add-workspace");

		await expect.element(createDialog().getByRole("button", { name: /Template/ })).toBeVisible();
	});

	it("creates through a source's own step and makes the workspace active", async () => {
		const create = vi.fn(async (details: NewFolderDetails) => ({
			...APP,
			id: "w-template",
			name: details.name,
		}));
		const { run, calls } = await renderApp({
			newFolderLocation: "/projects",
			guests: [templateSource(create)],
		});
		await run("add-workspace");
		await createDialog()
			.getByRole("button", { name: /Template/ })
			.click();
		await createDialog().getByRole("button", { name: "Green", exact: true }).click();

		await createDialog().getByRole("button", { name: "Create workspace" }).click();

		await vi.waitFor(() =>
			expect(create).toHaveBeenCalledWith({
				name: "starter",
				color: "#34D399",
				parentPath: "/projects",
			}),
		);
		await vi.waitFor(() => expect(calls.setActive).toHaveBeenCalledWith("w-template"));
		await expect.element(createDialog()).not.toBeInTheDocument();
	});

	it("locks the form while the source creates the workspace", async () => {
		let finish!: (workspace: Workspace) => void;
		const create = vi.fn(
			() =>
				new Promise<Workspace>((resolve) => {
					finish = resolve;
				}),
		);
		const { run } = await renderApp({
			newFolderLocation: "/projects",
			guests: [templateSource(create)],
		});
		await run("add-workspace");
		await createDialog()
			.getByRole("button", { name: /Template/ })
			.click();

		await createDialog().getByRole("button", { name: "Create workspace" }).click();

		await expect.element(createDialog().getByRole("button", { name: "Copying…" })).toBeDisabled();
		await expect.element(createDialog().getByTestId("new-folder-workspace-name")).toBeDisabled();
		await expect
			.element(createDialog().getByRole("button", { name: "Green", exact: true }))
			.toBeDisabled();
		await expect
			.element(createDialog().getByRole("button", { name: "Change how to start" }))
			.toBeDisabled();
		finish({ ...APP, id: "w-template" });
		await expect.element(createDialog()).not.toBeInTheDocument();
	});

	it("explains why a source couldn't create the workspace", async () => {
		const create = vi.fn(async () => {
			throw new Error("Run `gh auth login` first.");
		});
		const { run } = await renderApp({
			newFolderLocation: "/projects",
			guests: [templateSource(create)],
		});
		await run("add-workspace");
		await createDialog()
			.getByRole("button", { name: /Template/ })
			.click();

		await createDialog().getByRole("button", { name: "Create workspace" }).click();

		await expect.element(createDialog().getByText("Couldn't copy the template")).toBeVisible();
		await expect.element(createDialog().getByText("gh auth login")).toBeVisible();
		await expect
			.element(createDialog().getByRole("button", { name: "Create workspace" }))
			.toBeEnabled();
	});
});

describe("origin's active workspace", () => {
	const LEGACY_ACTIVE = "kilo-ui.active-workspace";

	it("makes the workspace origin had active active again, once", async () => {
		const { calls } = await renderApp({
			workspaces: [APP],
			localStorage: { [LEGACY_ACTIVE]: "w-app" },
		});
		await vi.waitFor(() => expect(calls.setActive).toHaveBeenCalledWith("w-app"));

		const seeded = { ...localStorage };
		const again = await renderApp({ workspaces: [APP], localStorage: seeded });
		expect(again.calls.setActive).not.toHaveBeenCalled();
	});

	it("waits for origin's workspaces to be imported", async () => {
		const { calls, host } = await renderApp({ localStorage: { [LEGACY_ACTIVE]: "w-1" } });
		expect(calls.setActive).not.toHaveBeenCalled();

		await host.main.kernelSdk.domainObjects
			.get(Workspaces)
			?.methods.create({ folders: [{ path: "/projects/app", isPrimary: true }] });

		await vi.waitFor(() => expect(calls.setActive).toHaveBeenCalledWith("w-1"));
	});
});

/** Onboarding opens on kilo.shell's work-style step, before the workspace step. */
async function passWorkStyleStep() {
	await expect
		.element(page.getByRole("heading", { name: "Choose how you want to work" }))
		.toBeVisible();
	await page.getByTestId("onboarding-continue").click();
}

describe("onboarding workspace step", () => {
	const onboardingSources = () => page.getByTestId("onboarding-workspace-step");
	const card = () => page.getByTestId("onboarding-card");

	it("offers every source first, then creates from local folders in the card", async () => {
		const { calls } = await renderApp({
			onboarding: true,
			pickedFolders: ["/projects/app"],
			guests: [templateSource(vi.fn())],
		});
		await passWorkStyleStep();
		await expect.element(page.getByRole("heading", { name: "Create a workspace" })).toBeVisible();
		await expect
			.element(onboardingSources().getByRole("button", { name: /Template/ }))
			.toBeVisible();
		await expect.element(page.getByTestId("onboarding-continue")).not.toBeInTheDocument();

		await onboardingSources()
			.getByRole("button", { name: /Local folder/ })
			.click();
		await expect
			.element(
				card().getByTestId("workspace-source-chosen").getByText("Local folder", { exact: true }),
			)
			.toBeVisible();
		await expect.element(page.getByTestId("onboarding-continue")).toBeDisabled();
		await card().getByTestId("workspace-folder-dropzone").click();
		await expect.element(card().getByText("app", { exact: true }).first()).toBeVisible();
		await page.getByTestId("onboarding-continue").click();

		await vi.waitFor(() =>
			expect(calls.create).toHaveBeenCalledWith(expect.objectContaining({ source: "onboarding" })),
		);
		await vi.waitFor(() => expect(calls.setActive).toHaveBeenCalledWith("w-1"));
		await expect.element(page.getByTestId("onboarding-overlay")).not.toBeInTheDocument();
		expect(page.getByRole("dialog", { name: /New workspace/ }).elements()).toEqual([]);
	});

	it("keeps the card in place while moving between screens, so they can animate", async () => {
		await renderApp({ onboarding: true, guests: [templateSource(vi.fn())] });
		await passWorkStyleStep();
		await expect.element(onboardingSources()).toBeVisible();
		const heading = page.getByRole("heading", { name: "Create a workspace" }).element();

		await onboardingSources()
			.getByRole("button", { name: /Template/ })
			.click();
		await expect.element(card().getByTestId("workspace-source-chosen")).toBeVisible();

		expect(page.getByRole("heading", { name: "Create a workspace" }).element()).toBe(heading);
	});

	it("explains a workspace that can't be created", async () => {
		const { failNextWith } = await renderApp({
			onboarding: true,
			pickedFolders: ["/projects/app"],
		});
		await passWorkStyleStep();
		await onboardingSources()
			.getByRole("button", { name: /Local folder/ })
			.click();
		await card().getByTestId("workspace-folder-dropzone").click();
		failNextWith("Workspace folders must be unique.");

		await page.getByTestId("onboarding-continue").click();

		await expect.element(page.getByText("Workspace folders must be unique.")).toBeVisible();
	});

	it("creates through another source's form in the card and moves on", async () => {
		const create = vi.fn(async (details: NewFolderDetails) => ({
			...APP,
			id: "w-template",
			name: details.name,
		}));
		const { calls } = await renderApp({
			onboarding: true,
			newFolderLocation: "/projects",
			guests: [templateSource(create)],
		});
		await passWorkStyleStep();

		await onboardingSources()
			.getByRole("button", { name: /Template/ })
			.click();
		await expect
			.element(card().getByTestId("workspace-source-chosen").getByText("Template", { exact: true }))
			.toBeVisible();
		await page.getByTestId("onboarding-continue").click();

		await vi.waitFor(() =>
			expect(create).toHaveBeenCalledWith(expect.objectContaining({ parentPath: "/projects" })),
		);
		await vi.waitFor(() => expect(calls.setActive).toHaveBeenCalledWith("w-template"));
		await expect.element(page.getByTestId("onboarding-overlay")).not.toBeInTheDocument();
	});

	it("changes how to start from the top of a source's form; Back is the previous step", async () => {
		await renderApp({ onboarding: true, guests: [templateSource(vi.fn())] });
		await passWorkStyleStep();
		await onboardingSources()
			.getByRole("button", { name: /Template/ })
			.click();
		await expect
			.element(card().getByTestId("workspace-source-chosen").getByText("Template", { exact: true }))
			.toBeVisible();

		await card().getByRole("button", { name: "Change how to start" }).click();
		await expect.element(onboardingSources()).toBeVisible();
		await onboardingSources()
			.getByRole("button", { name: /Template/ })
			.click();

		await page.getByTestId("onboarding-back").click();
		await expect
			.element(page.getByRole("heading", { name: "Choose how you want to work" }))
			.toBeVisible();
	});

	it("isn't offered when workspaces already exist", async () => {
		await renderApp({ onboarding: true, workspaces: [APP] });
		await passWorkStyleStep();

		await expect.element(page.getByTestId("onboarding-overlay")).not.toBeInTheDocument();
		expect(page.getByRole("heading", { name: "Create a workspace" }).elements()).toEqual([]);
	});
});
