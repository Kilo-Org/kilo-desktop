import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import { AccountPanel } from "../../contracts";
import { contributor, renderShell } from "../../testing";

function accounts() {
	return contributor(
		"acme.accounts",
		{
			"kilo.shell/account-panel": [
				{ id: "second", priority: 10 },
				{ id: "first", priority: 90 },
				{ id: "empty", priority: 50 },
			],
		},
		(sdk) => {
			sdk.extensions.implement(AccountPanel, "first", () => <p>First account</p>);
			sdk.extensions.implement(AccountPanel, "second", () => <p>Second account</p>);
			sdk.extensions.implement(AccountPanel, "empty", () => null);
		},
	);
}

async function openAccount(plugins: Parameters<typeof renderShell>[0] = []) {
	await renderShell(plugins);
	window.location.hash = "#/settings/account";
}

describe("Account settings", () => {
	it("sits under General and frames each account panel in priority order", async () => {
		await openAccount([accounts()]);

		await expect.element(page.getByTestId("settings-section-heading")).toHaveTextContent("Account");
		const general = page.getByTestId("settings-group-general").element().parentElement!;
		expect(general.contains(page.getByTestId("settings-section-account").element())).toBe(true);

		await expect.element(page.getByText("First account")).toBeVisible();
		const keys = [...page.getByTestId("account-rows").element().children].map((panel) =>
			panel.getAttribute("data-qa-id"),
		);
		expect(keys).toEqual([
			"account-panel-kilo.shell/kilo",
			"account-panel-acme.accounts/first",
			"account-panel-acme.accounts/empty",
			"account-panel-acme.accounts/second",
		]);
	});

	it("draws no frame for a panel that renders nothing", async () => {
		await openAccount([accounts()]);

		const frame = page.getByTestId("account-panel-acme.accounts/empty");
		await expect.element(frame).toBeInTheDocument();
		await expect.element(frame).not.toBeVisible();
	});
});
