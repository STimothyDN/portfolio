CREATE TABLE `shipment` (
	`user_id` text NOT NULL,
	`number` text NOT NULL,
	`carrier` integer,
	`status` text,
	`detail` text,
	`location` text,
	`event_at` integer,
	`registered` integer DEFAULT false NOT NULL,
	`checked_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `number`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `roll` ADD `exposure_comp` real;--> statement-breakpoint
ALTER TABLE `roll` ADD `lab_delivery` text;--> statement-breakpoint
ALTER TABLE `roll` ADD `tracking_out` text;--> statement-breakpoint
ALTER TABLE `roll` ADD `tracking_back` text;--> statement-breakpoint
ALTER TABLE `roll` ADD `prints_included` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `roll` ADD `prints_cost_cents` integer;