import { getPage } from "@anaconda/playwright-utils/page-utils";

/**
 * Calls a domain object method from the renderer through the kernel bridge.
 * For test setup only (resetting state a test changed), never for the
 * behaviour under test, which goes through the UI.
 */
export async function callDomainMethod(
	domainId: string,
	method: string,
	input: unknown,
	caller: string,
): Promise<unknown> {
	return getPage().evaluate(
		async ({ domainId, method, input, caller }) => {
			const bridge = (
				globalThis as {
					kernelBridge?: {
						request(channel: string, payload: unknown): Promise<{ ok: boolean; value?: unknown }>;
					};
				}
			).kernelBridge;
			if (!bridge) throw new Error("window.kernelBridge is missing");
			const result = await bridge.request("kernel:domain-call", {
				domainId,
				method,
				input,
				caller,
			});
			if (!result.ok) throw new Error(`${domainId}.${method} failed: ${JSON.stringify(result)}`);
			return result.value;
		},
		{ domainId, method, input, caller },
	);
}
