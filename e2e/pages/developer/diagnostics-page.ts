import {
	click,
	expectElementToBeVisible,
	expectElementToContainText,
	getLocatorByTestId,
} from "@anaconda/playwright-utils";

/** Settings → Developer → Diagnostics (kilo.developer). Open Settings first. */
export class DiagnosticsPage {
	private readonly developerGroup = () => getLocatorByTestId("settings-group-developer");
	private readonly page = () => getLocatorByTestId("diagnostics-settings");
	private readonly identityPrimary = () => getLocatorByTestId("diagnostics-identity-primary");

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

	async openFlags(): Promise<void> {
		await click(getLocatorByTestId("diagnostics-tab-flags"));
		await expectElementToBeVisible(
			getLocatorByTestId("diagnostics-flags"),
			"The Flags tab should list the declared flags",
		);
	}

	/** Requires the Flags tab (`openFlags`). `origin` is `default`, `source` or `override`. */
	async verifyFlagOrigin(flagId: string, origin: "default" | "source" | "override"): Promise<void> {
		await expectElementToContainText(
			getLocatorByTestId(`diagnostics-flag-row-${flagId}`).getByTestId("diagnostics-status"),
			origin,
			{ message: `Flag ${flagId} should take its value from its ${origin}` },
		);
	}

	async openIdentity(): Promise<void> {
		await click(getLocatorByTestId("diagnostics-tab-identity"));
		await expectElementToBeVisible(
			getLocatorByTestId("diagnostics-identity"),
			"The Identity tab should show kernel/identity",
		);
	}

	/** Requires the Identity tab (`openIdentity`): the primary account's source and email. */
	async verifyPrimaryIdentity(
		expected: { readonly source: string; readonly email: string },
		timeoutMs?: number,
	): Promise<void> {
		for (const text of [expected.source, expected.email]) {
			await expectElementToContainText(this.identityPrimary(), text, {
				message: `kernel/identity's primary account should show ${text}`,
				...(timeoutMs === undefined ? {} : { timeout: timeoutMs }),
			});
		}
	}
}
