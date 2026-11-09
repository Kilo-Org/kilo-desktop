export interface PtyExitEvent {
	readonly exitCode: number;
	readonly signal: number | null;
}

export interface PtyProcess {
	readonly pid: number;
	write(data: string): void;
	resize(cols: number, rows: number): void;
	kill(signal?: string): void;
	onData(listener: (data: string) => void): () => void;
	onExit(listener: (event: PtyExitEvent) => void): () => void;
}

export interface PtySpawnOptions {
	readonly shell: string;
	readonly args: readonly string[];
	readonly cwd: string;
	readonly cols: number;
	readonly rows: number;
	readonly env: Record<string, string>;
}

export interface PtyAdapter {
	spawn(options: PtySpawnOptions): PtyProcess;
}
