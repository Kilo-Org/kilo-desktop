import { wait } from "@anaconda/playwright-utils";

interface ProcessOutput {
	mark(): number;
	since(mark: number): string;
}

// Electron's message when node-pty's OS-ConPTY kill path forks its console-list
// helper in a build whose RunAsNode fuse is disabled.
const FORK_BLOCKED_BY_FUSE = /child_process\.fork\(\) is not supported|runAsNode fuse/i;

// TerminalSessionManager signals twice, killGraceMs (1s) apart; outlast both.
const PTY_KILL_SETTLE_MS = 2_500;

/**
 * Asserts on packaged main-process output. node-pty's kill failure is an
 * unhandled rejection in main, so the UI stays correct and only the process
 * output reveals it.
 */
export class MainProcessErrors {
	constructor(private readonly output: ProcessOutput) {}

	mark(): number {
		return this.output.mark();
	}

	async verifyPtyKillDidNotForkSince(mark: number): Promise<void> {
		await wait(PTY_KILL_SETTLE_MS);
		const offending = this.output
			.since(mark)
			.split("\n")
			.filter((line) => FORK_BLOCKED_BY_FUSE.test(line));
		if (offending.length > 0) {
			throw new Error(
				`Killing a terminal PTY tried to fork a Node child process:\n${offending.join("\n")}`,
			);
		}
	}
}
