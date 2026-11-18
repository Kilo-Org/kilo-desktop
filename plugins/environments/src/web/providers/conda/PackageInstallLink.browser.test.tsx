import { focusManager } from "@tanstack/react-query";
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { KernelError, type KernelLogger } from "@kilo-desktop/kernel";
import { Navigation } from "@kilo-desktop/plugin-shell/contracts";
import { Toaster, toast } from "@kilo-desktop/ui/components/sonner";

import type {
	CondaChannelsAddInput,
	CondaChannelsResolveInput,
	CondaChannelsResolveResult,
	CondaEnvsCreateInput,
	CondaPackagesInstallInput,
	CondaPackagesPreviewInput,
	CondaRepodataPackage,
} from "../../../contracts/providers/conda";
import {
	renderWithConda,
	SIGNED_OUT,
	type EnvironmentsHostOptions,
} from "../../../test/environments-host";
import { EnvironmentsPage } from "../../EnvironmentsPage";
import { EnvironmentsPanel } from "./EnvironmentsPanel";

const ENVIRONMENTS = [
	{ name: "dev", prefix: "/opt/anaconda3/envs/dev" },
	{ name: "data", prefix: "/opt/anaconda3/envs/data" },
	{ name: "", prefix: "/opt/anaconda3" },
];

const NUMPY: CondaRepodataPackage = {
	name: "numpy",
	version: "2.1.0",
	build: 0,
	channel: "conda-forge",
	summary: "",
	home: "",
	versions: [
		{ version: "2.1.0", size: 2048 },
		{ version: "1.26.4", size: 1024 },
	],
};

function resolved(
	channel: string,
	configured: boolean,
	overrides: Partial<CondaChannelsResolveResult> = {},
): CondaChannelsResolveResult {
	return {
		channel,
		name: channel,
		isMultichannel: false,
		baseUrls: [`https://conda.anaconda.org/${channel}`],
		configured,
		configuredBy: configured ? [channel] : [],
		exact: true,
		...overrides,
	};
}

interface FlowOptions {
	readonly search: Record<string, string>;
	readonly resolveChannel?: (
		input: CondaChannelsResolveInput,
	) => Promise<CondaChannelsResolveResult>;
	readonly addChannel?: (input: CondaChannelsAddInput) => Promise<string[]>;
	readonly installPackages?: (input: CondaPackagesInstallInput) => Promise<unknown>;
	readonly previewInstall?: (input: CondaPackagesPreviewInput) => Promise<unknown>;
	readonly createEnvironment?: (input: CondaEnvsCreateInput) => Promise<unknown>;
	readonly listEnvironments?: () => Promise<unknown>;
	readonly identity?: EnvironmentsHostOptions["identity"];
	readonly logger?: KernelLogger;
	readonly page?: "panel" | "page";
}

function renderLink(options: FlowOptions) {
	const hostOptions: EnvironmentsHostOptions = {
		search: options.search,
		...(options.identity ? { identity: options.identity } : {}),
		...(options.logger ? { logger: options.logger } : {}),
		handlers: {
			listEnvironments: options.listEnvironments ?? (async () => ENVIRONMENTS),
			prefixOptions: async () => ({
				envsDirs: ["/opt/anaconda3/envs"],
				channels: ["defaults", "conda-forge"],
			}),
			findRepodata: async () => ({ packages: [NUMPY], truncated: false }),
			listPackages: async () => ({ envName: "dev", packages: [] }),
			checkPrefix: async () => ({ available: true }),
			resolveChannel:
				options.resolveChannel ??
				(async ({ channel }: CondaChannelsResolveInput) => resolved(channel, true)),
			addChannel: options.addChannel ?? (async () => ["defaults", "conda-forge"]),
			previewInstall:
				options.previewInstall ??
				(async () => ({
					upgraded: [],
					downgraded: [],
					added: [],
					removed: [],
					rebuilt: [],
					nothingToDo: false,
				})),
			installPackages:
				options.installPackages ?? (async () => ({ jobId: "j", envName: "dev", installed: [] })),
			createEnvironment:
				options.createEnvironment ??
				(async (input: CondaEnvsCreateInput) => ({
					jobId: "j",
					environment: { name: input.name, prefix: input.prefix ?? "" },
				})),
		},
	};
	return renderWithConda(
		<>
			{options.page === "page" ? <EnvironmentsPage /> : <EnvironmentsPanel />}
			<Toaster />
		</>,
		hostOptions,
	);
}

/** The whole document: the flow's dialogs render in portals, and its text changes step by step. */
const screen = page;

const link = (search: Record<string, string>) => ({
	packageAction: "install",
	source: "dot-org",
	...search,
});

afterEach(() => {
	toast.dismiss();
	cleanup();
});

describe("an anaconda.org install link", () => {
	it("goes straight to choosing an environment when the channel is configured", async () => {
		const resolveChannel = vi.fn(async ({ channel }: CondaChannelsResolveInput) =>
			resolved(channel, true),
		);
		await renderLink({
			search: link({ package: "numpy", version: "1.26.4", channel: "conda-forge" }),
			resolveChannel,
		});

		const dialog = screen.getByTestId("environments-install-link-dialog");
		await expect.element(dialog).toHaveAttribute("data-step", "target");
		await expect.element(dialog).toMatchTextContent("Install numpy=1.26.4");
		await expect.element(dialog).toMatchTextContent("From conda-forge.");
		expect(resolveChannel).toHaveBeenCalledWith({ channel: "conda-forge" });
		await expect.element(screen.getByTestId("environments-install-link-env")).toHaveLength(3);
	});

	it("asks anaconda.org's main channel as conda's default channels", async () => {
		const resolveChannel = vi.fn(async ({ channel }: CondaChannelsResolveInput) =>
			resolved(channel, true, { isMultichannel: true }),
		);
		await renderLink({
			search: link({ package: "numpy", channel: "main" }),
			resolveChannel,
		});

		await expect
			.element(screen.getByTestId("environments-install-link-dialog"))
			.toHaveAttribute("data-step", "target");
		expect(resolveChannel).toHaveBeenCalledWith({ channel: "defaults" });
	});

	it("installs from the link's channel first, even when it is configured", async () => {
		const installPackages = vi.fn(async (_input: CondaPackagesInstallInput) => ({
			jobId: "j",
			envName: "dev",
			installed: [],
		}));
		await renderLink({
			search: link({ package: "numpy", channel: "defaults" }),
			installPackages,
		});

		await userEvent.click(screen.getByRole("button", { name: "Install into dev" }));
		const install = screen.getByTestId("environments-conda-add-pkg-install-btn");
		await expect.element(install, { timeout: 4000 }).toBeEnabled();
		await userEvent.click(install);
		await vi.waitFor(() => expect(installPackages).toHaveBeenCalledOnce());
		// conda prefers the channels it is given first.
		expect(installPackages.mock.calls[0]![0]).toMatchObject({
			packages: ["numpy"],
			channels: ["defaults", "conda-forge"],
		});
	});

	it("takes the link off the route once and tracks it without the package or channel", async () => {
		const { host } = await renderLink({
			search: link({ package: "numpy", version: "1.26.4", channel: "conda-forge" }),
		});

		await expect.element(screen.getByTestId("environments-install-link-dialog")).toBeVisible();
		await vi.waitFor(() => {
			expect(host.navigations).toEqual([{ path: "/settings/environments", search: {} }]);
		});
		await vi.waitFor(() => {
			expect(host.tracked).toEqual([
				{
					event: "Package Install Link Received",
					data: { hasVersion: true, hasChannel: true, source: "dot-org" },
				},
			]);
		});
		expect(JSON.stringify(host.tracked)).not.toMatch(/numpy|conda-forge/);
	});

	it("checks without a channel only for the target, and filters environments", async () => {
		const resolveChannel = vi.fn();
		await renderLink({
			search: link({ package: "numpy" }),
			resolveChannel,
		});

		const dialog = screen.getByTestId("environments-install-link-dialog");
		await expect.element(dialog).toHaveAttribute("data-step", "target");
		await expect.element(dialog).not.toMatchTextContent("From");
		await expect.element(screen.getByTestId("environments-install-link-env")).toHaveLength(3);

		await userEvent.fill(screen.getByTestId("environments-install-link-search"), "dat");
		await expect.element(screen.getByTestId("environments-install-link-env")).toHaveLength(1);
		await expect
			.element(screen.getByTestId("environments-install-link-env"))
			.toHaveAccessibleName("Install into data");

		await userEvent.fill(screen.getByTestId("environments-install-link-search"), "nope");
		await expect.element(screen.getByTestId("environments-install-link-empty")).toBeVisible();
		expect(resolveChannel).not.toHaveBeenCalled();
	});

	it("installs once from an unconfigured channel into an existing environment", async () => {
		const addChannel = vi.fn(async () => ["defaults"]);
		const previewInstall = vi.fn(async (_input: CondaPackagesPreviewInput) => ({
			upgraded: [],
			downgraded: [],
			added: [],
			removed: [],
			rebuilt: [],
			nothingToDo: false,
		}));
		const installPackages = vi.fn(async (_input: CondaPackagesInstallInput) => ({
			jobId: "j",
			envName: "dev",
			installed: [],
		}));
		const { host } = await renderLink({
			search: link({ package: "numpy", version: "1.26.4", channel: "bioconda" }),
			resolveChannel: async ({ channel }) => resolved(channel, false),
			addChannel,
			previewInstall,
			installPackages,
		});

		const dialog = screen.getByTestId("environments-install-link-dialog");
		await expect.element(dialog).toHaveAttribute("data-step", "channel");
		await expect
			.element(screen.getByTestId("environments-install-link-channel-description"))
			.toMatchTextContent("which is not one of your conda channels");
		await expect
			.element(screen.getByTestId("environments-install-link-channel-warning"))
			.toMatchTextContent(/run scripts/);
		await userEvent.click(screen.getByTestId("environments-install-link-install-once"));

		await expect.element(dialog).toHaveAttribute("data-step", "target");
		await userEvent.click(screen.getByRole("button", { name: "Install into dev" }));

		const addDialog = screen.getByTestId("environments-conda-add-pkg-dialog");
		await expect.element(addDialog).toBeVisible();
		await expect
			.element(screen.getByTestId("environments-conda-add-pkg-search"))
			.toHaveValue("numpy");
		await expect
			.element(screen.getByTestId("environments-conda-add-pkg-selected-item"))
			.toHaveTextContent("numpy1.26.4");

		await vi.waitFor(() => expect(previewInstall).toHaveBeenCalled(), { timeout: 4000 });
		expect(previewInstall.mock.calls[0]![0]).toMatchObject({
			prefix: "/opt/anaconda3/envs/dev",
			packages: ["numpy=1.26.4"],
			channels: ["bioconda", "conda-forge", "defaults"],
		});
		await expect
			.element(screen.getByTestId("environments-conda-add-pkg-install-btn"))
			.toBeEnabled();
		await userEvent.click(screen.getByTestId("environments-conda-add-pkg-install-btn"));

		await vi.waitFor(() => expect(installPackages).toHaveBeenCalledOnce());
		expect(installPackages.mock.calls[0]![0]).toMatchObject({
			packages: ["numpy=1.26.4"],
			channels: ["bioconda", "conda-forge", "defaults"],
		});
		expect(addChannel).not.toHaveBeenCalled();
		// The environment opens once its package is installed.
		await vi.waitFor(() => {
			expect(host.navigations.at(-1)).toEqual({
				path: "/settings/environments",
				search: { env: "/opt/anaconda3/envs/dev" },
			});
		});
		await expect.element(addDialog).not.toBeInTheDocument();
	});

	it("offers a fresh environment, named after the package, apart from the list", async () => {
		const createEnvironment = vi.fn(async (input: CondaEnvsCreateInput) => ({
			jobId: "j",
			environment: { name: input.name, prefix: input.prefix ?? "" },
		}));
		await renderLink({
			search: link({ package: "numpy", version: "1.26.4", channel: "conda-forge" }),
			createEnvironment,
		});

		const create = screen.getByTestId("environments-install-link-new-env");
		await expect.element(create).toHaveAccessibleName("Create new environment");
		// A choice of its own, not one more row among the environments.
		const list = screen.getByRole("list", { name: "Existing environments" });
		await expect.element(list.getByTestId("environments-install-link-env")).toHaveLength(3);
		expect(list.getByTestId("environments-install-link-new-env").elements()).toHaveLength(0);

		await userEvent.click(create);
		await expect.element(screen.getByTestId("environments-create-dialog")).toBeVisible();
		await expect.element(screen.getByTestId("environments-create-name")).toHaveValue("numpy");
		await expect
			.element(screen.getByTestId("environments-create-selected-item"))
			.toHaveTextContent("numpy1.26.4");

		const submit = screen.getByTestId("environments-create-submit");
		await expect.element(submit).toBeEnabled();
		await userEvent.click(submit);
		await vi.waitFor(() => expect(createEnvironment).toHaveBeenCalledOnce());
		expect(createEnvironment.mock.calls[0]![0]).toMatchObject({
			name: "numpy",
			prefix: "/opt/anaconda3/envs/numpy",
			packages: ["numpy=1.26.4"],
			channels: ["conda-forge", "defaults"],
		});
	});

	it("still offers a fresh environment when the environments fail to load", async () => {
		await renderLink({
			search: link({ package: "numpy" }),
			listEnvironments: async () => {
				throw new KernelError("BUSINESS", "PROVIDER_NOT_READY: bridge failed to start");
			},
		});

		await expect.element(screen.getByTestId("environments-install-link-envs-error")).toBeVisible();
		await userEvent.click(screen.getByTestId("environments-install-link-new-env"));
		await expect.element(screen.getByTestId("environments-create-name")).toHaveValue("numpy");
	});

	it("adds the channel, then creates a new environment with the package", async () => {
		const addChannel = vi.fn(async (_input: CondaChannelsAddInput) => ["defaults", "bioconda"]);
		const createEnvironment = vi.fn(async (input: CondaEnvsCreateInput) => ({
			jobId: "j",
			environment: { name: input.name, prefix: input.prefix ?? "" },
		}));
		const { host } = await renderLink({
			search: link({ package: "numpy", version: "1.26.4", channel: "bioconda" }),
			resolveChannel: async ({ channel }) => resolved(channel, false),
			addChannel,
			createEnvironment,
		});

		const dialog = screen.getByTestId("environments-install-link-dialog");
		await expect.element(dialog).toHaveAttribute("data-step", "channel");
		await userEvent.click(screen.getByTestId("environments-install-link-add-channel"));

		await expect.element(dialog).toHaveAttribute("data-step", "target");
		expect(addChannel).toHaveBeenCalledWith({ channel: "bioconda" });
		await userEvent.click(screen.getByTestId("environments-install-link-new-env"));

		await expect.element(screen.getByTestId("environments-create-dialog")).toBeVisible();
		await expect
			.element(screen.getByTestId("environments-create-package-search"))
			.toHaveValue("numpy");
		await expect
			.element(screen.getByTestId("environments-create-selected-item"))
			.toHaveTextContent("numpy1.26.4");

		await userEvent.fill(screen.getByTestId("environments-create-name"), "linked");
		await expect.element(screen.getByTestId("environments-create-submit")).toBeEnabled();
		await userEvent.click(screen.getByTestId("environments-create-submit"));

		await vi.waitFor(() => expect(createEnvironment).toHaveBeenCalledOnce());
		expect(createEnvironment.mock.calls[0]![0]).toMatchObject({
			name: "linked",
			prefix: "/opt/anaconda3/envs/linked",
			packages: ["numpy=1.26.4"],
			channels: ["bioconda", "conda-forge", "defaults"],
		});
		await expect.element(screen.getByTestId("environments-create-success")).toBeVisible();

		await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
		await vi.waitFor(() => {
			expect(host.navigations.at(-1)).toEqual({
				path: "/settings/environments",
				search: { env: "/opt/anaconda3/envs/linked" },
			});
		});
	});

	it("keeps a newer link's flow open when an install from an earlier link finishes", async () => {
		let finishInstall!: (result: { jobId: string; envName: string; installed: [] }) => void;
		const { host } = await renderLink({
			search: link({ package: "numpy", channel: "conda-forge" }),
			installPackages: () =>
				new Promise((resolve) => {
					finishInstall = resolve;
				}),
		});

		await userEvent.click(screen.getByRole("button", { name: "Install into dev" }));
		const install = screen.getByTestId("environments-conda-add-pkg-install-btn");
		await expect.element(install, { timeout: 4000 }).toBeEnabled();
		await userEvent.click(install);
		await expect.element(install).toHaveTextContent("Installing…");

		// Another link arrives while that install is still running.
		await host.main.kernelSdk.domainObjects.get(Navigation)!.methods.navigate({
			path: "/settings/environments",
			search: link({ package: "pandas" }),
		});
		const dialog = screen.getByTestId("environments-install-link-dialog");
		await expect.element(dialog).toMatchTextContent("Install pandas");

		finishInstall({ jobId: "j", envName: "dev", installed: [] });
		await expect.element(screen.getByText("Packages installed")).toBeVisible();
		expect(host.navigations.at(-1)).toEqual({
			path: "/settings/environments",
			search: { env: "/opt/anaconda3/envs/dev" },
		});
		expect(dialog.elements()).toHaveLength(1);
		await expect.element(dialog).toMatchTextContent("Install pandas");
	});

	it("makes Install once the default for a channel that is not configured", async () => {
		const addChannel = vi.fn(async () => ["defaults"]);
		await renderLink({
			search: link({ package: "numpy", channel: "bioconda" }),
			resolveChannel: async ({ channel }) => resolved(channel, false),
			addChannel,
		});

		const dialog = screen.getByTestId("environments-install-link-dialog");
		await expect.element(dialog).toHaveAttribute("data-step", "channel");
		const installOnce = screen.getByTestId("environments-install-link-install-once");
		await expect.element(installOnce).toHaveFocus();
		// Install once is the primary action; adding the channel is the secondary one.
		const footer = [
			...installOnce.element().parentElement!.querySelectorAll("button[data-qa-id]"),
		].map((button) => button.getAttribute("data-qa-id"));
		expect(footer.at(-1)).toBe("environments-install-link-install-once");

		await userEvent.keyboard("{Enter}");
		await expect.element(dialog).toHaveAttribute("data-step", "target");
		expect(addChannel).not.toHaveBeenCalled();
	});

	it("keeps the person's step when a later check of the channel fails", async () => {
		let checks = 0;
		await renderLink({
			search: link({ package: "numpy", channel: "conda-forge" }),
			resolveChannel: async ({ channel }) => {
				checks += 1;
				if (checks === 1) return resolved(channel, true);
				throw new KernelError("VALIDATION", "INVALID_CHANNEL: Invalid channel.");
			},
		});

		const dialog = screen.getByTestId("environments-install-link-dialog");
		await expect.element(dialog).toHaveAttribute("data-step", "target");
		await userEvent.fill(screen.getByTestId("environments-install-link-search"), "dat");

		// Coming back to the window must not undo an answered check.
		try {
			focusManager.setFocused(false);
			focusManager.setFocused(true);
			await new Promise((resolve) => setTimeout(resolve, 300));
		} finally {
			focusManager.setFocused(undefined);
		}

		await expect.element(dialog).toHaveAttribute("data-step", "target");
		await expect.element(screen.getByTestId("environments-install-link-search")).toHaveValue("dat");
		expect(screen.getByText("This install link is invalid.").elements()).toHaveLength(0);
	});

	it("labels the link's channel in the channel chooser instead of merging it into Anaconda", async () => {
		await renderLink({
			search: link({ package: "numpy", channel: "msys2" }),
			resolveChannel: async ({ channel }) => resolved(channel, false),
		});

		await userEvent.click(screen.getByTestId("environments-install-link-install-once"));
		await userEvent.click(screen.getByRole("button", { name: "Install into dev" }));
		await userEvent.click(screen.getByTestId("environments-conda-add-pkg-channels-btn"));

		const linkOption = screen.getByTestId("environments-channel-option-msys2");
		await expect.element(linkOption).toMatchTextContent("msys2");
		await expect.element(linkOption).toMatchTextContent("From the install link.");
		await expect
			.element(screen.getByTestId("environments-channel-option-defaults"))
			.toMatchTextContent("Anaconda");
	});

	it("says when an older bridge could only compare channel names", async () => {
		await renderLink({
			search: link({ package: "numpy", channel: "pkgs/main" }),
			resolveChannel: async ({ channel }) =>
				resolved(channel, false, { baseUrls: [], exact: false }),
		});

		await expect
			.element(screen.getByTestId("environments-install-link-channel-description"))
			.toMatchTextContent("does not match any of your conda channels by name");
	});

	it("keeps the channel choice when adding the channel fails", async () => {
		await renderLink({
			search: link({ package: "numpy", channel: "bioconda" }),
			resolveChannel: async ({ channel }) => resolved(channel, false),
			addChannel: async () => {
				throw new KernelError("BUSINESS", "PROVIDER_NOT_READY: condarc is read-only");
			},
		});

		await userEvent.click(screen.getByTestId("environments-install-link-add-channel"));

		await expect
			.element(screen.getByTestId("environments-install-link-add-error"))
			.toMatchTextContent("condarc is read-only");
		await expect
			.element(screen.getByTestId("environments-install-link-dialog"))
			.toHaveAttribute("data-step", "channel");
	});

	it("offers Retry when the channel check fails, and Cancel ends the flow", async () => {
		let attempts = 0;
		await renderLink({
			search: link({ package: "numpy", channel: "conda-forge" }),
			resolveChannel: async ({ channel }) => {
				attempts += 1;
				if (attempts === 1) {
					throw new KernelError("BUSINESS", "PROVIDER_NOT_READY: bridge failed to start");
				}
				return resolved(channel, true);
			},
		});

		const dialog = screen.getByTestId("environments-install-link-dialog");
		await expect.element(dialog).toHaveAttribute("data-step", "check-failed");
		await expect
			.element(screen.getByTestId("environments-install-link-error"))
			.toMatchTextContent("The conda backend is not ready");
		await userEvent.click(screen.getByTestId("environments-install-link-retry"));
		await expect.element(dialog).toHaveAttribute("data-step", "target");

		await userEvent.click(screen.getByTestId("environments-install-link-cancel"));
		await expect.element(dialog).not.toBeInTheDocument();
	});

	it("shows the check while it waits", async () => {
		let finish!: (result: CondaChannelsResolveResult) => void;
		await renderLink({
			search: link({ package: "numpy", channel: "conda-forge" }),
			resolveChannel: () =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		});

		const dialog = screen.getByTestId("environments-install-link-dialog");
		await expect.element(dialog).toHaveAttribute("data-step", "checking");
		await expect.element(screen.getByTestId("environments-install-link-checking")).toBeVisible();
		finish(resolved("conda-forge", true));
		await expect.element(dialog).toHaveAttribute("data-step", "target");
	});

	it("closes with a toast when conda says the channel is invalid", async () => {
		const resolveChannel = vi.fn(async (_input: CondaChannelsResolveInput) => {
			throw new KernelError("VALIDATION", "INVALID_CHANNEL: Invalid channel.");
		});
		await renderLink({
			search: link({ package: "numpy", channel: "http://[bad" }),
			resolveChannel,
		});

		await expect.element(screen.getByText("Its channel is not one conda can use.")).toBeVisible();
		expect(resolveChannel).toHaveBeenCalledWith({ channel: "http://[bad" });
		await expect
			.element(screen.getByTestId("environments-install-link-dialog"))
			.not.toBeInTheDocument();
	});

	it("shows a toast and opens nothing when the link names no package", async () => {
		const { host } = await renderLink({ search: link({ channel: "conda-forge" }) });

		await expect.element(screen.getByText("This install link is invalid.")).toBeVisible();
		await expect.element(screen.getByTestId("environments-conda-row").first()).toBeVisible();
		expect(screen.getByTestId("environments-install-link-dialog").elements()).toHaveLength(0);
		expect(host.navigations).toEqual([{ path: "/settings/environments", search: {} }]);
		await vi.waitFor(() => {
			expect(host.tracked).toEqual([
				{
					event: "Package Install Link Rejected",
					data: { reason: "missing-package", source: "dot-org" },
				},
			]);
		});
	});

	it("only logs a link with another action", async () => {
		const warn = vi.fn();
		const logger: KernelLogger = { debug: () => {}, info: () => {}, warn, error: () => {} };
		const { host } = await renderLink({
			search: { packageAction: "remove", package: "numpy" },
			logger,
		});

		await vi.waitFor(() => {
			expect(warn).toHaveBeenCalledWith(expect.stringContaining('unsupported action "remove"'));
		});
		await expect.element(screen.getByTestId("environments-conda-row").first()).toBeVisible();
		expect(screen.getByText("This install link is invalid.").elements()).toHaveLength(0);
		expect(screen.getByTestId("environments-install-link-dialog").elements()).toHaveLength(0);
		expect(host.navigations).toEqual([{ path: "/settings/environments", search: {} }]);
	});

	it("waits on the route while the person is signed out", async () => {
		const { host } = await renderLink({
			page: "page",
			identity: SIGNED_OUT,
			search: link({ package: "numpy" }),
		});

		await expect.element(screen.getByTestId("kilo-auth-gate-signin")).toBeVisible();
		expect(screen.getByTestId("environments-install-link-dialog").elements()).toHaveLength(0);
		expect(host.navigations).toEqual([]);
		expect(host.tracked).toEqual([]);
	});
});
