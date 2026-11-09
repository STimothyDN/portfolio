CREATE TABLE `publish` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`at` integer NOT NULL,
	`status` text NOT NULL,
	`note` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `publish_user_idx` ON `publish` (`user_id`);--> statement-breakpoint
ALTER TABLE `frame` ADD `scan_filename` text;--> statement-breakpoint
ALTER TABLE `roll` ADD `share_exposure` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `roll` ADD `share_place` text;--> statement-breakpoint
ALTER TABLE `roll` ADD `share_notes` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `roll` ADD `first_scan_frame` integer DEFAULT 1 NOT NULL;