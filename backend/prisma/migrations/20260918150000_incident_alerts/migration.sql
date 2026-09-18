-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('sending', 'sent', 'no_recipients', 'skipped');

-- AlterTable
ALTER TABLE "incidents" ADD COLUMN     "down_alert_at" TIMESTAMPTZ(3),
ADD COLUMN     "down_alert_status" "AlertStatus",
ADD COLUMN     "up_alert_at" TIMESTAMPTZ(3),
ADD COLUMN     "up_alert_status" "AlertStatus";

