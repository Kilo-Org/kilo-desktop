import { net, type ClientRequest, type ClientRequestConstructorOptions } from "electron";

export class HttpClient {
	request(options: ClientRequestConstructorOptions | string): ClientRequest {
		return net.request(options);
	}

	readonly fetch: typeof globalThis.fetch = (input, init) =>
		net.fetch(input instanceof URL ? input.toString() : input, init);
}
