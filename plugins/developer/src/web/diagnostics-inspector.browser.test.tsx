import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import { KernelService } from "@kilo-desktop/kernel";
import { SettingsSection } from "@kilo-desktop/plugin-shell/contracts";

import { agentServer, contributor, openDiagnostics, pluginsHost } from "../test/diagnostics";

const inspector = () => page.getByTestId("diagnostics-inspector");
const crumbs = () =>
	page
		.getByTestId("diagnostics-breadcrumbs")
		.getByRole("listitem")
		.elements()
		.map((item) => item.textContent);

async function expandPlugin(id: string) {
	await page.getByRole("button", { name: `Show details for ${id}` }).click();
	return page.getByTestId(`diagnostics-plugin-details-${id}`);
}

async function openFromPlugin(pluginId: string, id: string) {
	const details = await expandPlugin(pluginId);
	await details.getByTestId(`diagnostics-link-${id}`).first().click();
	await expect.element(inspector()).toBeVisible();
}

async function openTab(tab: "points" | "domains") {
	await page.getByTestId(`diagnostics-tab-${tab}`).click();
	await expect.element(page.getByTestId(`diagnostics-${tab}`)).toBeVisible();
}

describe("diagnostics inspector — navigating", () => {
	it("drills from an expanded plugin into a point it contributes to, under that plugin", async () => {
		await openDiagnostics();

		await openFromPlugin("acme.server", "kilo.shell/settings-section");

		await expect
			.element(page.getByTestId("diagnostics-point-kilo.shell/settings-section"))
			.toBeVisible();
		expect(crumbs()).toEqual(["Diagnostics", "acme.server", "kilo.shell/settings-section"]);
		await expect.element(page.getByTestId("diagnostics-plugins")).not.toBeVisible();
	});

	it("follows links from one detail to the next and goes back along the breadcrumbs", async () => {
		await openDiagnostics();
		await openFromPlugin("acme.server", "kilo.shell/settings-section");

		await inspector().getByTestId("diagnostics-link-kilo.shell").first().click();

		const owner = page.getByTestId("diagnostics-owner-kilo.shell");
		await expect.element(owner).toBeVisible();
		await expect.element(owner.getByText(/The window frame|settings host/)).toBeVisible();
		expect(crumbs()).toEqual([
			"Diagnostics",
			"acme.server",
			"kilo.shell/settings-section",
			"kilo.shell",
		]);

		await page
			.getByTestId("diagnostics-breadcrumbs")
			.getByRole("button", { name: "acme.server" })
			.click();
		await expect.element(page.getByTestId("diagnostics-owner-acme.server")).toBeVisible();
		expect(crumbs()).toEqual(["Diagnostics", "acme.server"]);

		await page.getByTestId("diagnostics-back").click();
		await expect.element(inspector()).not.toBeInTheDocument();
		// The page is as it was left: the plugin still expanded.
		await expect.element(page.getByTestId("diagnostics-plugin-details-acme.server")).toBeVisible();
	});

	it("goes back to an earlier crumb instead of repeating it", async () => {
		await openDiagnostics();
		await openFromPlugin("acme.server", "kilo.shell/settings-section");

		await inspector().getByTestId("diagnostics-link-acme.server").first().click();

		expect(crumbs()).toEqual(["Diagnostics", "acme.server"]);
	});

	it("drills into the domain objects and points the kernel owns", async () => {
		await openDiagnostics();
		await page.getByRole("button", { name: "Show details for kernel" }).click();

		await page
			.getByTestId("diagnostics-kernel-details")
			.getByTestId("diagnostics-link-kernel/plugins")
			.click();

		await expect.element(page.getByTestId("diagnostics-domain-kernel/plugins")).toBeVisible();
		expect(crumbs()).toEqual(["Diagnostics", "kernel", "kernel/plugins"]);
	});

	it("links a plugin's requirements to the points and domain objects they name", async () => {
		await openDiagnostics();

		await openFromPlugin("acme.server", "kilo.shell/navigation");

		await expect
			.element(page.getByTestId("diagnostics-domain-kilo.shell/navigation"))
			.toBeVisible();
	});
});

describe("diagnostics inspector — extension points", () => {
	it("describes a point: kind, owner, implementation and the metadata contributions carry", async () => {
		await openDiagnostics();
		await openFromPlugin("acme.server", "kilo.shell/settings-section");

		const detail = page.getByTestId("diagnostics-point-kilo.shell/settings-section");
		await expect.element(detail.getByText("A section of the Settings page.")).toBeVisible();
		await expect.element(detail.getByText(/^Additive/)).toBeVisible();
		await expect.element(detail.getByTestId("diagnostics-link-kilo.shell")).toBeVisible();
		await expect.element(detail.getByText(/renderer process/)).toBeVisible();
		await expect.element(detail.getByText(/title: string;/)).toBeVisible();
		await expect.element(detail.getByText(/category\?: string; \/\/ default/)).toBeVisible();
	});

	it("lists every contribution with whether it is live, and why not", async () => {
		await openDiagnostics([
			agentServer(),
			contributor(
				"acme.extra",
				{ "kilo.shell/settings-section": [{ id: "extra", title: "Extra" }] },
				(sdk) => sdk.extensions.implement(SettingsSection, "extra", { component: () => null }),
			),
		]);
		await openFromPlugin("acme.server", "kilo.shell/settings-section");

		const status = (key: string) =>
			page.getByTestId(`diagnostics-contribution-row-${key}`).getByTestId("diagnostics-status");
		await expect.element(status("acme.extra/extra")).toHaveTextContent("active");
		await expect.element(status("kilo.developer/diagnostics")).toHaveTextContent("active");
		await expect.element(status("acme.server/models")).toHaveTextContent("unimplemented");
		await expect.element(status("acme.server/safe")).toHaveTextContent("inactive");
	});

	it("marks an exclusive point's winner", async () => {
		await openDiagnostics();
		await openTab("points");

		await page.getByTestId("diagnostics-point-row-kernel/root").click();

		await expect
			.element(
				page
					.getByTestId("diagnostics-contribution-row-kilo.shell/frame")
					.getByTestId("diagnostics-status"),
			)
			.toHaveTextContent("winner");
	});

	it("shows a turned-off plugin's contributions with its state", async () => {
		await openDiagnostics([agentServer()], pluginsHost(["acme.server"]).options);
		await openTab("points");

		await page.getByTestId("diagnostics-point-row-kilo.shell/settings-section").click();

		await expect
			.element(
				page
					.getByTestId("diagnostics-contribution-row-acme.server/models")
					.getByTestId("diagnostics-status"),
			)
			.toHaveTextContent("disabled");
	});

	it("expands a contribution to show its priority, condition and metadata", async () => {
		await openDiagnostics();
		await openFromPlugin("acme.server", "kilo.shell/settings-section");

		await page.getByRole("button", { name: "Show details for acme.server/safe" }).click();

		const details = page.getByTestId("diagnostics-contribution-details-acme.server/safe");
		await expect.element(details.getByText("5", { exact: true })).toBeVisible();
		await expect.element(details.getByText(/kernel\/safeMode/)).toBeVisible();
		await expect.element(details.getByText(/"title": "Safe mode"/)).toBeVisible();
		await expect.element(details.getByTestId("diagnostics-link-acme.server")).toBeVisible();
	});

	it("lists the plugins that require the point", async () => {
		await openDiagnostics();
		await openFromPlugin("acme.server", "kilo.shell/settings-section");

		const requiredBy = page.getByTestId("diagnostics-required-by");
		await expect.element(requiredBy.getByTestId("diagnostics-link-acme.server")).toBeVisible();
		await expect.element(requiredBy.getByTestId("diagnostics-link-kilo.developer")).toBeVisible();
		await expect.element(requiredBy.getByText("optional")).toBeVisible();
	});
});

describe("diagnostics inspector — kinds of point", () => {
	it("describes a decision point: how it fails and what it is asked", async () => {
		await openDiagnostics();
		await openTab("points");

		await page.getByTestId("diagnostics-point-row-kernel/quit").click();

		const detail = page.getByTestId("diagnostics-point-kernel/quit");
		await expect.element(detail.getByText(/^Decision — /)).toBeVisible();
		await expect.element(detail.getByText("Fails open after 2000 ms; asked with:")).toBeVisible();
		await expect.element(detail.getByText("None beyond id, priority and when")).toBeVisible();
	});

	it("describes a point nothing contributes to or requires, whose contributions are metadata only", async () => {
		await openDiagnostics();
		await openFromPlugin("acme.server", "acme.server/tool-panel");

		const detail = page.getByTestId("diagnostics-point-acme.server/tool-panel");
		await expect.element(detail.getByText("None: contributions are metadata only")).toBeVisible();
		await expect.element(detail.getByText("Nothing contributes to it.")).toBeVisible();
		await expect.element(detail.getByText("No plugin requires it.")).toBeVisible();
	});

	it("tells where a contribution is implemented", async () => {
		const { main } = await openDiagnostics();
		main.sdkFor("acme.server").extensions.implement(KernelService, "daemon", { start: () => {} });
		await openFromPlugin("acme.server", "kernel/service");

		await page.getByRole("button", { name: "Show details for acme.server/daemon" }).click();
		await expect
			.element(
				page
					.getByTestId("diagnostics-contribution-details-acme.server/daemon")
					.getByText("the main process"),
			)
			.toBeVisible();
		await expect.element(page.getByText(/^Bound in the main process/)).toBeVisible();
	});

	it("opens the kernel as the owner of its points", async () => {
		await openDiagnostics();
		await openTab("points");
		await page.getByTestId("diagnostics-point-row-kernel/command").click();
		await expect.element(page.getByText(/^Bound in any process/)).toBeVisible();

		await inspector().getByTestId("diagnostics-link-kernel").first().click();

		const owner = page.getByTestId("diagnostics-owner-kernel");
		await expect.element(owner.getByText(/plugin runtime/)).toBeVisible();
		await expect.element(owner.getByTestId("diagnostics-link-kernel/root")).toBeVisible();
	});
});

describe("diagnostics inspector — domain objects", () => {
	it("describes a domain object: home, permission, state, methods and events", async () => {
		await openDiagnostics();
		await openTab("domains");

		await page.getByTestId("diagnostics-domain-row-kernel/plugins").click();

		const detail = page.getByTestId("diagnostics-domain-kernel/plugins");
		await expect.element(detail.getByText(/^Main process/)).toBeVisible();
		await expect.element(detail.getByText("plugins", { exact: true })).toBeVisible();
		await expect.element(detail.getByTestId("diagnostics-status")).toHaveTextContent("provided");
		await expect.element(detail.getByText(/disabled: string\[\];/)).toBeVisible();
		await expect
			.element(detail.getByText("setEnabled(input: { pluginId: string; enabled: boolean }): void"))
			.toBeVisible();
		await expect.element(detail.getByText(/^"state-changed": /)).toBeVisible();
	});

	it("shows a plugin's domain object that nothing provides yet", async () => {
		await openDiagnostics();
		await openFromPlugin("acme.server", "acme.server/status");

		const detail = page.getByTestId("diagnostics-domain-acme.server/status");
		await expect.element(detail.getByText("Whether the agent server is up.")).toBeVisible();
		await expect.element(detail.getByText(/^Renderer/)).toBeVisible();
		await expect
			.element(detail.getByTestId("diagnostics-status"))
			.toHaveTextContent("not provided");
		await expect.element(detail.getByText("{ up: boolean }")).toBeVisible();
	});
});

describe("diagnostics inspector — catalogs", () => {
	it("lists every extension point, the kernel's and plugins', alphabetically", async () => {
		await openDiagnostics();
		await openTab("points");

		const ids = page
			.getByTestId(/^diagnostics-point-row-/)
			.elements()
			.map((row) => row.dataset["qaId"]!.replace("diagnostics-point-row-", ""));
		expect(ids).toContain("kernel/root");
		expect(ids).toContain("acme.server/tool-panel");
		expect(ids).toContain("kilo.shell/settings-section");
		expect(ids).toEqual([...ids].sort());
	});

	it("filters points by id, owner or description", async () => {
		await openDiagnostics();
		await openTab("points");

		await page.getByTestId("diagnostics-filter-points").fill("agent tools");

		expect(
			page
				.getByTestId(/^diagnostics-point-row-/)
				.elements()
				.map((row) => row.dataset["qaId"]),
		).toEqual(["diagnostics-point-row-acme.server/tool-panel"]);
	});

	it("lists domain objects and opens one", async () => {
		await openDiagnostics();
		await openTab("domains");

		await page.getByTestId("diagnostics-filter-domains").fill("acme");
		await page.getByTestId("diagnostics-domain-row-acme.server/status").click();

		await expect.element(page.getByTestId("diagnostics-domain-acme.server/status")).toBeVisible();
		expect(crumbs()).toEqual(["Diagnostics", "acme.server/status"]);
	});
});
