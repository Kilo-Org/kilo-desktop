import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import { RenderContribution } from "@kilo-desktop/kernel/web";
import chatManifest from "@kilo-desktop/plugin-chat/plugin.json";
import {
	CHAT_DEFINITIONS,
	InteractionRenderer,
	type InteractionRendererImplementation,
	type PermissionDetailProps,
	type PermissionInteraction,
} from "@kilo-desktop/plugin-chat/contracts";
import { SettingsSection } from "@kilo-desktop/plugin-shell/contracts";

import { bootEnvironmentsHost, type EnvironmentsHost } from "../test/environments-host.js";
import { environmentsWebEntry } from "./index.js";

afterEach(cleanup);

const chat = { manifest: chatManifest, definitions: CHAT_DEFINITIONS };

function boot() {
	return bootEnvironmentsHost({ webEntry: environmentsWebEntry, plugins: [chat] });
}

function interactions(host: EnvironmentsHost) {
	return host.renderer.extensions
		.list(InteractionRenderer)
		.filter((contribution) => contribution.pluginId === "kilo.environments");
}

function renderer(host: EnvironmentsHost, id: string) {
	const contribution = interactions(host).find((candidate) => candidate.key === id)!;
	return {
		contribution,
		implementation: contribution.implementation as InteractionRendererImplementation,
	};
}

const selectDetail = (implementation: InteractionRendererImplementation) =>
	implementation.PermissionDetail;

const install: PermissionInteraction = {
	permission: "desktop_environments_conda_packages_install",
	patterns: [],
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
	});

	it("opens its settings when the agent asks", async () => {
		const host = await boot();

		await host.requestSetup();

		expect(host.settingsOpened).toEqual(["environments"]);
	});

	it("names a conda mutation in the card's title and withholds Always allow", async () => {
		const host = await boot();
		const tools = renderer(host, "kilo.environments/conda-tools");

		expect(tools.contribution.metadata.permissions).toContain(install.permission);
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

	it("warns on a bash request that installs a local package file, and asks per action", async () => {
		const host = await boot();
		const cli = renderer(host, "kilo.environments/conda-cli");
		const request: PermissionInteraction = {
			permission: "bash",
			patterns: ["conda install ./evil-1.0.tar.bz2"],
			args: undefined,
		};

		expect(cli.contribution.metadata.permissions).toEqual(["bash"]);
		expect(cli.implementation.allowAlways?.(request)).toBe(false);
		expect(cli.implementation.allowAlways?.({ ...request, patterns: ["ls"] })).toBe(true);

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

	it("shows nothing extra for an ordinary command", async () => {
		const host = await boot();
		const cli = renderer(host, "kilo.environments/conda-cli");

		const { baseElement } = host.render(
			<RenderContribution<PermissionDetailProps>
				contribution={cli.contribution}
				props={{ request: { permission: "bash", patterns: ["ls -la"], args: undefined } }}
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

		expect(answers.contribution.metadata.permissions).toBeUndefined();
		expect(
			answers.implementation.optionWarning?.({
				label: "Install the file",
				description: "conda install ./evil-1.0.tar.bz2",
			}),
		).toMatch(/guardrail/i);
		expect(answers.implementation.optionWarning?.({ label: "Use conda-forge" })).toBeUndefined();
	});
});
