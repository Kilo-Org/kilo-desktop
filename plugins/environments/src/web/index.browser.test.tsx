import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import { definePlugin, type KernelLogger } from "@kilo-desktop/kernel";
import { createTestKernelPair } from "@kilo-desktop/kernel/testing";
import { KernelProvider, RenderContribution } from "@kilo-desktop/kernel/web";
import chatManifest from "@kilo-desktop/plugin-chat/plugin.json";
import {
	CHAT_DEFINITIONS,
	PermissionRenderer,
	type PermissionRendererImplementation,
	type PermissionDetailProps,
	type PermissionInteraction,
} from "@kilo-desktop/plugin-chat/contracts";
import { SettingsSection } from "@kilo-desktop/plugin-shell/contracts";

import manifest from "../../plugin.json";
import { ENVIRONMENTS_DEFINITIONS, ENVIRONMENTS_FLAG } from "../contracts/index";
import { bootEnvironmentsHost, type EnvironmentsHost } from "../test/environments-host";
import { EnvironmentsPage, environmentsWebEntry } from "./index";

afterEach(cleanup);

const chat = { manifest: chatManifest, definitions: CHAT_DEFINITIONS };

function boot() {
	return bootEnvironmentsHost({ webEntry: environmentsWebEntry, plugins: [chat] });
}

function interactions(host: EnvironmentsHost) {
	return host.renderer.extensions
		.list(PermissionRenderer)
		.filter((contribution) => contribution.pluginId === "kilo.environments");
}

function renderer(host: EnvironmentsHost, id: string) {
	const contribution = interactions(host).find((candidate) => candidate.key === id)!;
	return {
		contribution,
		implementation: contribution.implementation as PermissionRendererImplementation,
	};
}

const selectDetail = (implementation: PermissionRendererImplementation) =>
	implementation.PermissionDetail;

const install: PermissionInteraction = {
	permission: "desktop_environments_conda_packages_install",
	toolKey: "kilo.environments/conda.packages.install",
	patterns: [],
	metadata: {},
	args: { name: "dev", packages: ["numpy", "./evil-1.0.tar.bz2"], channels: ["bioconda"] },
};

describe("kilo.environments in the window", () => {
	it("contributes the Conda Environments settings page, shown while the flag is on", async () => {
		const host = await boot();
		expect(
			host.renderer.extensions
				.list(SettingsSection)
				.some((candidate) => candidate.pluginId === "kilo.environments"),
		).toBe(false);
		const section = host.renderer.extensions
			.all(SettingsSection)
			.find((candidate) => candidate.key === "kilo.environments/environments");

		expect(section?.metadata.title).toBe("Conda Environments");
		expect(section?.implementation).toBeDefined();

		const flagged = await bootEnvironmentsHost({
			webEntry: environmentsWebEntry,
			plugins: [chat],
			flags: { [ENVIRONMENTS_FLAG]: true },
		});
		expect(
			flagged.renderer.extensions.list(SettingsSection).map((candidate) => candidate.key),
		).toContain("kilo.environments/environments");
	});

	it("names a conda mutation in the card's title and withholds Always allow", async () => {
		const host = await boot();
		const tools = renderer(host, "kilo.environments/conda-tools");

		expect(tools.contribution.metadata.tools).toContain(install.toolKey);
		expect(tools.implementation.permissionTitle?.(install)).toBe("installing conda packages");
		expect(tools.implementation.allowAlways?.(install)).toBe(false);
	});

	it("summarises what a conda mutation will install, and from where", async () => {
		const host = await boot();
		const tools = renderer(host, "kilo.environments/conda-tools");

		const { baseElement } = host.render(
			<RenderContribution<PermissionDetailProps>
				contribution={tools.contribution}
				props={{ request: install }}
				select={selectDetail}
			/>,
		);
		const screen = page.elementLocator(baseElement);

		const summary = screen.getByTestId("conda-permission-summary");
		await expect.element(summary).toBeVisible();
		await expect.element(summary.getByText("dev")).toBeVisible();
		await expect.element(summary.getByText(/numpy/)).toBeVisible();
		await expect.element(summary.getByText(/bioconda/).first()).toBeVisible();
	});

	it("shows a clone's source environment, not just the new name", async () => {
		const host = await boot();
		const tools = renderer(host, "kilo.environments/conda-tools");
		const clone: PermissionInteraction = {
			permission: "desktop_environments_conda_envs_clone",
			toolKey: "kilo.environments/conda.envs.clone",
			patterns: [],
			metadata: {},
			args: { sourceName: "scratch", sourcePrefix: "/home/u/anaconda3/envs/prod", name: "copy" },
		};

		const { baseElement } = host.render(
			<RenderContribution<PermissionDetailProps>
				contribution={tools.contribution}
				props={{ request: clone }}
				select={selectDetail}
			/>,
		);
		const summary = page.elementLocator(baseElement).getByTestId("conda-permission-summary");

		await expect.element(summary.getByText("Clone from")).toBeVisible();
		await expect.element(summary.getByText("/home/u/anaconda3/envs/prod")).toBeVisible();
		await expect.element(summary.getByText("New environment")).toBeVisible();
		await expect.element(summary.getByText("copy")).toBeVisible();
	});

	it("warns on a bash request that installs a local package file, and asks per action", async () => {
		const host = await boot();
		const cli = renderer(host, "kilo.environments/conda-cli");
		const request: PermissionInteraction = {
			permission: "bash",
			patterns: ["conda install ./evil-1.0.tar.bz2"],
			metadata: {},
			args: undefined,
		};

		// Renderers match on tools, so `conda-cli` picks out `bash` requests itself.
		expect(cli.contribution.metadata.tools).toBeUndefined();
		expect(cli.implementation.allowAlways?.({ ...request, permission: "edit" })).toBe(true);
		expect(cli.implementation.allowAlways?.(request)).toBe(false);
		expect(cli.implementation.allowAlways?.({ ...request, patterns: ["ls"] })).toBe(true);
		// Kilo v2 names the shell permission `shell`.
		expect(cli.implementation.allowAlways?.({ ...request, permission: "shell" })).toBe(false);

		const { baseElement } = host.render(
			<RenderContribution<PermissionDetailProps>
				contribution={cli.contribution}
				props={{ request }}
				select={selectDetail}
			/>,
		);
		await expect
			.element(page.elementLocator(baseElement).getByTestId("conda-local-file-warning"))
			.toBeVisible();
	});

	it("warns on Kilo v2's shell request the same way", async () => {
		const host = await boot();
		const cli = renderer(host, "kilo.environments/conda-cli");

		const { baseElement } = host.render(
			<RenderContribution<PermissionDetailProps>
				contribution={cli.contribution}
				props={{
					request: {
						permission: "shell",
						patterns: ["conda install ./evil-1.0.tar.bz2"],
						metadata: {},
						args: undefined,
					},
				}}
				select={selectDetail}
			/>,
		);
		await expect
			.element(page.elementLocator(baseElement).getByTestId("conda-local-file-warning"))
			.toBeVisible();
	});

	it("leaves requests other than the shell to their own renderers", async () => {
		const host = await boot();
		const cli = renderer(host, "kilo.environments/conda-cli");

		const { baseElement } = host.render(
			<RenderContribution<PermissionDetailProps>
				contribution={cli.contribution}
				props={{
					request: {
						permission: "edit",
						patterns: ["conda install ./evil-1.0.tar.bz2"],
						metadata: {},
						args: undefined,
					},
				}}
				select={selectDetail}
			/>,
		);

		await expect
			.poll(() => baseElement.querySelector('[data-qa-id="conda-local-file-warning"]'))
			.toBeNull();
	});

	it("shows nothing extra for an ordinary command", async () => {
		const host = await boot();
		const cli = renderer(host, "kilo.environments/conda-cli");

		const { baseElement } = host.render(
			<RenderContribution<PermissionDetailProps>
				contribution={cli.contribution}
				props={{
					request: { permission: "bash", patterns: ["ls -la"], metadata: {}, args: undefined },
				}}
				select={selectDetail}
			/>,
		);

		await expect
			.poll(() => baseElement.querySelector('[data-qa-id="conda-local-file-warning"]'))
			.toBeNull();
	});

	it("warns under an agent answer that installs a local package file", async () => {
		const host = await boot();
		const answers = renderer(host, "kilo.environments/local-file-answers");

		expect(answers.contribution.metadata.tools).toBeUndefined();
		expect(
			answers.implementation.optionWarning?.({
				label: "Install the file",
				description: "conda install ./evil-1.0.tar.bz2",
			}),
		).toMatch(/guardrail/i);
		expect(answers.implementation.optionWarning?.({ label: "Use conda-forge" })).toBeUndefined();
	});
});

describe("kilo.environments' renderer entry without other plugins", () => {
	it("activates and shows its page without errors when kilo.core, kilo.shell and kilo.chat are absent", async () => {
		const errors: unknown[][] = [];
		const logger: KernelLogger = {
			debug: () => undefined,
			info: () => undefined,
			warn: () => undefined,
			error: (...args: unknown[]) => void errors.push(args),
		};
		const { main, renderer } = await createTestKernelPair({
			main: [
				{
					manifest,
					definitions: ENVIRONMENTS_DEFINITIONS,
					entry: definePlugin({ activate: () => {} }),
				},
			],
			renderer: [{ manifest, definitions: ENVIRONMENTS_DEFINITIONS, entry: environmentsWebEntry }],
			logger,
		});
		await main.flush();

		render(
			<KernelProvider kernel={renderer} as={manifest.id}>
				<QueryClientProvider
					client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
				>
					<EnvironmentsPage />
				</QueryClientProvider>
			</KernelProvider>,
		);
		// Without main's `conda` the status stays unknown: the page's loading state.
		await expect
			.element(page.getByTestId("environments-page"))
			.toHaveAttribute("data-state", "loading");
		expect(errors).toEqual([]);
	});
});
