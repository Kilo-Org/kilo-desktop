import { randomUUID } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { asc, eq } from "drizzle-orm";

import { FeatureError } from "@kilo-desktop/feature-sdk/main";

import {
	DEFAULT_WORKSPACE_IDENTITY_COLOR,
	normalizeWorkspaceIdentityColor,
	type Workspace,
	type WorkspaceFolderInput,
} from "../../contracts/workspaces/schemas.js";

import type { WorkspacesDatabase } from "./db.js";
import { workspaceFolders, workspaces } from "./schema.js";

type SaveWorkspaceInput = {
	name?: string | undefined;
	color?: string | undefined;
	folders: WorkspaceFolderInput[];
};

function comparablePath(folderPath: string): string {
	return process.platform === "win32" ? folderPath.toLocaleLowerCase() : folderPath;
}

function canonicalHomeDirectory(): string {
	try {
		return realpathSync.native(homedir());
	} catch {
		return homedir();
	}
}

export class WorkspaceService {
	constructor(
		private readonly db: WorkspacesDatabase,
		private readonly createId: () => string = randomUUID,
		private readonly now: () => number = Date.now,
	) {}

	list(): Workspace[] {
		return this.db
			.select()
			.from(workspaces)
			.all()
			.map((workspace) => this.hydrate(workspace))
			.sort((left, right) =>
				left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
			);
	}

	get(id: string): Workspace | null {
		const workspace = this.db.select().from(workspaces).where(eq(workspaces.id, id)).get();
		return workspace ? this.hydrate(workspace) : null;
	}

	create(input: SaveWorkspaceInput): Workspace {
		const folders = this.validateFolders(input.folders);
		const name = this.resolveName(input.name, folders[0]!.path);
		const color = this.resolveColor(input.color, DEFAULT_WORKSPACE_IDENTITY_COLOR);
		const timestamp = this.now();
		const workspaceId = this.createId();

		this.db.transaction((tx) => {
			tx.insert(workspaces)
				.values({
					id: workspaceId,
					name,
					color,
					createdAt: timestamp,
					updatedAt: timestamp,
				})
				.run();
			tx.insert(workspaceFolders)
				.values(
					folders.map((folder, position) => ({
						id: this.createId(),
						workspaceId,
						path: folder.path,
						isPrimary: position === 0,
						position,
					})),
				)
				.run();
		});

		return this.getRequired(workspaceId);
	}

	update(id: string, input: SaveWorkspaceInput): Workspace {
		const before = this.getRequired(id);
		const folders = this.validateFolders(input.folders);
		const name =
			input.name === undefined ? before.name : this.resolveName(input.name, folders[0]!.path, id);
		const color = this.resolveColor(input.color, before.color ?? null);
		const retainedIds = new Map(
			before.folders.map((folder) => [comparablePath(folder.path), folder.id]),
		);

		this.db.transaction((tx) => {
			tx.update(workspaces)
				.set({ name, color, updatedAt: this.now() })
				.where(eq(workspaces.id, id))
				.run();
			tx.delete(workspaceFolders).where(eq(workspaceFolders.workspaceId, id)).run();
			tx.insert(workspaceFolders)
				.values(
					folders.map((folder, position) => ({
						id: retainedIds.get(comparablePath(folder.path)) ?? this.createId(),
						workspaceId: id,
						path: folder.path,
						isPrimary: position === 0,
						position,
					})),
				)
				.run();
		});

		return this.getRequired(id);
	}

	remove(id: string): Workspace {
		const workspace = this.getRequired(id);
		this.db.transaction((tx) => {
			tx.delete(workspaces).where(eq(workspaces.id, id)).run();
		});
		return workspace;
	}

	getRequired(id: string): Workspace {
		const workspace = this.get(id);
		if (!workspace) throw new FeatureError("Workspace not found.", "NOT_FOUND");
		return workspace;
	}

	private hydrate(workspace: typeof workspaces.$inferSelect): Workspace {
		const folders = this.db
			.select()
			.from(workspaceFolders)
			.where(eq(workspaceFolders.workspaceId, workspace.id))
			.orderBy(asc(workspaceFolders.position))
			.all()
			.map(({ workspaceId: _workspaceId, ...folder }) => folder);
		const color = normalizeWorkspaceIdentityColor(workspace.color) ?? undefined;
		return {
			id: workspace.id,
			name: workspace.name,
			...(color ? { color } : {}),
			folders,
			createdAt: workspace.createdAt,
			updatedAt: workspace.updatedAt,
		};
	}

	private resolveColor(raw: string | undefined, fallback: string | null): string | null {
		if (raw === undefined) return fallback;
		const trimmed = raw.trim();
		if (!trimmed) return fallback;
		const hex = normalizeWorkspaceIdentityColor(trimmed);
		if (!hex) throw new FeatureError("Invalid identity color.", "VALIDATION");
		return hex;
	}

	private validateFolders(input: WorkspaceFolderInput[]): WorkspaceFolderInput[] {
		if (input.length === 0) {
			throw new FeatureError("A workspace needs at least one folder.", "VALIDATION");
		}
		if (input.filter((folder) => folder.isPrimary).length !== 1) {
			throw new FeatureError("A workspace must have exactly one primary folder.", "VALIDATION");
		}

		const home = comparablePath(canonicalHomeDirectory());
		const seen = new Set<string>();
		const canonical = input.map((folder) => {
			if (!path.isAbsolute(folder.path)) {
				throw new FeatureError("Workspace folders must use absolute paths.", "VALIDATION");
			}
			let resolved: string;
			try {
				resolved = realpathSync.native(folder.path);
				if (!statSync(resolved).isDirectory()) throw new Error("not a directory");
			} catch {
				throw new FeatureError(
					`Workspace folder does not exist or is not a directory: ${folder.path}`,
					"VALIDATION",
				);
			}
			const comparable = comparablePath(resolved);
			if (resolved === path.parse(resolved).root || comparable === home) {
				throw new FeatureError(
					"Filesystem roots and the home directory cannot be workspace folders.",
					"VALIDATION",
				);
			}
			if (seen.has(comparable)) {
				throw new FeatureError("Workspace folders must be unique.", "VALIDATION");
			}
			seen.add(comparable);
			return { path: resolved, isPrimary: folder.isPrimary };
		});

		const primary = canonical.find((folder) => folder.isPrimary)!;
		return [primary, ...canonical.filter((folder) => !folder.isPrimary)].map(
			(folder, position) => ({ ...folder, isPrimary: position === 0 }),
		);
	}

	private resolveName(
		rawName: string | undefined,
		primaryPath: string,
		excludeId?: string,
	): string {
		const supplied = rawName?.trim();
		if (supplied) return supplied;

		const baseName = path.basename(primaryPath);
		const occupied = new Set(
			this.db
				.select({ id: workspaces.id, name: workspaces.name })
				.from(workspaces)
				.all()
				.filter((workspace) => workspace.id !== excludeId)
				.map((workspace) => workspace.name.toLocaleLowerCase()),
		);
		if (!occupied.has(baseName.toLocaleLowerCase())) return baseName;

		for (let suffix = 2; ; suffix += 1) {
			const candidate = `${baseName} (${suffix})`;
			if (!occupied.has(candidate.toLocaleLowerCase())) return candidate;
		}
	}
}
