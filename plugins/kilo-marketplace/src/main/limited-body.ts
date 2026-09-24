/**
 * Reads a response body without buffering more than `maxBytes`. Returns
 * `undefined` when the declared Content-Length or the streamed byte count
 * exceeds the limit; the body is cancelled so the connection is released.
 */
export async function readLimitedBody(
	response: Response,
	maxBytes: number,
): Promise<Uint8Array | undefined> {
	const declaredLength = Number(response.headers.get("content-length") ?? Number.NaN);
	if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
		await response.body?.cancel().catch(() => undefined);
		return undefined;
	}
	if (!response.body) return new Uint8Array();
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let length = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		length += value.byteLength;
		if (length > maxBytes) {
			await reader.cancel().catch(() => undefined);
			return undefined;
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}
