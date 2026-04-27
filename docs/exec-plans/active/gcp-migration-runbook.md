# Runbook: Google Cloud Platform (GCP) Migration

This document outlines the steps to deploy the **Help & Grow** Expert Network to Google Cloud using Cloud Run and Cloud SQL.

## Prerequisites
- Google Cloud SDK (`gcloud`) installed and authenticated.
- A GCP project with Billing enabled.
- `PROJECT_ID` environment variable set.

## 1. Containerize the Application
We use a multi-stage Dockerfile that leverages Next.js `standalone` output for minimal image size.

```bash
# Build the image locally (for testing)
docker build -t expert-network .

# Run locally to verify
docker run -p 3000:3000 expert-network
```

## 2. Deploy to Artifact Registry
1. Create a repository in Artifact Registry:
   ```bash
   gcloud artifacts repositories create expert-network-repo \
     --repository-format=docker --location=asia-southeast1
   ```
2. Tag and push the image:
   ```bash
   docker tag expert-network asia-southeast1-docker.pkg.dev/$PROJECT_ID/expert-network-repo/app
   docker push asia-southeast1-docker.pkg.dev/$PROJECT_ID/expert-network-repo/app
   ```

## 3. Database Migration (Cloud SQL)
1. Create a Cloud SQL (Postgres) instance.
2. Enable the Cloud SQL Auth Proxy or use Private IP.
3. Update `DATABASE_URL` to point to the Cloud SQL instance.
   *Format: `postgresql://user:pass@localhost:5432/dbname?host=/cloudsql/PROJECT_ID:REGION:INSTANCE_NAME`*

## 4. Deploy to Cloud Run
Deploy the container to Cloud Run, passing the necessary environment variables.

```bash
gcloud run deploy expert-network \
  --image asia-southeast1-docker.pkg.dev/$PROJECT_ID/expert-network-repo/app \
  --region asia-southeast1 \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars="DATABASE_URL=...,GEMINI_API_KEY=...,AI_PROVIDER=gemini"
```

> [!NOTE]
> Since we implemented **Database-driven configuration**, you can switch AI providers after deployment via the `/admin/ai-provider` page without redeploying the Cloud Run service.

## 5. Secret Management
Use **Google Cloud Secret Manager** to store sensitive keys like `GEMINI_API_KEY`, `STRIPE_SECRET_KEY`, and `DATABASE_URL`. Mount them as environment variables in the Cloud Run configuration.

---
**Status:** Ready for initial deployment.
