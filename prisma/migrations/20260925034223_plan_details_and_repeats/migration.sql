-- DropIndex
DROP INDEX "Plan_groupId_start_idx";

-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "location" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "repeatCount" INTEGER,
ADD COLUMN     "repeatEveryWeeks" INTEGER,
ADD COLUMN     "seriesEnd" TIMESTAMP(3),
ADD COLUMN     "timeZone" TEXT NOT NULL DEFAULT 'UTC';

-- Existing plans are all one-time, so their series ends when they do.
UPDATE "Plan" SET "seriesEnd" = "end";
ALTER TABLE "Plan" ALTER COLUMN "seriesEnd" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Plan_groupId_seriesEnd_idx" ON "Plan"("groupId", "seriesEnd");
