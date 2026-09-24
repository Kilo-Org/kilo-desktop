// Derived from Pierre's diffshub (apps/diffshub/lib/streamGitPatchFiles.ts), Copyright 2025 Pierre Computer Company,
// Apache-2.0. Modified for Kilo Desktop; see THIRD_PARTY_NOTICES.md.

const GIT_FILE_BOUNDARY = "diff --git ";
const GIT_FILE_BOUNDARY_WITH_NEWLINE = `\n${GIT_FILE_BOUNDARY}`;
const GIT_FILE_BOUNDARY_SCAN_OVERLAP = GIT_FILE_BOUNDARY_WITH_NEWLINE.length - 1;
const NON_WHITESPACE_PATTERN = /\S/;

/**
 * Incrementally splits a streaming git patch body into per-file texts.
 *
 * Buffers the current file until the following `diff --git ` header arrives so
 * each parsed file is complete before it is handed to `onFileText`. The chunk
 * scan overlaps by the boundary length so a header split across chunks is
 * still recognized.
 *
 * Returns `fallbackPatchContent` when the body contains no `diff --git `
 * boundary at all (an empty body returns `undefined`) — callers decide what a
 * non-diff body means. Ported from diffshub (`streamGitPatchFiles.ts`), minus
 * the commit-email metadata handling (our patches are plain `git diff`
 * output, never `format-patch` emails).
 */
export async function streamGitPatchFiles(
	body: ReadableStream<Uint8Array>,
	onFileText: (fileText: string) => Promise<void> | void,
): Promise<string | undefined> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	const parser = createGitPatchFileStreamParser();

	try {
		for (;;) {
			const result = await reader.read();
			if (result.done) {
				break;
			}
			if (result.value.byteLength > 0) {
				parser.push(decoder.decode(result.value, { stream: true }));
				await consumeAvailableStreamedFiles(parser, onFileText);
			}
		}

		const finalText = decoder.decode();
		if (finalText.length > 0) {
			parser.push(finalText);
			await consumeAvailableStreamedFiles(parser, onFileText);
		}
		const finishResult = parser.finish();
		if (finishResult.fileText != null) {
			await onFileText(finishResult.fileText);
		}
		let fileText: string | undefined;
		while ((fileText = parser.takeAvailableFile()) != null) {
			await onFileText(fileText);
		}
		return finishResult.fallbackPatchContent;
	} finally {
		reader.releaseLock();
	}
}

interface GitPatchFileStreamFinishResult {
	fallbackPatchContent?: string;
	fileText?: string;
}

interface GitPatchFileStreamParser {
	finish(): GitPatchFileStreamFinishResult;
	push(chunk: string): void;
	takeAvailableFile(): string | undefined;
}

async function consumeAvailableStreamedFiles(
	parser: GitPatchFileStreamParser,
	onFileText: (fileText: string) => Promise<void> | void,
): Promise<void> {
	let fileText: string | undefined;
	while ((fileText = parser.takeAvailableFile()) != null) {
		await onFileText(fileText);
	}
}

function createGitPatchFileStreamParser(): GitPatchFileStreamParser {
	let buffer = "";
	let currentFileBoundaryIndex: number | undefined;
	let nextBoundarySearchIndex = 0;
	let sawFileBoundary = false;

	function takeAvailableFile(): string | undefined {
		if (currentFileBoundaryIndex == null) {
			currentFileBoundaryIndex = findNextGitFileBoundary(buffer, nextBoundarySearchIndex);
			if (currentFileBoundaryIndex == null) {
				nextBoundarySearchIndex = getNextBoundarySearchIndex(buffer, 0);
				return undefined;
			}

			sawFileBoundary = true;
			nextBoundarySearchIndex = currentFileBoundaryIndex + 1;
		}

		for (;;) {
			const fileBoundaryIndex = currentFileBoundaryIndex;
			if (fileBoundaryIndex == null) {
				return undefined;
			}

			const nextBoundaryIndex = findNextGitFileBoundary(buffer, nextBoundarySearchIndex);
			if (nextBoundaryIndex == null) {
				nextBoundarySearchIndex = getNextBoundarySearchIndex(buffer, fileBoundaryIndex + 1);
				return undefined;
			}

			const fileText = buffer.slice(0, nextBoundaryIndex);
			buffer = buffer.slice(nextBoundaryIndex);
			currentFileBoundaryIndex = findNextGitFileBoundary(buffer, 0);
			nextBoundarySearchIndex = currentFileBoundaryIndex == null ? 0 : currentFileBoundaryIndex + 1;
			if (NON_WHITESPACE_PATTERN.test(fileText)) {
				return fileText;
			}
		}
	}

	return {
		push(chunk: string) {
			if (chunk.length === 0) {
				return;
			}
			buffer += chunk;
		},
		takeAvailableFile,
		finish() {
			const fileText = takeAvailableFile();
			if (fileText != null) {
				return { fileText };
			}

			if (!NON_WHITESPACE_PATTERN.test(buffer)) {
				buffer = "";
				return {};
			}
			if (!sawFileBoundary) {
				const fullPatchText = buffer;
				buffer = "";
				return { fallbackPatchContent: fullPatchText };
			}

			const finalFileText = buffer;
			buffer = "";
			return { fileText: finalFileText };
		},
	};
}

function getNextBoundarySearchIndex(text: string, minimumIndex: number): number {
	return Math.max(minimumIndex, text.length - GIT_FILE_BOUNDARY_SCAN_OVERLAP);
}

function findNextGitFileBoundary(text: string, fromIndex: number): number | undefined {
	const startIndex = Math.max(fromIndex, 0);
	if (startIndex === 0 && text.startsWith(GIT_FILE_BOUNDARY)) {
		return 0;
	}

	const boundaryIndex = text.indexOf(GIT_FILE_BOUNDARY_WITH_NEWLINE, startIndex);
	return boundaryIndex === -1 ? undefined : boundaryIndex + 1;
}
