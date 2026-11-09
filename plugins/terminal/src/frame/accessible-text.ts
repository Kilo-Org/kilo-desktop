const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
// Excluding ESC from the body stops at the first ST; otherwise the match spans
// every byte up to the chunk's last ST and drops output between titles.
const OSC = new RegExp(`${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`, "g");
const CSI = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, "g");

/** Reduces a raw PTY output chunk to the plain text mirrored for screen readers. */
export function toAccessibleText(data: string): string {
	return [...data.replace(OSC, "").replace(CSI, "")]
		.filter((character) => {
			const code = character.charCodeAt(0);
			return (
				(code > 0x1f && code !== 0x7f) ||
				character === "\n" ||
				character === "\r" ||
				character === "\t"
			);
		})
		.join("");
}
