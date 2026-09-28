-- CreateTable
CREATE TABLE "LockGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "stationId" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'soft',
    "screen" BOOLEAN NOT NULL DEFAULT true,
    "input" BOOLEAN NOT NULL DEFAULT true,
    "message" TEXT,
    "lockedById" TEXT NOT NULL,
    "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LockGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LockGrant_userId_key" ON "LockGrant"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "LockGrant_stationId_key" ON "LockGrant"("stationId");

-- CreateIndex
CREATE INDEX "LockGrant_lockedById_idx" ON "LockGrant"("lockedById");

-- AddForeignKey
ALTER TABLE "LockGrant" ADD CONSTRAINT "LockGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LockGrant" ADD CONSTRAINT "LockGrant_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LockGrant" ADD CONSTRAINT "LockGrant_lockedById_fkey" FOREIGN KEY ("lockedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
