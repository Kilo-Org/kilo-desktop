import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import { accounts, agentServer, flagSource, openDiagnostics } from "../test/diagnostics";

const inspector = () => page.getByTestId("diagnostics-inspector");
const crumbs = () =>
	page
		.getByTestId("diagnostics-breadcrumbs")
		.getByRole("listitem")
		.elements()
		.map((item) => item.textContent);

async function openTab(tab: "object-types" | "context-keys" | "flags" | "identity") {
	await page.getByTestId(`diagnostics-tab-${tab}`).click();
}

describe("diagnostics — flags", () => {
	it("lists every declared flag with its value and origin", async () => {
		await openDiagnostics();
		await openTab("flags");

		const developer = page.getByTestId("diagnostics-flag-row-developer");
		await expect.element(developer.getByTestId("diagnostics-flag-value")).toHaveTextContent("true");
		await expect.element(developer.getByTestId("diagnostics-status")).toHaveTextContent("override");
		await expect.element(developer.getByText("kilo.developer")).toBeVisible();

		const beta = page.getByTestId("diagnostics-flag-row-agent-beta");
		await expect.element(beta.getByTestId("diagnostics-flag-value")).toHaveTextContent("false");
		await expect.element(beta.getByTestId("diagnostics-status")).toHaveTextContent("default");
	});

	it("shows a value the flag source set, and follows it as it changes", async () => {
		const source = flagSource({ "agent-beta": true });
		await openDiagnostics([agentServer(), source.plugin]);
		await openTab("flags");
		const beta = page.getByTestId("diagnostics-flag-row-agent-beta");
		await expect.element(beta.getByTestId("diagnostics-status")).toHaveTextContent("source");
		await expect.element(beta.getByTestId("diagnostics-flag-value")).toHaveTextContent("true");

		source.set({ "agent-beta": "variant-b" });

		await expect
			.element(beta.getByTestId("diagnostics-flag-value"))
			.toHaveTextContent('"variant-b"');
	});

	it("filters flags by id, plugin or description", async () => {
		await openDiagnostics();
		await openTab("flags");

		await page.getByTestId("diagnostics-filter-flags").fill("beta features");

		expect(
			page
				.getByTestId(/^diagnostics-flag-row-/)
				.elements()
				.map((row) => row.dataset["qaId"]),
		).toEqual(["diagnostics-flag-row-agent-beta"]);
	});

	it("opens a flag: its value, default, origin, who declared it and what it gates", async () => {
		await openDiagnostics();
		await openTab("flags");

		await page.getByTestId("diagnostics-flag-row-developer").click();

		const detail = page.getByTestId("diagnostics-flag-developer");
		await expect
			.element(detail.getByText("Developer tools: Settings → Developer → Diagnostics."))
			.toBeVisible();
		await expect.element(detail.getByText(/^The host's overrides/)).toBeVisible();
		await expect
			.element(detail.getByTestId("diagnostics-link-kilo.developer").first())
			.toBeVisible();
		const details = detail.getByTestId("diagnostics-flag-details");
		await expect.element(details.getByText("kernel/flag:developer")).toBeVisible();
		await expect.element(details.getByText("on", { exact: true })).toBeVisible();
		// kilo.developer runs only while its flag is on.
		await expect
			.element(page.getByTestId("diagnostics-key-uses").getByText(/runs only while it holds/))
			.toBeVisible();
		expect(crumbs()).toEqual(["Diagnostics", "developer"]);
	});

	it("says when nothing is gated on a flag", async () => {
		await openDiagnostics();
		await openTab("flags");

		await page.getByTestId("diagnostics-flag-row-agent-beta").click();

		await expect.element(page.getByText("Nothing runs only while it is on or off.")).toBeVisible();
		await expect.element(page.getByText(/^The declared default/)).toBeVisible();
	});

	it("drills from a plugin's flags into one", async () => {
		await openDiagnostics();
		await page.getByRole("button", { name: "Show details for acme.server" }).click();

		await page
			.getByTestId("diagnostics-plugin-details-acme.server")
			.getByTestId("diagnostics-link-agent-beta")
			.click();

		await expect.element(page.getByTestId("diagnostics-flag-agent-beta")).toBeVisible();
		expect(crumbs()).toEqual(["Diagnostics", "acme.server", "agent-beta"]);
	});
});

describe("diagnostics — context keys", () => {
	it("lists declared context keys with their value in this window", async () => {
		await openDiagnostics();
		await openTab("context-keys");

		await expect
			.element(
				page
					.getByTestId("diagnostics-context-key-row-kernel/safeMode")
					.getByTestId("diagnostics-status"),
			)
			.toHaveTextContent("off");
		await expect
			.element(page.getByTestId("diagnostics-context-key-row-acme.server/busy"))
			.toBeVisible();
		await expect
			.element(page.getByTestId("diagnostics-context-key-row-kernel/flag:*").getByText(/keys? set/))
			.toBeVisible();
	});

	it("opens a key family to list the keys set in this window", async () => {
		await openDiagnostics();
		await openTab("context-keys");

		await page.getByTestId("diagnostics-context-key-row-kernel/flag:*").click();

		const detail = page.getByTestId("diagnostics-context-key-kernel/flag:*");
		await expect.element(detail.getByText(/named feature flag/)).toBeVisible();
		await expect.element(detail.getByText(/^Global/)).toBeVisible();
		await expect
			.element(
				page.getByTestId("diagnostics-context-key-details").getByText("kernel/flag:developer"),
			)
			.toBeVisible();
	});

	it("opens a key: description, owner, value and the conditions that read it", async () => {
		await openDiagnostics();
		await openTab("context-keys");

		await page.getByTestId("diagnostics-context-key-row-kernel/safeMode").click();

		const detail = page.getByTestId("diagnostics-context-key-kernel/safeMode");
		await expect.element(detail.getByText(/started in safe mode/)).toBeVisible();
		await expect.element(detail.getByTestId("diagnostics-status")).toHaveTextContent("off");
		const uses = page.getByTestId("diagnostics-key-uses");
		await expect.element(uses.getByText("acme.server/safe")).toBeVisible();
		await expect.element(uses.getByText(/needs kernel\/safeMode on/)).toBeVisible();
	});

	it("drills from a plugin's context keys into one nothing reads", async () => {
		await openDiagnostics();
		await page.getByRole("button", { name: "Show details for acme.server" }).click();

		await page
			.getByTestId("diagnostics-plugin-details-acme.server")
			.getByTestId("diagnostics-link-acme.server/busy")
			.click();

		const detail = page.getByTestId("diagnostics-context-key-acme.server/busy");
		await expect.element(detail.getByText("True while the agent works.")).toBeVisible();
		await expect
			.element(detail.getByText("No plugin or manifest contribution reads it."))
			.toBeVisible();
	});

	it("shows the condition a plugin runs behind and its current value", async () => {
		await openDiagnostics();

		await page.getByRole("button", { name: "Show details for kilo.developer" }).click();

		const details = page.getByTestId("diagnostics-plugin-details-kilo.developer");
		await expect
			.element(details.getByText("kernel/flag:developer must be on — now on"))
			.toBeVisible();
		await expect.element(details.getByTestId("diagnostics-link-force-onboarding")).toBeVisible();
	});
});

describe("diagnostics — object types", () => {
	it("lists object types with the collection that resolves each", async () => {
		await openDiagnostics();
		await openTab("object-types");

		const job = page.getByTestId("diagnostics-object-type-row-acme.server/job");
		await expect.element(job.getByText("acme.server/jobs")).toBeVisible();
		await expect.element(job.getByTestId("diagnostics-status")).toHaveTextContent("unresolved");
		await expect
			.element(
				page.getByTestId("diagnostics-object-type-row-kernel/window").getByText("kernel/windows"),
			)
			.toBeVisible();
	});

	it("opens an object type and follows it to its collection and back", async () => {
		await openDiagnostics();
		await openTab("object-types");

		await page.getByTestId("diagnostics-object-type-row-acme.server/job").click();

		const detail = page.getByTestId("diagnostics-object-type-acme.server/job");
		await expect.element(detail.getByText("One agent job.")).toBeVisible();
		await expect.element(detail.getByText('{ type: "acme.server/job", id: string }')).toBeVisible();
		await detail.getByTestId("diagnostics-link-acme.server/jobs").click();

		const collection = page.getByTestId("diagnostics-domain-acme.server/jobs");
		await expect.element(collection.getByText("Looks items up by key in its state")).toBeVisible();
		await collection.getByTestId("diagnostics-link-acme.server/job").click();

		expect(crumbs()).toEqual(["Diagnostics", "acme.server/job"]);
	});

	it("lists the object types the kernel and a plugin own", async () => {
		await openDiagnostics();
		await page.getByRole("button", { name: "Show details for kernel" }).click();
		await expect
			.element(
				page
					.getByTestId("diagnostics-kernel-details")
					.getByTestId("diagnostics-link-kernel/window"),
			)
			.toBeVisible();

		await page.getByRole("button", { name: "Show details for acme.server" }).click();
		await page
			.getByTestId("diagnostics-plugin-details-acme.server")
			.getByTestId("diagnostics-link-acme.server/job")
			.click();

		await expect.element(inspector()).toBeVisible();
		await expect.element(page.getByTestId("diagnostics-object-type-acme.server/job")).toBeVisible();
	});

	it("filters object types", async () => {
		await openDiagnostics();
		await openTab("object-types");

		await page.getByTestId("diagnostics-filter-object-types").fill("nothing like this");

		await expect.element(page.getByTestId("diagnostics-no-object-types")).toBeVisible();
	});
});

describe("diagnostics — identity", () => {
	it("says no one is signed in without an identity provider", async () => {
		await openDiagnostics();
		await openTab("identity");

		await expect.element(page.getByTestId("diagnostics-identity-signed-out")).toBeVisible();
	});

	it("shows the primary and linked accounts: source, ids and email", async () => {
		await openDiagnostics([
			agentServer(),
			accounts(
				{
					id: "user-1",
					email: "dev@example.com",
					organization: { id: "org-9", name: "Acme" },
					attributes: { plan: "pro" },
				},
				{ id: "linked-7", name: "Anaconda user" },
			),
		]);
		await openTab("identity");

		const primary = page.getByTestId("diagnostics-identity-primary");
		await expect.element(primary.getByText("dev@example.com").first()).toBeVisible();
		await expect.element(primary.getByText("acme.accounts/primary")).toBeVisible();
		await expect.element(primary.getByText("user-1")).toBeVisible();
		await expect.element(primary.getByText("org-9")).toBeVisible();
		await expect.element(primary.getByText(/"plan": "pro"/)).toBeVisible();

		const linked = page.getByTestId("diagnostics-identity-linked-acme.accounts/linked");
		await expect.element(linked.getByText("linked-7")).toBeVisible();
		await expect.element(linked.getByText("Anaconda user").first()).toBeVisible();

		await primary.getByTestId("diagnostics-link-acme.accounts").click();
		await expect.element(page.getByTestId("diagnostics-owner-acme.accounts")).toBeVisible();
	});
});
