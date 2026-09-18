-- AlterTable
ALTER TABLE "checks" ADD COLUMN     "failing_since" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "check_results" (
    "id" BIGSERIAL NOT NULL,
    "check_id" INTEGER NOT NULL,
    "checked_at" TIMESTAMPTZ(3) NOT NULL,
    "is_success" BOOLEAN NOT NULL,
    "response_time_ms" INTEGER NOT NULL,
    "http_code" INTEGER,
    "error_message" TEXT,

    CONSTRAINT "check_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" SERIAL NOT NULL,
    "check_id" INTEGER NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "ended_at" TIMESTAMPTZ(3),
    "duration_sec" INTEGER,
    "cause" TEXT,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "check_results_check_id_checked_at_idx" ON "check_results"("check_id", "checked_at");

-- CreateIndex
CREATE INDEX "incidents_check_id_started_at_idx" ON "incidents"("check_id", "started_at");

-- CreateIndex
CREATE INDEX "incidents_started_at_idx" ON "incidents"("started_at");

-- AddForeignKey
ALTER TABLE "check_results" ADD CONSTRAINT "check_results_check_id_fkey" FOREIGN KEY ("check_id") REFERENCES "checks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_check_id_fkey" FOREIGN KEY ("check_id") REFERENCES "checks"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- At most one open incident per check. Prisma can't express partial indexes,
-- so it lives here; it protects against a second "down" transition being
-- recorded while an incident is already open.
CREATE UNIQUE INDEX "incidents_one_open_per_check" ON "incidents"("check_id") WHERE "ended_at" IS NULL;
