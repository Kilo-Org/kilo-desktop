export class BusinessError extends Error {
	override readonly name = "BusinessError";

	constructor(message: string) {
		super(message);
	}
}
