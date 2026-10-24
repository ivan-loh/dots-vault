CREATE TABLE `shared_note_limits` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`window` integer NOT NULL,
	`count` integer NOT NULL,
	CONSTRAINT "shared_limit_window" CHECK(typeof("shared_note_limits"."window") = 'integer' AND "shared_note_limits"."window" >= 0),
	CONSTRAINT "shared_limit_count" CHECK(typeof("shared_note_limits"."count") = 'integer' AND "shared_note_limits"."count" BETWEEN 1 AND 31)
);
--> statement-breakpoint
CREATE TABLE `shared_notes` (
	`owner_id` text NOT NULL,
	`note_id` text NOT NULL,
	`revision` integer NOT NULL,
	`state` text NOT NULL,
	`title` text,
	`body` text,
	`last_operation_id` text NOT NULL,
	`last_operation_hash` text NOT NULL,
	`last_operation_kind` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "shared_revision" CHECK(typeof("shared_notes"."revision") = 'integer' AND "shared_notes"."revision" BETWEEN 1 AND 2147483647),
	CONSTRAINT "shared_state" CHECK(("shared_notes"."state" = 'shared' AND "shared_notes"."revision" <= 2147483646 AND "shared_notes"."title" IS NOT NULL AND "shared_notes"."body" IS NOT NULL AND length("shared_notes"."title") BETWEEN 1 AND 120 AND instr("shared_notes"."title",char(0)) = 0 AND length(trim("shared_notes"."title")) > 0 AND length(CAST("shared_notes"."title" AS BLOB)) <= 480 AND length(CAST("shared_notes"."body" AS BLOB)) <= 8192 AND "shared_notes"."last_operation_kind" = 'publish') OR ("shared_notes"."state" = 'revoked' AND "shared_notes"."title" IS NULL AND "shared_notes"."body" IS NULL AND "shared_notes"."last_operation_kind" = 'revoke')),
	CONSTRAINT "shared_receipt" CHECK(length("shared_notes"."last_operation_id") = 36 AND length("shared_notes"."last_operation_hash") = 64 AND "shared_notes"."last_operation_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "shared_ids" CHECK(length("shared_notes"."owner_id") BETWEEN 1 AND 256 AND length("shared_notes"."note_id") = 36),
	CONSTRAINT "shared_time" CHECK(typeof("shared_notes"."created_at") = 'integer' AND typeof("shared_notes"."updated_at") = 'integer' AND "shared_notes"."created_at" >= 0 AND "shared_notes"."updated_at" >= "shared_notes"."created_at" AND "shared_notes"."updated_at" <= 9007199254740991)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shared_notes_owner_note` ON `shared_notes` (`owner_id`,`note_id`);