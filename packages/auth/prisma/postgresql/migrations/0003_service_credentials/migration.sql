-- CreateTable
CREATE TABLE "service_credentials" (
    "id" CHAR(36) NOT NULL,
    "domain" VARCHAR(63) NOT NULL,
    "secret_hash" VARCHAR(256) NOT NULL,
    "permissions" JSONB NOT NULL,
    "callees" JSONB NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "service_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "service_credentials_domain_key" ON "service_credentials"("domain");
