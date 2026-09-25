-- CreateTable
CREATE TABLE "CalendarPreference" (
    "userId" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "included" BOOLEAN NOT NULL,

    CONSTRAINT "CalendarPreference_pkey" PRIMARY KEY ("userId","calendarId")
);

-- AddForeignKey
ALTER TABLE "CalendarPreference" ADD CONSTRAINT "CalendarPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
