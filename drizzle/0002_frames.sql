CREATE TABLE `frame` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`roll_id` text NOT NULL,
	`client_id` text NOT NULL,
	`number` integer NOT NULL,
	`shot_at` integer NOT NULL,
	`tz_offset` integer DEFAULT 0 NOT NULL,
	`camera_id` text,
	`lens_id` text,
	`focal_length` integer,
	`aperture` real,
	`shutter` text,
	`flash` integer DEFAULT false NOT NULL,
	`lat` real,
	`lng` real,
	`accuracy` integer,
	`note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`roll_id`) REFERENCES `roll`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`camera_id`) REFERENCES `camera`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`lens_id`) REFERENCES `lens`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `frame_user_client_idx` ON `frame` (`user_id`,`client_id`);--> statement-breakpoint
CREATE INDEX `frame_roll_idx` ON `frame` (`roll_id`);--> statement-breakpoint
ALTER TABLE `roll` ADD `rewound_at_frame` integer;