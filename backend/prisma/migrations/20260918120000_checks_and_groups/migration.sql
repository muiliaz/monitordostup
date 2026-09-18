-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "CheckStatus" AS ENUM ('unknown', 'up', 'down');

-- CreateTable
CREATE TABLE "groups" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "alert_emails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checks" (
    "id" SERIAL NOT NULL,
    "group_id" INTEGER,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "interval_sec" INTEGER NOT NULL,
    "timeout_ms" INTEGER NOT NULL,
    "expected_status" INTEGER NOT NULL DEFAULT 200,
    "expected_body_substring" TEXT,
    "is_paused" BOOLEAN NOT NULL DEFAULT false,
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "next_run_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_running" BOOLEAN NOT NULL DEFAULT false,
    "locked_at" TIMESTAMPTZ(3),
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "consecutive_successes" INTEGER NOT NULL DEFAULT 0,
    "current_status" "CheckStatus" NOT NULL DEFAULT 'unknown',
    "status_changed_at" TIMESTAMPTZ(3),
    "last_checked_at" TIMESTAMPTZ(3),
    "last_response_time_ms" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "groups_name_key" ON "groups"("name");

-- CreateIndex
CREATE INDEX "checks_group_id_idx" ON "checks"("group_id");

-- CreateIndex
CREATE INDEX "checks_is_paused_next_run_at_idx" ON "checks"("is_paused", "next_run_at");

-- AddForeignKey
ALTER TABLE "checks" ADD CONSTRAINT "checks_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

