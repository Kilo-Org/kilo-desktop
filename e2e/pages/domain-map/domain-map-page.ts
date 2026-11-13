import {
	click,
	expectElementToBeVisible,
	expectElementToContainText,
	getLocatorByTestId,
} from "@anaconda/playwright-utils";

/** The Domain Map in the shell's right sidebar (kilo.domain-map). */
export class DomainMapPage {
	private readonly panel = () => getLocatorByTestId("domain-map-panel");

	/** Opens the Domain Map from its icon in the right sidebar's rail. */
	async open(): Promise<void> {
		await click(getLocatorByTestId("right-sidebar-panel-kilo.domain-map/domain-map"));
		await expectElementToBeVisible(this.panel(), "The Domain Map should show in the right sidebar");
	}

	/** The packaged app has WebGL 2, so the map draws rather than falling back. */
	async verifyMapDrawn(): Promise<void> {
		await expectElementToBeVisible(
			getLocatorByTestId("domain-map-canvas"),
			"The Domain Map should draw its 3D view",
		);
		await expectElementToContainText(getLocatorByTestId("domain-map-counts"), "domain objects", {
			message: "The Domain Map should count the domain objects",
		});
	}
}
