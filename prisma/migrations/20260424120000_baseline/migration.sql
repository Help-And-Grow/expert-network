-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "SessionType" AS ENUM ('ONLINE', 'OFFLINE', 'BOTH');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OnboardingStep" AS ENUM ('SOCIAL_LINKS', 'DOMAINS', 'SESSION_PREFS', 'AI_GENERATION', 'PREVIEW', 'PUBLISHED');

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "nickName" TEXT,
    "email" TEXT,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "telegramId" TEXT,
    "telegramUsername" TEXT,
    "wechatOpenId" TEXT,
    "wechatUnionId" TEXT,
    "inviteCode" TEXT,
    "tokenBalance" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "linkedIn" TEXT,
    "website" TEXT,
    "twitter" TEXT,
    "substack" TEXT,
    "instagram" TEXT,
    "xiaohongshu" TEXT,
    "gender" TEXT,
    "tonWalletAddress" TEXT,
    "tonWalletType" TEXT,
    "tonMnemonicEnc" TEXT,
    "priceOnlineCents" INTEGER,
    "priceOfflineCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'SGD',
    "stripeAccountId" TEXT,
    "stripeAccountStatus" TEXT DEFAULT 'none',
    "wechatSubMchId" TEXT,
    "weeklySchedule" JSONB,
    "sessionType" "SessionType" NOT NULL DEFAULT 'BOTH',
    "bio" TEXT,
    "audioIntroUrl" TEXT,
    "fishAudioModelId" TEXT,
    "mem9SpaceId" TEXT,
    "servicesOffered" JSONB,
    "documentName" TEXT,
    "documentData" TEXT,
    "avatarVideoUrl" TEXT,
    "avatarScript" TEXT,
    "onboardingStep" "OnboardingStep" NOT NULL DEFAULT 'SOCIAL_LINKS',
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "avgRating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvailableSlot" (
    "id" TEXT NOT NULL,
    "expertId" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "isBooked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AvailableSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "expertId" TEXT NOT NULL,
    "founderId" TEXT NOT NULL,
    "sessionType" "SessionType" NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Singapore',
    "meetingLink" TEXT,
    "offlineAddress" TEXT,
    "status" "BookingStatus" NOT NULL DEFAULT 'PENDING',
    "cancelledBy" TEXT,
    "cancelReason" TEXT,
    "totalAmountCents" INTEGER,
    "depositAmountCents" INTEGER,
    "tokenDiscount" INTEGER DEFAULT 0,
    "tokensRedeemed" INTEGER DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'SGD',
    "paymentMethod" TEXT,
    "paymentStatus" TEXT NOT NULL DEFAULT 'pending',
    "stripeCheckoutSessionId" TEXT,
    "stripePaymentIntentId" TEXT,
    "wechatTransactionId" TEXT,
    "stripeCustomerId" TEXT,
    "stripePaymentMethodId" TEXT,
    "stripeRemainderPIId" TEXT,
    "paynowReference" TEXT,
    "paynowPayerReference" TEXT,
    "paynowSubmittedAt" TIMESTAMP(3),
    "paynowConfirmedAt" TIMESTAMP(3),
    "tonDepositTxHash" TEXT,
    "tonRemainderTxHash" TEXT,
    "remainderChargedAt" TIMESTAMP(3),
    "isPremiumLive" BOOLEAN NOT NULL DEFAULT false,
    "liveRoomId" TEXT,
    "liveDurationMinutes" INTEGER,
    "liveAccessChargedAt" TIMESTAMP(3),
    "wechatProfitShareStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "expertId" TEXT NOT NULL,
    "founderId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "expertSuggestion" TEXT,
    "suggestionAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvitationCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "maxUses" INTEGER NOT NULL DEFAULT 10,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "note" TEXT,
    "expiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvitationCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "POMPCredential" (
    "id" TEXT NOT NULL,
    "expertId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "recipientRole" TEXT NOT NULL,
    "attestationUID" TEXT NOT NULL,
    "recipient" TEXT,
    "hours" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "POMPCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenLedger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bookingId" TEXT,
    "type" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");

-- CreateIndex
CREATE UNIQUE INDEX "User_wechatOpenId_key" ON "User"("wechatOpenId");

-- CreateIndex
CREATE UNIQUE INDEX "Expert_userId_key" ON "Expert"("userId");

-- CreateIndex
CREATE INDEX "AvailableSlot_expertId_startTime_idx" ON "AvailableSlot"("expertId", "startTime");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_liveRoomId_key" ON "Booking"("liveRoomId");

-- CreateIndex
CREATE INDEX "Booking_expertId_startTime_idx" ON "Booking"("expertId", "startTime");

-- CreateIndex
CREATE INDEX "Booking_founderId_idx" ON "Booking"("founderId");

-- CreateIndex
CREATE UNIQUE INDEX "Review_bookingId_key" ON "Review"("bookingId");

-- CreateIndex
CREATE INDEX "Review_expertId_idx" ON "Review"("expertId");

-- CreateIndex
CREATE INDEX "Review_founderId_idx" ON "Review"("founderId");

-- CreateIndex
CREATE INDEX "Review_bookingId_idx" ON "Review"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "InvitationCode_code_key" ON "InvitationCode"("code");

-- CreateIndex
CREATE UNIQUE INDEX "POMPCredential_attestationUID_key" ON "POMPCredential"("attestationUID");

-- CreateIndex
CREATE INDEX "POMPCredential_expertId_idx" ON "POMPCredential"("expertId");

-- CreateIndex
CREATE UNIQUE INDEX "POMPCredential_bookingId_recipientRole_key" ON "POMPCredential"("bookingId", "recipientRole");

-- CreateIndex
CREATE INDEX "TokenLedger_userId_idx" ON "TokenLedger"("userId");

-- CreateIndex
CREATE INDEX "TokenLedger_bookingId_idx" ON "TokenLedger"("bookingId");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expert" ADD CONSTRAINT "Expert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailableSlot" ADD CONSTRAINT "AvailableSlot_expertId_fkey" FOREIGN KEY ("expertId") REFERENCES "Expert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_expertId_fkey" FOREIGN KEY ("expertId") REFERENCES "Expert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_founderId_fkey" FOREIGN KEY ("founderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_expertId_fkey" FOREIGN KEY ("expertId") REFERENCES "Expert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_founderId_fkey" FOREIGN KEY ("founderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "POMPCredential" ADD CONSTRAINT "POMPCredential_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "POMPCredential" ADD CONSTRAINT "POMPCredential_expertId_fkey" FOREIGN KEY ("expertId") REFERENCES "Expert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenLedger" ADD CONSTRAINT "TokenLedger_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenLedger" ADD CONSTRAINT "TokenLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
