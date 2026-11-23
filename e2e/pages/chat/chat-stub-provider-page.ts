import { expect } from "@playwright/test";
import { click, fill, getLocatorByTestId, isElementVisible } from "@anaconda/playwright-utils";
import { getPage } from "@anaconda/playwright-utils/page-utils";
import { getRequest } from "@anaconda/playwright-utils/api-utils";

import { AiProvidersPage } from "../shell/ai-providers-page.js";
import {
	CHAT_COMPLETIONS_STUB_INTROSPECTION_PATH,
	CHAT_COMPLETIONS_STUB_URL_ENV,
	type CapturedCompletionError,
	type CapturedCompletionRequest,
} from "../../utils/chat-completions-stub.js";

const CUSTOM_PROVIDER_NAME = "E2E Chat Completions Stub";
/** `generateProviderID()` (plugins/shell/src/web/ai-providers/custom-provider.ts) slugifies the name verbatim — kept in sync with `CUSTOM_PROVIDER_NAME` by inspection, since the two live in different packages. */
export const CUSTOM_PROVIDER_ID = "e2e-chat-completions-stub";
const CUSTOM_MODEL_ID = "e2e-stub-model";
export const CUSTOM_MODEL_OPTION_ID = `${CUSTOM_PROVIDER_ID}/${CUSTOM_MODEL_ID}`;
const REQUEST_POLL_TIMEOUT_MS = 20_000;
const REQUEST_POLL_INTERVAL_MS = 250;

/**
 * Configures a Custom AI Provider (`@ai-sdk/openai-compatible`) pointed at
 * the local chat-completions stub (`utils/chat-completions-stub.ts`) with
 * one image-capable model — the setup every chat spec that sends a message
 * needs (then picking that model in the composer) to get a deterministic
 * reply instead of depending on a real model call.
 */
export class ChatStubProviderPage {
	private readonly aiProviders = new AiProvidersPage();
	private readonly existingProviderRow = () =>
		getLocatorByTestId(`kilo-providers-row-${CUSTOM_PROVIDER_ID}`);
	private readonly addProviderButton = () => getLocatorByTestId("kilo-providers-add-provider");
	private readonly addCustomOption = () => getLocatorByTestId("kilo-providers-add-custom");
	private readonly nameInput = () => getLocatorByTestId("kilo-providers-custom-name");
	private readonly urlInput = () => getLocatorByTestId("kilo-providers-custom-url");
	private readonly modelIdInput = () => getLocatorByTestId("kilo-providers-model-id-input");
	private readonly modelImagesCheckbox = () =>
		getLocatorByTestId("kilo-providers-model-images-input");
	private readonly addModelButton = () => getLocatorByTestId("kilo-providers-add-model");
	private readonly saveButton = () => getLocatorByTestId("kilo-providers-custom-save");

	private stubUrl(): string {
		const url = process.env[CHAT_COMPLETIONS_STUB_URL_ENV];
		if (!url) throw new Error("Chat completions stub URL is unavailable in the e2e environment");
		return url;
	}

	/**
	 * Opens AI Providers from Settings and adds the stub as a custom provider
	 * with one image-capable model, unless a provider with `CUSTOM_PROVIDER_ID`
	 * already exists — skips re-adding in that case. The guard matters because
	 * every test in a worker's isolation group shares one app/profile
	 * (`sharedApp` in `fixtures/electron.ts` is worker-scoped and only clears
	 * `localStorage` between tests, never the Kilo CLI's own provider config),
	 * so an unconditional add would create a second provider under a
	 * different slugified id (`generateProviderID` suffixes on a name
	 * collision) on the second call in the same worker, leaving
	 * `CUSTOM_PROVIDER_ID`/`CUSTOM_MODEL_OPTION_ID` pointing at the wrong one.
	 * The catalog must settle before the existence check, or a still-loading
	 * page reads an already-saved provider's row as absent and re-adds it.
	 */
	async configureStubProvider(): Promise<void> {
		await this.aiProviders.openFromSettings();
		await this.aiProviders.verifyCatalogLoaded();
		if (await isElementVisible(this.existingProviderRow())) return;
		await click(this.addProviderButton());
		await click(this.addCustomOption());
		await fill(this.nameInput(), CUSTOM_PROVIDER_NAME);
		await fill(this.urlInput(), this.stubUrl());
		await fill(this.modelIdInput(), CUSTOM_MODEL_ID);
		await click(this.modelImagesCheckbox());
		await click(this.addModelButton());
		await click(this.saveButton());
	}

	/**
	 * Polls the stub's introspection endpoint (a separate process from this
	 * worker — see `chat-completions-stub.ts`) for the most recent request
	 * whose typed message text contains `promptMarker`, so a spec can assert
	 * on exactly what the model request carried for its own send.
	 */
	private async getCapturedRequestAndErrors(
		marker: string,
		isReady: (payload: {
			request: CapturedCompletionRequest | null;
			errors: readonly CapturedCompletionError[];
		}) => boolean = (payload) => payload.request !== null,
		waitError: (marker: string) => string = (value) =>
			`Chat completions stub never received a request matching "${value}"`,
	): Promise<{
		request: CapturedCompletionRequest | null;
		errors: readonly CapturedCompletionError[];
	}> {
		const url = `${this.stubUrl()}${CHAT_COMPLETIONS_STUB_INTROSPECTION_PATH}?marker=${encodeURIComponent(marker)}`;
		const deadline = Date.now() + REQUEST_POLL_TIMEOUT_MS;
		for (;;) {
			const response = await getRequest(url);
			const payload = (await response.json()) as {
				request: CapturedCompletionRequest | null;
				errors: readonly CapturedCompletionError[];
			};
			if (isReady(payload)) return payload;
			if (Date.now() >= deadline) {
				throw new Error(waitError(marker));
			}
			await getPage().waitForTimeout(REQUEST_POLL_INTERVAL_MS);
		}
	}

	async waitForCapturedRequest(promptMarker: string): Promise<CapturedCompletionRequest> {
		const payload = await this.getCapturedRequestAndErrors(promptMarker);
		if (!payload.request) {
			throw new Error(`Chat completions stub never received a request matching "${promptMarker}"`);
		}
		return payload.request;
	}

	async verifyCapturedErrorResponse(
		marker: string,
		status: number,
		message: string,
	): Promise<void> {
		const payload = await this.getCapturedRequestAndErrors(
			marker,
			(response) => response.errors.length > 0,
			(value) => `Chat completions stub never recorded an error matching "${value}"`,
		);
		const matchingErrors = payload.errors.filter(
			(entry) => entry.status === status && entry.message === message,
		);
		expect(
			matchingErrors.length,
			`The stub should return HTTP ${status} with "${message}"`,
		).toBeGreaterThan(0);
		const attempts = matchingErrors.reduce((total, entry) => total + entry.attempts, 0);
		expect(attempts, "The failed prompt should not be retried by the Kilo CLI").toBe(1);
	}

	/**
	 * Resolves `waitForCapturedRequest(promptMarker)` and asserts it carried
	 * exactly one image part whose decoded byte length matches
	 * `expectedByteLength` — proof the uploaded fixture's actual bytes, not
	 * just "some image", reached the model request.
	 */
	async verifyCapturedImageByteLength(
		promptMarker: string,
		expectedByteLength: number,
	): Promise<void> {
		const captured = await this.waitForCapturedRequest(promptMarker);
		expect(captured.images, "Model request should carry exactly one image part").toHaveLength(1);
		expect(
			captured.images[0]?.byteLength,
			"Image part's decoded byte length should match the uploaded fixture's on-disk size",
		).toBe(expectedByteLength);
	}

	/** The request carrying `promptMarker` assembled text that includes `expectedText`. */
	async verifyCapturedPromptContains(promptMarker: string, expectedText: string): Promise<void> {
		const captured = await this.waitForCapturedRequest(promptMarker);
		expect(
			captured.promptText,
			`The model request for "${promptMarker}" should include "${expectedText}"`,
		).toContain(expectedText);
	}

	/** The request carrying `promptMarker` left out `unexpectedText` (an unresolved directive, say). */
	async verifyCapturedPromptOmits(promptMarker: string, unexpectedText: string): Promise<void> {
		const captured = await this.waitForCapturedRequest(promptMarker);
		expect(
			captured.promptText,
			`The model request for "${promptMarker}" should not include "${unexpectedText}"`,
		).not.toContain(unexpectedText);
	}
}
