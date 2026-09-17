CREATE TABLE "improvement_request_attachments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"improvement_request_id" uuid NOT NULL,
	"original_file_name" text NOT NULL,
	"stored_path" text NOT NULL,
	"mime_type" text NOT NULL,
	"file_size" integer NOT NULL,
	"checksum_sha256" text NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"delete_reason" text,
	CONSTRAINT "improvement_request_attachments_file_size" CHECK ("improvement_request_attachments"."file_size" BETWEEN 1 AND 20971520),
	CONSTRAINT "improvement_request_attachments_stored_path_shape" CHECK ("improvement_request_attachments"."stored_path" ~ '^improvement-requests/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](png|jpg|jpeg)$')
);
--> statement-breakpoint
ALTER TABLE "improvement_request_attachments" ADD CONSTRAINT "improvement_request_attachments_improvement_request_id_improvement_requests_id_fk" FOREIGN KEY ("improvement_request_id") REFERENCES "public"."improvement_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "improvement_request_attachments" ADD CONSTRAINT "improvement_request_attachments_uploaded_by_web_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."web_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "improvement_request_attachments_live_idx" ON "improvement_request_attachments" USING btree ("improvement_request_id") WHERE "improvement_request_attachments"."is_deleted" = false;--> statement-breakpoint
CREATE UNIQUE INDEX "improvement_request_attachments_stored_path_uq" ON "improvement_request_attachments" USING btree ("stored_path");