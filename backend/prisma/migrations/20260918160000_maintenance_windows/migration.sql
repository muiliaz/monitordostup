-- AlterEnum
ALTER TYPE "AlertStatus" ADD VALUE 'suppressed';

-- CreateTable
CREATE TABLE "maintenance_windows" (
    "id" SERIAL NOT NULL,
    "check_id" INTEGER,
    "group_id" INTEGER,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maintenance_windows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "maintenance_windows_check_id_ends_at_idx" ON "maintenance_windows"("check_id", "ends_at");

-- CreateIndex
CREATE INDEX "maintenance_windows_group_id_ends_at_idx" ON "maintenance_windows"("group_id", "ends_at");

-- CreateIndex
CREATE INDEX "maintenance_windows_ends_at_idx" ON "maintenance_windows"("ends_at");

-- AddForeignKey
ALTER TABLE "maintenance_windows" ADD CONSTRAINT "maintenance_windows_check_id_fkey" FOREIGN KEY ("check_id") REFERENCES "checks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_windows" ADD CONSTRAINT "maintenance_windows_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A window targets exactly one check or exactly one group, and is not empty.
ALTER TABLE "maintenance_windows"
  ADD CONSTRAINT "maintenance_windows_one_target" CHECK (("check_id" IS NULL) <> ("group_id" IS NULL)),
  ADD CONSTRAINT "maintenance_windows_positive_duration" CHECK ("ends_at" > "starts_at");
