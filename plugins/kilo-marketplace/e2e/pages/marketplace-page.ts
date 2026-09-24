import {
	click,
	expectElementToBeHidden,
	expectElementToBeVisible,
	getLocatorByTestId,
} from "@anaconda/playwright-utils";

// The first list on a fresh profile waits for the Kilo server's agent, skill and MCP
// inventory, which can outlast the default expect budget on a cold packaged start.
const CATALOG_LOAD_TIMEOUT_MS = 60_000;

export class MarketplacePage {
	private readonly section = () => getLocatorByTestId("marketplace-page");
	private readonly nav = () => getLocatorByTestId("settings-section-kilo-marketplace");
	private readonly add = () => getLocatorByTestId("marketplace-add");
	private readonly catalog = () => getLocatorByTestId("marketplace-catalog-dialog");
	private readonly closeCatalog = () => this.catalog().getByRole("button", { name: "Close" });
	private readonly mcps = () => getLocatorByTestId("marketplace-type-mcp");
	private readonly item = () => getLocatorByTestId("marketplace-item-mcp-local-tools");
	private readonly install = () => getLocatorByTestId("marketplace-install-mcp-local-tools");
	private readonly installConfirm = () => getLocatorByTestId("marketplace-install-confirm");
	private readonly remove = () => getLocatorByTestId("marketplace-remove-mcp-local-tools-global");
	private readonly removeConfirm = () => getLocatorByTestId("marketplace-remove-confirm");

	async openFromSettings(): Promise<void> {
		await click(this.nav());
		await expectElementToBeVisible(this.section(), "Agent Behavior settings should be visible");
		await click(this.add());
		await expectElementToBeVisible(this.catalog(), "Kilo Marketplace should be visible");
		await click(this.mcps());
		await expectElementToBeVisible(this.item(), {
			message: "Fake Marketplace MCP should be visible",
			timeout: CATALOG_LOAD_TIMEOUT_MS,
		});
	}

	async installGlobalMcp(): Promise<void> {
		await click(this.install());
		await click(this.installConfirm());
		await expectElementToBeVisible(this.remove(), "Installed global MCP should offer removal");
	}

	async removeGlobalMcp(): Promise<void> {
		await click(this.remove());
		await click(this.removeConfirm());
		await click(this.add());
		await expectElementToBeVisible(this.install(), "Removed global MCP should offer installation");
		await click(this.closeCatalog());
		await expectElementToBeHidden(this.catalog(), "Kilo Marketplace should close");
	}
}
