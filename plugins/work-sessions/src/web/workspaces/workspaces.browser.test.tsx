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
import { renderShell } from "@kilo-desktop/plugin-shell/testing";

import manifest from "../../../plugin.json";
import {
	Workspaces,
	WORK_SESSIONS_DEFINITIONS,
	type CreateWorkspaceInput,
	type Workspace,
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
function fakeWorkspacesMain(initial: Workspace[], options: { unavailable?: string[] } = {}) {
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
	} = {},
) {
	const fake = fakeWorkspacesMain(options.workspaces ?? [], {
		...(options.unavailable ? { unavailable: options.unavailable } : {}),
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
const manager = () => page.getByTestId("workspace-manager-dialog");

describe("Manage workspaces", () => {
	it("explains there are none yet, and creates one from the footer", async () => {
		const { run } = await renderApp();

		await run("manage-workspaces");

		await expect.element(manager().getByText("No workspaces yet")).toBeVisible();
		await manager().getByRole("button", { name: "Create workspace" }).click();
		await expect.element(formDialog()).toBeVisible();
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

		await run("add-workspace");
		await formDialog().getByTestId("workspace-folder-dropzone").click();
		await vi.waitFor(() =>
			expect(open).toHaveBeenCalledWith({ directory: true, multiple: true }, expect.anything()),
		);
		await formDialog().getByRole("button", { name: "Make primary" }).click();
		await formDialog().getByRole("button", { name: "Green", exact: true }).click();
		await formDialog().getByRole("button", { name: "Create workspace" }).click();

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
		await expect.element(formDialog()).not.toBeInTheDocument();
	});

	it("makes the next folder primary when the primary is removed", async () => {
		const { run, calls } = await renderApp({ pickedFolders: ["/projects/app", "/projects/docs"] });
		await run("add-workspace");
		await formDialog().getByTestId("workspace-folder-dropzone").click();
		await expect.element(formDialog().getByText("docs", { exact: true })).toBeVisible();

		await formDialog().getByRole("button", { name: "Remove /projects/app" }).click();
		await formDialog().getByRole("button", { name: "Create workspace" }).click();

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
		await run("add-workspace");

		await expect
			.element(formDialog().getByRole("button", { name: "Create workspace" }))
			.toBeDisabled();
	});

	it("accepts dropped folders and refuses anything else", async () => {
		const { run } = await renderApp();
		await run("add-workspace");
		await expect.element(formDialog().getByTestId("workspace-folder-dropzone")).toBeVisible();
		const dropZone = formDialog().getByTestId("workspace-folder-dropzone").element();
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
		await run("add-workspace");
		await formDialog().getByTestId("workspace-folder-dropzone").click();
		await expect.element(formDialog().getByText("app", { exact: true })).toBeVisible();
		failNextWith("Workspace folders must be unique.");

		await formDialog().getByRole("button", { name: "Create workspace" }).click();

		await expect.element(page.getByText("Workspace folders must be unique.")).toBeVisible();
	});

	it("says folders can only be chosen in the desktop app", async () => {
		const { run } = await renderApp({ desktop: false });
		await run("add-workspace");

		await expect
			.element(formDialog().getByText("Folder selection requires the desktop app."))
			.toBeVisible();
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
	it("creates the first workspace and makes it active", async () => {
		const { calls } = await renderApp({ onboarding: true, pickedFolders: ["/projects/app"] });
		await passWorkStyleStep();

		await expect.element(page.getByRole("heading", { name: "Create a workspace" })).toBeVisible();
		await expect.element(page.getByTestId("onboarding-continue")).toBeDisabled();
		await page.getByTestId("workspace-folder-dropzone").click();
		await page.getByTestId("onboarding-continue").click();

		await vi.waitFor(() =>
			expect(calls.create).toHaveBeenCalledWith(expect.objectContaining({ source: "onboarding" })),
		);
		await vi.waitFor(() => expect(calls.setActive).toHaveBeenCalledWith("w-1"));
		await expect.element(page.getByRole("heading", { name: "You're all set" })).toBeVisible();
	});

	it("explains a workspace that can't be created", async () => {
		const { failNextWith } = await renderApp({
			onboarding: true,
			pickedFolders: ["/projects/app"],
		});
		await passWorkStyleStep();
		await page.getByTestId("workspace-folder-dropzone").click();
		failNextWith("Workspace folders must be unique.");

		await page.getByTestId("onboarding-continue").click();

		await expect.element(page.getByText("Workspace folders must be unique.")).toBeVisible();
	});

	it("isn't offered when workspaces already exist", async () => {
		await renderApp({ onboarding: true, workspaces: [APP] });
		await passWorkStyleStep();

		await expect.element(page.getByRole("heading", { name: "You're all set" })).toBeVisible();
	});
});
