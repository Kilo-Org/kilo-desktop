import { statSync } from "node:fs";
import path from "node:path";

const FILES_DIR = path.join(import.meta.dirname, "files");

/** Reads the fixture's real on-disk size instead of hardcoding it, so content-fidelity assertions never drift from the committed file. */
function fileByteLength(filePath: string): number {
	return statSync(filePath).size;
}

export type AttachmentFixture = {
	path: string;
	name: string;
	/**
	 * Unique string the spec types into the composer alongside the attachment.
	 * The mock chat-completions stub (`utils/chat-completions-stub.ts`) keys
	 * its canned reply on this marker — never on attachment content, since an
	 * image attachment carries no filename and no readable text on the wire.
	 */
	promptMarker: string;
	/**
	 * Unique string baked into the fixture's own bytes, used only for
	 * content-fidelity assertions on text-ish fixtures (text/json/code) whose
	 * payload the stub can decode back to UTF-8. Undefined for fixtures whose
	 * content fidelity is checked a different way (image: byte length; pdf:
	 * binary, not decodable as plain text).
	 */
	contentMarker?: string;
	/** Exact on-disk byte length, for fixtures whose fidelity check is "the right number of bytes arrived" rather than a decoded text marker. */
	expectedByteLength?: number;
};

export const chatAttachmentData = {
	image: {
		path: path.join(FILES_DIR, "sample-receipt.png"),
		name: "sample-receipt.png",
		promptMarker: "ATTACH-IMAGE-7f1c",
		expectedByteLength: fileByteLength(path.join(FILES_DIR, "sample-receipt.png")),
	},
	pdf: {
		path: path.join(FILES_DIR, "sample-document.pdf"),
		name: "sample-document.pdf",
		promptMarker: "ATTACH-PDF-9b2e",
		expectedByteLength: fileByteLength(path.join(FILES_DIR, "sample-document.pdf")),
	},
	text: {
		path: path.join(FILES_DIR, "sample-notes.txt"),
		name: "sample-notes.txt",
		promptMarker: "ATTACH-TEXT-3a08",
		contentMarker: "ORDER-4471",
	},
	json: {
		path: path.join(FILES_DIR, "sample-config.json"),
		name: "sample-config.json",
		promptMarker: "ATTACH-JSON-5d6f",
		contentMarker: "CONFIG-9023",
	},
	code: {
		path: path.join(FILES_DIR, "sample-code.ts"),
		name: "sample-code.ts",
		promptMarker: "ATTACH-CODE-c4e1",
		contentMarker: "CODE-3310",
	},
	/**
	 * Null-byte binary content with an unsupported extension — fails the
	 * adapter's text-sniffing fallback (`openCodeAttachmentAdapter.ts`), so
	 * it never reaches the composer send path and has no prompt marker.
	 */
	unsupported: {
		path: path.join(FILES_DIR, "sample-unsupported.exe"),
		name: "sample-unsupported.exe",
	},
} as const satisfies Record<string, AttachmentFixture | Omit<AttachmentFixture, "promptMarker">>;

/** Canned stub replies keyed by `promptMarker`, consumed by the mock chat-completions stub. */
export const chatAttachmentStubReplies: Record<string, string> = {
	[chatAttachmentData.image.promptMarker]: "I received the image attachment.",
	[chatAttachmentData.pdf.promptMarker]: "I received the PDF attachment.",
	[chatAttachmentData.text.promptMarker]: "I received the text attachment.",
	[chatAttachmentData.json.promptMarker]: "I received the JSON attachment.",
	[chatAttachmentData.code.promptMarker]: "I received the code attachment.",
};
