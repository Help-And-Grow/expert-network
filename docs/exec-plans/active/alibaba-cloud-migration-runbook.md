# Alibaba Cloud Migration Runbook

Target: Migrate the [`Help-And-Grow/expert-network`](https://github.com/Help-And-Grow/expert-network) application and its shared database from Google Cloud (Cloud Run + Cloud SQL) to **Alibaba Cloud**. 
- Compute: **Serverless App Engine (SAE)**
- Database: **ApsaraDB RDS Serverless for PostgreSQL**

This runbook covers the end-to-end process of setting up the new Alibaba Cloud resources, deploying the active-development surface, and cutting over the production Vercel deployment (`jlzxwt8/expert-network`) to the new shared database.

## Architecture at a glance

| Concern | Current (Google Cloud + Vercel) | Future (Alibaba Cloud + Vercel) |
|---|---|---|
| Database | Google Cloud SQL `hg-postgres-prod` | Alibaba ApsaraDB RDS Serverless (PostgreSQL) |
| Production Compute (`jlzxwt8`) | Vercel serverless (`sin1`) | Vercel serverless (`sin1`) - unchanged, but connects to Alibaba DB |
| Demo Compute (`Help-And-Grow`) | Google Cloud Run `expert-network` | Alibaba Cloud Serverless App Engine (SAE) |
| Database Region | `asia-southeast1` (Singapore) | `ap-southeast-1` (Singapore) |

---

## Phase 1: Database Provisioning (ApsaraDB RDS Serverless)

1. **Create the RDS Instance**
   - Log into the Alibaba Cloud Console and navigate to **ApsaraDB RDS**.
   - Create a new **PostgreSQL** instance in the **Singapore (ap-southeast-1)** region.
   - Billing Method: **Serverless**.
   - Select the capacity range (e.g., `0.5 RCU` to `4 RCU`). Enable auto-pause if desired for cost savings during idle hours.
   - Configure Storage (e.g., 50GB ESSD).
   - Set the instance name to `hg-postgres-prod`.

2. **Network and Security Settings**
   - Place the instance in a VPC.
   - Apply an **IP Address Whitelist**. You must whitelist:
     - `0.0.0.0/0` (or specific Vercel outbound IPs/CloudBase IPs) if using public access.
     - The VPC CIDR for the Serverless App Engine (SAE) application.
   - **Apply for a Public Endpoint** (required for Vercel connection).
   - Note the **Public Endpoint** and **Internal Endpoint**.

3. **Database and Account Setup**
   - Create an initial database named `helpgrow`.
   - Create a privileged account `hg_app`.
   - Note the password and construct the connection string:
     `postgresql://hg_app:<password>@<public-endpoint>:<port>/helpgrow?schema=public&sslmode=require`

4. **Data Migration (DTS)**
   - Use **Alibaba Cloud Data Transmission Service (DTS)** to migrate the existing schema and data from the Google Cloud SQL instance to the new ApsaraDB instance.
   - *Alternatively*, run `npx prisma db push` or `npx prisma migrate deploy` locally against the new `DATABASE_URL` to create an empty schema, then export/import data using `pg_dump`/`pg_restore`.

---

## Phase 2: Compute Migration (Serverless App Engine - SAE)

This phase migrates the `Help-And-Grow` repo from Google Cloud Run to Alibaba Cloud SAE.

1. **Container Registry Setup**
   - In Alibaba Cloud, go to **Container Registry (ACR)**.
   - Create a namespace (e.g., `expert-network`).
   - Create an image repository.

2. **GitHub Actions for SAE Deployment**
   - Add a new GitHub Actions workflow `.github/workflows/deploy-sae.yml` in the `Help-And-Grow` repo.
   - The workflow will:
     - Build the Next.js Docker image.
     - Push the image to Alibaba Cloud ACR.
     - Use the `aliyun-cli` or SAE deployment action to update the SAE application.
   - Add required secrets to the GitHub repository: `ALIYUN_ACCESS_KEY_ID`, `ALIYUN_ACCESS_KEY_SECRET`, `ACR_PASSWORD`.

3. **SAE Application Creation**
   - In the Alibaba Cloud Console, go to **Serverless App Engine**.
   - Create a new application in **Singapore (ap-southeast-1)**.
   - Select **Image** deployment and point it to your ACR repository.
   - Bind it to the same VPC as the RDS instance.
   - Set environment variables (similar to the previous Cloud Run deployment):
     - `DATABASE_URL` (Use the **Internal Endpoint** of the ApsaraDB RDS instance).
     - `AI_PROVIDER_LOCK=gemini`
     - `NEXTAUTH_URL` (Will be updated once SAE provides the public domain).
     - Other necessary secrets (Auth, Stripe, Email).

4. **Expose the SAE Application**
   - Configure an **Internet SLB (Server Load Balancer)** or SAE Web App routing to expose the service to the internet.
   - Map a custom domain if necessary, or use the default provided endpoint.

---

## Phase 3: Production Database Cutover (`jlzxwt8` Repo)

Once the ApsaraDB RDS instance is live and populated with data, cut over the Vercel production deployment.

1. **Update Vercel Environment Variables**
   - Log into Vercel and navigate to the `expert-network` project settings.
   - Update the `DATABASE_URL` to point to the new ApsaraDB RDS **Public Endpoint**.
     `postgresql://hg_app:<password>@<public-endpoint>:<port>/helpgrow?schema=public&sslmode=require`
   - *Note: Ensure the Alibaba RDS IP Whitelist allows Vercel's traffic.*

2. **Redeploy Vercel**
   - Trigger a new deployment on Vercel or run `npx vercel deploy --prod`.
   - Vercel's build process will execute `prisma migrate deploy` against the new Alibaba Cloud database.

3. **Verify and Deprecate**
   - Verify that the production app (`www.help-and-grow.com`) is loading correctly and successfully writing to the database.
   - Verify that the SAE deployment (`Help-And-Grow`) is functioning correctly.
   - Once confirmed, safely shut down and delete the Google Cloud SQL and Google Cloud Run instances to stop incurring charges.

## Rollback Plan

If the cutover fails:
1. Revert the `DATABASE_URL` in Vercel back to the Google Cloud SQL connection string.
2. Redeploy Vercel.
3. Traffic will instantly route back to the original Google Cloud SQL instance.
