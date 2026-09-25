-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "repeatFreq" TEXT,
ADD COLUMN     "repeatInterval" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "repeatUntil" TEXT,
ADD COLUMN     "repeatWeekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "splitFromId" TEXT,
ALTER COLUMN "seriesEnd" DROP NOT NULL;

-- Existing "every N weeks" plans become weekly plans on the start's weekday
-- (in the organizer's timezone), keeping their interval and count.
UPDATE "Plan"
SET "repeatFreq" = 'WEEKLY',
    "repeatInterval" = "repeatEveryWeeks",
    "repeatWeekdays" = ARRAY[EXTRACT(DOW FROM ("start" AT TIME ZONE 'UTC' AT TIME ZONE "timeZone"))::INTEGER]
WHERE "repeatEveryWeeks" IS NOT NULL AND "repeatCount" > 1;

ALTER TABLE "Plan" DROP COLUMN "repeatEveryWeeks";

-- CreateTable
CREATE TABLE "PlanException" (
    "planId" TEXT NOT NULL,
    "originalStart" TIMESTAMP(3) NOT NULL,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT,
    "location" TEXT,
    "notes" TEXT,
    "start" TIMESTAMP(3),
    "end" TIMESTAMP(3),

    CONSTRAINT "PlanException_pkey" PRIMARY KEY ("planId","originalStart")
);

-- CreateTable
CREATE TABLE "OccurrenceRsvp" (
    "planId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "originalStart" TIMESTAMP(3) NOT NULL,
    "response" "RsvpResponse" NOT NULL,
    "googleEventId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OccurrenceRsvp_pkey" PRIMARY KEY ("planId","userId","originalStart")
);

-- AddForeignKey
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_splitFromId_fkey" FOREIGN KEY ("splitFromId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanException" ADD CONSTRAINT "PlanException_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OccurrenceRsvp" ADD CONSTRAINT "OccurrenceRsvp_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OccurrenceRsvp" ADD CONSTRAINT "OccurrenceRsvp_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
