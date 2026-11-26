import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { KernelError, KernelFlags, KernelOs, KernelService } from "@kilo-desktop/kernel";
import { SettingsSection } from "@kilo-desktop/plugin-shell/contracts";
import { renderShell } from "@kilo-desktop/plugin-shell/testing";

import {
	agentServer,
	contributor,
	developer,
	DEVELOPER_ON,
	flagSource,
	openDiagnostics,
	pluginsHost,
	rowIds,
} from "../test/diagnostics";
import { DEVELOPER_FLAG, DEVELOPER_SETTINGS_CATEGORY } from "../contracts";

describe("the Developer settings category", () => {
	const sectionsIn = (id: string) =>
		[
			...page
				.getByTestId(`settings-group-${id}`)
				.element()
				.parentElement!.querySelectorAll("[data-qa-id^='settings-section-']"),
		].map((element) => element.getAttribute("data-qa-id"));

	it("comes last in Settings, with Diagnostics and other plugins' developer sections under it", async () => {
		await renderShell(
			[
				developer,
				contributor(
					"acme.devtools",
					{
						"kilo.shell/settings-section": [
							{ id: "inspector", title: "Inspector", category: DEVELOPER_SETTINGS_CATEGORY },
						],
					},
					(sdk) =>
						sdk.extensions.implement(SettingsSection, "inspector", { component: () => null }),
				),
			],
			DEVELOPER_ON,
		);
		await page.getByTestId("nav-settings").click();
		await expect.element(page.getByTestId("settings-group-developer")).toBeVisible();

		const groups = page
			.getByTestId(/^settings-group-/)
			.elements()
			.map((element) => element.textContent);
		expect(groups.at(-1)).toBe("Developer");
		expect(sectionsIn("developer")).toEqual([
			"settings-section-diagnostics",
			"settings-section-inspector",
		]);
	});

	async function expectDeveloperHidden() {
		await page.getByTestId("nav-settings").click();
		await expect.element(page.getByTestId("settings-group-general")).toBeVisible();

		await expect.element(page.getByTestId("settings-group-developer")).not.toBeInTheDocument();
		await expect.element(page.getByTestId("settings-section-diagnostics")).not.toBeInTheDocument();
	}

	it("is absent without kilo.developer", async () => {
		await renderShell();
		await expectDeveloperHidden();
	});

	it("is hidden, with Diagnostics, while the developer flag has its default (off)", async () => {
		const { main } = await renderShell([developer]);
		await expectDeveloperHidden();
		expect(main.pluginState("kilo.developer")).toBe("inactive");
	});

	it("declares its flags while inactive, so a flag source can turn it on", async () => {
		const { main } = await renderShell([developer]);
		await expectDeveloperHidden();

		const flags = main.kernelSdk.domainObjects.get(KernelFlags)?.getState().flags;
		expect(flags?.[DEVELOPER_FLAG]).toMatchObject({
			value: false,
			default: false,
			origin: "default",
			pluginId: "kilo.developer",
		});
		expect(flags?.["force-onboarding"]).toMatchObject({ value: false, pluginId: "kilo.developer" });
	});

	it("appears, with Diagnostics, as soon as the flag turns on, and goes when it turns off", async () => {
		const source = flagSource();
		await renderShell([developer, source.plugin]);
		await expectDeveloperHidden();
		const setFlag = (on: boolean) => source.set({ [DEVELOPER_FLAG]: on });

		setFlag(true);

		await expect.element(page.getByTestId("settings-group-developer")).toBeVisible();
		await page.getByTestId("settings-section-diagnostics").click();
		await expect.element(page.getByTestId("diagnostics-settings")).toBeVisible();

		setFlag(false);

		await expect.element(page.getByTestId("settings-group-developer")).not.toBeInTheDocument();
	});

	it("sends other plugins' developer sections to General while the flag is off", async () => {
		await renderShell([
			developer,
			contributor(
				"acme.devtools",
				{
					"kilo.shell/settings-section": [
						{ id: "inspector", title: "Inspector", category: DEVELOPER_SETTINGS_CATEGORY },
					],
				},
				(sdk) => sdk.extensions.implement(SettingsSection, "inspector", { component: () => null }),
			),
		]);
		await page.getByTestId("nav-settings").click();
		await expect.element(page.getByTestId("settings-section-inspector")).toBeVisible();

		await expect.element(page.getByTestId("settings-group-developer")).not.toBeInTheDocument();
		expect(sectionsIn("general")).toContain("settings-section-inspector");
	});
});

describe("diagnostics settings", () => {
	it("shows the kernel, every plugin with its state, and problems", async () => {
		const broken = contributor("acme.broken", {}, () => {
			throw new Error("missing binary");
		});
		await openDiagnostics([broken]);

		await expect.element(page.getByTestId("diagnostics-kernel")).toBeVisible();
		await expect
			.element(page.getByTestId("diagnostics-plugin-kilo.shell").getByText("active"))
			.toBeVisible();
		await expect
			.element(page.getByTestId("diagnostics-problem").getByText(/missing binary/))
			.toBeVisible();

		await page.getByRole("button", { name: "Show details for acme.broken" }).click();
		await expect
			.element(
				page
					.getByTestId("diagnostics-plugin-details-acme.broken")
					.getByText(/^Error: .*missing binary/),
			)
			.toBeVisible();
	});

	it("expands the kernel to show the points, domain objects and context keys it owns", async () => {
		await openDiagnostics();

		await page.getByRole("button", { name: "Show details for kernel" }).click();

		const details = page.getByTestId("diagnostics-kernel-details");
		await expect.element(details.getByText("kernel/service", { exact: true })).toBeVisible();
		await expect.element(details.getByText("kernel/app", { exact: true })).toBeVisible();
		await expect.element(details.getByText("kernel/desktop", { exact: true })).toBeVisible();
		await expect.element(details.getByText("Platform")).toBeVisible();
		// Only what the kernel owns, not plugins' points.
		await expect
			.element(details.getByText("acme.server/tool-panel", { exact: true }))
			.not.toBeInTheDocument();
	});

	it("leaves every column of a row room for its text at the settings page's width", async () => {
		await openDiagnostics();
		await page.getByTestId("diagnostics-tab-services").click();

		const rows = document.querySelectorAll<HTMLElement>(
			'[data-qa-id^="diagnostics-kernel"], [data-qa-id^="diagnostics-service-acme"]',
		);
		expect(rows.length).toBeGreaterThan(0);
		for (const row of rows) {
			const grid = row.querySelector<HTMLElement>(".grid")!;
			for (const cell of grid.children) {
				// Wide enough for a short word like "Task" or "macOS".
				expect(
					cell.getBoundingClientRect().width,
					`${row.dataset.qaId}: ${cell.textContent} in ${grid.getBoundingClientRect().width}`,
				).toBeGreaterThan(24);
			}
		}
	});

	it("lists plugins as separate rows that start collapsed", async () => {
		await openDiagnostics();

		// kilo.shell, kilo.developer, kilo.core and acme.server.
		const rows = page.getByTestId("diagnostics-plugins").element().children;
		expect(rows).toHaveLength(4);
		await expect
			.element(page.getByTestId("diagnostics-plugin-details-acme.server"))
			.not.toBeInTheDocument();
	});

	it("lists plugins alphabetically by name", async () => {
		await openDiagnostics([contributor("acme.zeta", {}), agentServer()]);

		expect(rowIds("diagnostics-plugins")).toEqual([
			"diagnostics-plugin-acme.server",
			"diagnostics-plugin-acme.zeta",
			"diagnostics-plugin-kilo.developer",
			"diagnostics-plugin-kilo.core",
			"diagnostics-plugin-kilo.shell",
		]);
	});

	it("lines up each plugin's name, id and version in columns", async () => {
		const broken = contributor("acme.broken", {}, () => {
			throw new Error("missing binary");
		});
		await openDiagnostics([broken, agentServer()]);

		const left = (id: string, text: string) =>
			page
				.getByTestId(`diagnostics-plugin-${id}`)
				.getByText(text, { exact: true })
				// Test manifests reuse the id as the display name; the id column comes last.
				.last()
				.element()
				.getBoundingClientRect().left;
		// A failed badge is wider than an active one; the columns must not shift with it.
		expect(left("acme.broken", "acme.broken")).toBe(left("acme.server", "acme.server"));
		expect(left("acme.broken", "1.0.0")).toBe(left("acme.server", "1.0.0"));
	});

	it("expands a plugin to summarise what it offers, contributes and needs", async () => {
		await openDiagnostics();

		await page.getByRole("button", { name: "Show details for acme.server" }).click();

		const details = page.getByTestId("diagnostics-plugin-details-acme.server");
		await expect.element(details.getByText("Runs the agent server.")).toBeVisible();
		await expect.element(details.getByText("acme.server/tool-panel")).toBeVisible();
		// Each point heads a list of the contributions made to it.
		const group = details.getByTestId("diagnostics-contribution-kilo.shell/settings-section");
		await expect.element(group.getByText("kilo.shell/settings-section")).toBeVisible();
		expect(
			group
				.getByRole("listitem")
				.elements()
				.map((item) => item.textContent),
		).toEqual(["models", "tools", "safe"]);
		await expect.element(details.getByText("os", { exact: true })).toBeVisible();
		await expect.element(details.getByText("acme.server/busy")).toBeVisible();
		await expect
			.element(details.getByTestId("diagnostics-link-kilo.shell/navigation"))
			.toBeVisible();
		await expect.element(details.getByText("optional", { exact: true })).toBeVisible();
		await expect
			.element(details.getByText("kilo.shell/settings-section", { exact: true }).last())
			.toBeVisible();
		await expect.element(details.getByText(/"acme.missing" is not installed/)).toBeVisible();

		await page.getByRole("button", { name: "Hide details for acme.server" }).click();
		await expect.element(details).not.toBeInTheDocument();
	});

	it("expands and collapses from anywhere on the row, including the badge and chevron", async () => {
		await openDiagnostics();
		const row = page.getByTestId("diagnostics-plugin-acme.server");
		const details = page.getByTestId("diagnostics-plugin-details-acme.server");

		// Forced clicks land on whatever is at the element's position, as a person's click would.
		await row.getByText("active").click({ force: true });
		await expect.element(details).toBeVisible();

		await row.getByTestId("diagnostics-row-chevron").click({ force: true });
		await expect.element(details).not.toBeInTheDocument();
	});
});

describe("diagnostics settings — services and logs", () => {
	async function withService() {
		const service = { start: vi.fn() };
		const showLogs = vi.fn(() => ({ revealed: true }));
		const { main } = await openDiagnostics();
		main.sdkFor("acme.server").extensions.implement(KernelService, "daemon", service);
		main.kernelSdk.domainObjects.provide(KernelOs, {
			initialState: {},
			methods: {
				openExternal: () => true,
				showItemInFolder: () => {},
				showLogs,
				logFilePath: () => "/logs/main.log",
			},
		});
		await page.getByTestId("diagnostics-tab-services").click();
		const row = page.getByTestId("diagnostics-service-acme.server/daemon");
		await expect.element(row.getByText("Agent server")).toBeVisible();
		return { service, showLogs, row };
	}

	it("lists services, restarts one, and opens the logs", async () => {
		const { service, showLogs, row } = await withService();

		await row.getByRole("button", { name: "Restart" }).click();
		await page.getByTestId("diagnostics-open-logs").click();

		await expect.poll(() => service.start.mock.calls.length).toBe(2);
		await expect
			.element(page.getByTestId("diagnostics-service-details-acme.server/daemon"))
			.not.toBeInTheDocument();
		await expect.poll(() => showLogs).toHaveBeenCalled();
	});

	it("expands a service to show how it runs", async () => {
		await withService();

		await page.getByRole("button", { name: "Show details for Agent server" }).click();

		const details = page.getByTestId("diagnostics-service-details-acme.server/daemon");
		await expect.element(details.getByText("acme.server", { exact: true })).toBeVisible();
		await expect.element(details.getByText("Daemon")).toBeVisible();
		await expect.element(details.getByText("When its plugin activates")).toBeVisible();
		await expect.element(details.getByText("On failure, up to 3 times")).toBeVisible();
		await expect.element(details.getByText("0", { exact: true })).toBeVisible();
	});

	it("lists services alphabetically by title", async () => {
		const services = contributor("acme.jobs", {
			"kernel/service": [
				{ id: "zip", title: "Zip archives", kind: "task", startOn: "first-use" },
				{ id: "build", title: "Build cache", kind: "task", startOn: "first-use" },
			],
		});
		await openDiagnostics([services, agentServer()]);
		await page.getByTestId("diagnostics-tab-services").click();

		// kilo.core's services are listed among them too.
		expect(rowIds("diagnostics-services").filter((id) => id?.includes("acme."))).toEqual([
			"diagnostics-service-acme.server/daemon",
			"diagnostics-service-acme.jobs/build",
			"diagnostics-service-acme.server/index",
			"diagnostics-service-acme.jobs/zip",
		]);
	});

	it("lines up each service's kind, plugin and restart button in columns", async () => {
		await openDiagnostics();
		await page.getByTestId("diagnostics-tab-services").click();
		const daemon = page.getByTestId("diagnostics-service-acme.server/daemon");
		const task = page.getByTestId("diagnostics-service-acme.server/index");
		await expect.element(daemon.getByText("Daemon", { exact: true })).toBeVisible();
		await expect.element(task.getByText("Task", { exact: true })).toBeVisible();

		const left = (locator: { element(): Element }) =>
			locator.element().getBoundingClientRect().left;
		expect(left(daemon.getByText("Daemon"))).toBe(left(task.getByText("Task")));
		expect(left(daemon.getByText("acme.server"))).toBe(left(task.getByText("acme.server")));
		// The status badges differ in width; the restart buttons must not shift with them.
		expect(left(daemon.getByRole("button", { name: "Restart" }))).toBe(
			left(task.getByRole("button", { name: "Restart" })),
		);
	});

	it("describes a task that is never restarted", async () => {
		await openDiagnostics();
		await page.getByTestId("diagnostics-tab-services").click();

		await page.getByRole("button", { name: "Show details for Index files" }).click();

		const details = page.getByTestId("diagnostics-service-details-acme.server/index");
		await expect.element(details.getByText("Task")).toBeVisible();
		await expect.element(details.getByText("On first use")).toBeVisible();
		await expect.element(details.getByText("Never restarted")).toBeVisible();
	});

	it("shows a failed service's local detail next to its error", async () => {
		const { main } = await openDiagnostics();
		main.sdkFor("acme.server").extensions.implement(KernelService, "daemon", {
			start: async () => {
				throw new KernelError("BUSINESS", "Server exited before becoming ready (code 1).", {
					detail: "Configuration is invalid\n↳ Unrecognized key: reasoning_display",
				});
			},
		});
		await page.getByTestId("diagnostics-tab-services").click();

		await page.getByRole("button", { name: "Show details for Agent server" }).click();

		const details = page.getByTestId("diagnostics-service-details-acme.server/daemon");
		await expect
			.element(details.getByText("Server exited before becoming ready (code 1)."))
			.toBeVisible();
		await expect.element(details.getByText(/Unrecognized key: reasoning_display/)).toBeVisible();
	});
});

describe("diagnostics settings — tabs", () => {
	it("shows plugins first and services on their own tab", async () => {
		await openDiagnostics();

		await expect.element(page.getByTestId("diagnostics-plugins")).toBeVisible();
		await expect
			.element(page.getByTestId("diagnostics-tab-plugins"))
			.toHaveAttribute("aria-selected", "true");
		await expect.element(page.getByTestId("diagnostics-services")).not.toBeInTheDocument();

		await page.getByTestId("diagnostics-tab-services").click();

		await expect.element(page.getByTestId("diagnostics-services")).toBeVisible();
		await expect.element(page.getByTestId("diagnostics-plugins")).not.toBeInTheDocument();
	});

	it("keeps the plugin changes section, and a pending restart, in view on every tab", async () => {
		const { options } = pluginsHost();
		await openDiagnostics([agentServer()], options);
		const restart = page.getByTestId("diagnostics-restart");
		await expect.element(restart).toBeDisabled();

		await page
			.getByTestId("diagnostics-plugin-acme.server")
			.getByRole("switch", { name: "Enable acme.server" })
			.click();
		await expect.element(restart).toBeEnabled();

		await page.getByTestId("diagnostics-tab-services").click();

		await expect.element(page.getByTestId("diagnostics-plugin-changes")).toBeVisible();
		await expect.element(restart).toBeEnabled();
	});
});

describe("diagnostics settings — turning plugins on and off", () => {
	const restart = () => page.getByTestId("diagnostics-restart");

	it("turns a plugin off from the next launch and offers to restart", async () => {
		const { saveDisabled, relaunch, options } = pluginsHost();
		await openDiagnostics([agentServer()], options);
		const row = page.getByTestId("diagnostics-plugin-acme.server");
		const toggle = row.getByRole("switch", { name: "Enable acme.server" });
		await expect.element(toggle).toBeChecked();
		await expect.element(restart()).toBeDisabled();

		await toggle.click();

		await expect.element(toggle).not.toBeChecked();
		expect(saveDisabled).toHaveBeenLastCalledWith(["acme.server"]);
		// Still running until the restart; the switch doesn't expand the row.
		await expect.element(row.getByText("active")).toBeVisible();
		await expect
			.element(page.getByTestId("diagnostics-plugin-details-acme.server"))
			.not.toBeInTheDocument();
		await expect.element(restart()).toBeEnabled();
		await restart().click();
		await expect.poll(() => relaunch).toHaveBeenCalledWith({ safeMode: false });
	});

	it("shows a plugin turned off at this launch as disabled, and turns it back on", async () => {
		const { saveDisabled, options } = pluginsHost(["acme.server"]);
		await openDiagnostics([agentServer()], options);
		const row = page.getByTestId("diagnostics-plugin-acme.server");
		await expect.element(row.getByText("disabled")).toBeVisible();
		await expect.element(restart()).toBeDisabled();

		await row.getByRole("switch", { name: "Enable acme.server" }).click();

		expect(saveDisabled).toHaveBeenLastCalledWith([]);
		await expect.element(restart()).toBeEnabled();
	});

	it("turns off every plugin it can at once, and turns them all back on", async () => {
		const { saveDisabled, options } = pluginsHost();
		await openDiagnostics([agentServer(), contributor("acme.zeta", {})], options);
		const enableAll = page.getByTestId("diagnostics-enable-all");
		const disableAll = page.getByTestId("diagnostics-disable-all");
		await expect.element(enableAll).toBeDisabled();

		await disableAll.click();

		await expect
			.poll(() => saveDisabled)
			.toHaveBeenLastCalledWith(["acme.server", "acme.zeta", "kilo.core"]);
		await expect.element(page.getByRole("switch", { name: "Enable acme.zeta" })).not.toBeChecked();
		await expect.element(page.getByRole("switch", { name: "Enable Shell" })).toBeChecked();
		await expect.element(disableAll).toBeDisabled();
		await expect.element(restart()).toBeEnabled();

		await enableAll.click();

		await expect.poll(() => saveDisabled).toHaveBeenLastCalledWith([]);
		await expect.element(page.getByRole("switch", { name: "Enable acme.zeta" })).toBeChecked();
		await expect.element(enableAll).toBeDisabled();
		await expect.element(restart()).toBeDisabled();
	});

	it("shows which turned-off plugins another plugin uses", async () => {
		const user = contributor("acme.user", {}, () => {}, {
			requires: { "acme.server/tool-panel": "optional" },
		});
		await openDiagnostics([agentServer(), user], pluginsHost(["acme.server"]).options);

		await page.getByRole("button", { name: "Show details for acme.user" }).click();

		const details = page.getByTestId("diagnostics-plugin-details-acme.user");
		await expect.element(details.getByText("Uses turned-off plugins")).toBeVisible();
		await expect.element(details.getByText("acme.server", { exact: true })).toBeVisible();
	});

	it("puts each plugin's switch before its name", async () => {
		await openDiagnostics([agentServer()], pluginsHost().options);
		const row = page.getByTestId("diagnostics-plugin-acme.server");
		const left = (locator: { element(): Element }) =>
			locator.element().getBoundingClientRect().left;

		const toggle = left(row.getByRole("switch"));
		const columns = row.element().querySelector(".grid")!.getBoundingClientRect().left;

		expect(toggle).toBeLessThan(columns);
	});

	it("lines the kernel's name, status and chevron up with the plugins', though it has no switch", async () => {
		await openDiagnostics([agentServer()], pluginsHost().options);
		const kernelRow = page.getByTestId("diagnostics-kernel");
		const pluginRow = page.getByTestId("diagnostics-plugin-acme.server");
		const center = (locator: { element(): Element }) => {
			const rect = locator.element().getBoundingClientRect();
			return rect.left + rect.width / 2;
		};

		// Within half a pixel: sub-pixel layout differs by display scaling.
		expect(center(kernelRow.getByText("starting").or(kernelRow.getByText("ready")))).toBeCloseTo(
			center(pluginRow.getByText("active", { exact: true })),
			0,
		);
		expect(center(kernelRow.getByTestId("diagnostics-row-chevron"))).toBeCloseTo(
			center(pluginRow.getByTestId("diagnostics-row-chevron")),
			0,
		);
		// The name, id and version columns start as far into each row.
		const columnsOffset = (row: { element(): Element }) =>
			row.element().querySelector(".grid")!.getBoundingClientRect().left -
			row.element().getBoundingClientRect().left;
		expect(columnsOffset(kernelRow)).toBe(columnsOffset(pluginRow));
	});

	it("keeps Diagnostics and the plugins it needs on", async () => {
		await openDiagnostics([agentServer()], pluginsHost().options);

		await expect
			.element(page.getByTestId("diagnostics-plugin-kilo.core").getByRole("switch"))
			.toBeEnabled();
		for (const id of ["kilo.developer", "kilo.shell"]) {
			await expect
				.element(page.getByTestId(`diagnostics-plugin-${id}`).getByRole("switch"))
				.toBeDisabled();
		}
	});
});
