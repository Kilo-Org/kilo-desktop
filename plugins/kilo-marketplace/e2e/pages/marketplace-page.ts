import {
	click,
	expectElementToBeHidden,
	expectElementToBeVisible,
	getLocatorByTestId,
} from "@anaconda/playwright-utils";

// Every catalog read waits on the Kilo server's agent, skill and MCP inventory, which can
// outlast the default expect budget on a cold packaged start — and again after install or
// remove, which rewrite global Kilo config and keep their dialog busy until the list refetches.
const KILO_INVENTORY_TIMEOUT_MS = 60_000;

export class MarketplacePage {
	private readonly section = () => getLocatorByTestId("marketplace-page");
	private readonly nav = () => getLocatorByTestId("settings-section-kilo-marketplace");
	private readonly add = () => getLocatorByTestId("marketplace-add");
	private readonly catalog = () => getLocatorByTestId("marketplace-catalog-dialog");
	private readonly closeCatalog = () => this.catalog().getByRole("button", { name: "Close" });
	private readonly mcps = () => getLocatorByTestId("marketplace-type-mcp");
	private readonly item = () => getLocatorByTestId("marketplace-item-mcp-local-tools");
	private readonly install = () => getLocatorByTestId("marketplace-install-mcp-local-tools");
	private readonly installDialog = () => getLocatorByTestId("marketplace-install-dialog");
	private readonly installConfirm = () => getLocatorByTestId("marketplace-install-confirm");
	private readonly remove = () => getLocatorByTestId("marketplace-remove-mcp-local-tools-global");
	private readonly removeDialog = () => getLocatorByTestId("marketplace-remove-dialog");
	private readonly removeConfirm = () => getLocatorByTestId("marketplace-remove-confirm");

	async openFromSettings(): Promise<void> {
		await click(this.nav());
		await expectElementToBeVisible(this.section(), "Agent Behavior settings should be visible");
		await click(this.add());
		await expectElementToBeVisible(this.catalog(), "Kilo Marketplace should be visible");
		await click(this.mcps());
		await expectElementToBeVisible(this.item(), {
			message: "Fake Marketplace MCP should be visible",
			timeout: KILO_INVENTORY_TIMEOUT_MS,
		});
	}

	async installGlobalMcp(): Promise<void> {
		await click(this.install());
		await click(this.installConfirm());
		await expectElementToBeHidden(this.installDialog(), {
			message: "Install dialog should close once the install lands",
			timeout: KILO_INVENTORY_TIMEOUT_MS,
		});
		await expectElementToBeVisible(this.remove(), "Installed global MCP should offer removal");
	}

	async removeGlobalMcp(): Promise<void> {
		await click(this.remove());
		await click(this.removeConfirm());
		await expectElementToBeHidden(this.removeDialog(), {
			message: "Remove dialog should close once the removal lands",
			timeout: KILO_INVENTORY_TIMEOUT_MS,
		});
		await click(this.add());
		await expectElementToBeVisible(this.install(), "Removed global MCP should offer installation");
		await click(this.closeCatalog());
		await expectElementToBeHidden(this.catalog(), "Kilo Marketplace should close");
	}
}
