-- Restart-safe like the initial migration: a terminated dev build may leave
-- these tables in place before Drizzle records the migration.
CREATE TABLE IF NOT EXISTS `session_chats` (
	`kilo_session_id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `session_chats_session_idx` ON `session_chats` (`session_id`,`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL
);
