import { net, type ClientRequest, type ClientRequestConstructorOptions } from "electron";

export class HttpClient {
	request(options: ClientRequestConstructorOptions | string): ClientRequest {
		return net.request(options);
	}

	fetch(input: string | globalThis.Request, init?: RequestInit): Promise<Response> {
		return net.fetch(input, init);
	}
}
