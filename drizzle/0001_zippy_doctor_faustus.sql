CREATE TYPE "public"."improvement_request_status" AS ENUM('OPEN', 'IN_PROGRESS', 'RESOLVED');--> statement-breakpoint
CREATE TABLE "improvement_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_key" text NOT NULL,
	"menu_key" text,
	"body" text NOT NULL,
	"status" "improvement_request_status" DEFAULT 'OPEN' NOT NULL,
	"in_progress_by" uuid,
	"in_progress_at" timestamp with time zone,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"imported_from" text,
	"imported_ref" text,
	"imported_author_name" text,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"delete_reason" text,
	CONSTRAINT "improvement_requests_body_length" CHECK (char_length("improvement_requests"."body") BETWEEN 1 AND 2000),
	CONSTRAINT "improvement_requests_status_columns" CHECK (
        ("improvement_requests"."status" = 'OPEN' AND "improvement_requests"."in_progress_at" IS NULL AND "improvement_requests"."resolved_at" IS NULL)
        OR
        ("improvement_requests"."status" = 'IN_PROGRESS' AND "improvement_requests"."in_progress_at" IS NOT NULL AND "improvement_requests"."resolved_at" IS NULL)
        OR
        ("improvement_requests"."status" = 'RESOLVED' AND "improvement_requests"."resolved_at" IS NOT NULL)
      ),
	CONSTRAINT "improvement_requests_actor_pairs" CHECK (
        ("improvement_requests"."in_progress_by" IS NULL OR "improvement_requests"."in_progress_at" IS NOT NULL)
        AND ("improvement_requests"."resolved_by" IS NULL OR "improvement_requests"."resolved_at" IS NOT NULL)
      ),
	CONSTRAINT "improvement_requests_origin" CHECK (
        ("improvement_requests"."imported_from" IS NULL AND "improvement_requests"."imported_ref" IS NULL
          AND "improvement_requests"."imported_author_name" IS NULL AND "improvement_requests"."created_by" IS NOT NULL)
        OR
        ("improvement_requests"."imported_from" IS NOT NULL AND "improvement_requests"."imported_ref" IS NOT NULL
          AND ("improvement_requests"."created_by" IS NOT NULL OR "improvement_requests"."imported_author_name" IS NOT NULL))
      )
);
--> statement-breakpoint
ALTER TABLE "improvement_requests" ADD CONSTRAINT "improvement_requests_in_progress_by_web_users_id_fk" FOREIGN KEY ("in_progress_by") REFERENCES "public"."web_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "improvement_requests" ADD CONSTRAINT "improvement_requests_resolved_by_web_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."web_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "improvement_requests" ADD CONSTRAINT "improvement_requests_created_by_web_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."web_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "improvement_requests" ADD CONSTRAINT "improvement_requests_updated_by_web_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."web_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "improvement_requests_created_at_idx" ON "improvement_requests" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "improvement_requests_imported_uq" ON "improvement_requests" USING btree ("imported_from","imported_ref") WHERE "improvement_requests"."imported_from" IS NOT NULL;