CREATE TABLE "web_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_sub" uuid NOT NULL,
	"display_name" text NOT NULL,
	"email" text,
	"role" text DEFAULT 'MEMBER' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"sessions_valid_from" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"delete_reason" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "web_users_auth_sub_uq" ON "web_users" USING btree ("auth_sub");--> statement-breakpoint
CREATE INDEX "web_users_alive_idx" ON "web_users" USING btree ("role") WHERE "web_users"."is_deleted" = false;