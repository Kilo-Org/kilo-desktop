import {
	click,
	expectElementToBeVisible,
	expectElementToContainText,
	getLocatorByTestId,
} from "@anaconda/playwright-utils";

/** Settings → Developer → Diagnostics (kilo.developer). */
export class DiagnosticsPage {
	private readonly developerGroup = () => getLocatorByTestId("settings-group-developer");
	private readonly page = () => getLocatorByTestId("diagnostics-settings");

	/** Opens Diagnostics from the Settings navigation, under the Developer category. */
	async open(): Promise<void> {
		await expectElementToBeVisible(
			this.developerGroup(),
			"Settings should list the Developer category",
		);
		await click(getLocatorByTestId("settings-section-diagnostics"));
		await expectElementToBeVisible(this.page(), "Diagnostics should open from Settings");
	}

	async verifyKernelShown(): Promise<void> {
		await expectElementToBeVisible(
			getLocatorByTestId("diagnostics-kernel"),
			"Diagnostics should describe the kernel",
		);
	}

	async verifyPluginActive(pluginId: string): Promise<void> {
		await expectElementToContainText(
			getLocatorByTestId(`diagnostics-plugin-${pluginId}`),
			"active",
			{
				message: `${pluginId} should be listed as active`,
			},
		);
	}

	async openServices(): Promise<void> {
		await click(getLocatorByTestId("diagnostics-tab-services"));
		await expectElementToBeVisible(
			getLocatorByTestId("diagnostics-services"),
			"The Services tab should list the app's services",
		);
	}

	/** Requires the Services tab (`openServices`). `serviceKey` is `<plugin id>/<service id>`. */
	async verifyServiceListed(serviceKey: string): Promise<void> {
		await expectElementToBeVisible(
			getLocatorByTestId(`diagnostics-service-${serviceKey}`),
			`The Services tab should list ${serviceKey}`,
		);
	}
}
