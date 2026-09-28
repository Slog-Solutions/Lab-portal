-- CreateTable
CREATE TABLE "RoundTableTurn" (
    "id" TEXT NOT NULL,
    "activityInstanceId" TEXT NOT NULL,
    "stationId" TEXT,
    "studentId" TEXT,
    "teacherUserId" TEXT,
    "role" TEXT NOT NULL,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoundTableTurn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoundTableTurn_activityInstanceId_idx" ON "RoundTableTurn"("activityInstanceId");

-- AddForeignKey
ALTER TABLE "RoundTableTurn" ADD CONSTRAINT "RoundTableTurn_activityInstanceId_fkey" FOREIGN KEY ("activityInstanceId") REFERENCES "ActivityInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
