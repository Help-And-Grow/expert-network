# Tri-Cloud Architecture & Dynamic Config System

## Overview
To provide global scalability, AI excellence, and optimal performance in the China market (WeChat), Help & Grow is transitioning to a **Tri-Cloud Architecture**.

### 1. Cloud Roles
- **Google Cloud Platform (GCP)**: Primary backend hosting (Cloud Run), AI provider (Gemini/Vertex AI), and storage (GCS) for global assets.
- **Vercel**: Edge-optimized hosting for the web frontend and international users.
- **Tencent Cloud**: Specialized infrastructure for the WeChat Mini Program, providing China-local storage (COS) and low-latency network gateways (TCB).

## Core Systems

### Dynamic Configuration (`SystemConfig`)
The system now uses a database-backed configuration table (`SystemConfig`) to allow runtime switching of providers without redeployment.
- **Table**: `SystemConfig` (key, value, description)
- **Utility**: `src/lib/system-config.ts` (with 60s caching)
- **Admin Panel**: `/admin/system-config` for managing Cloud & AI settings.

### Storage Abstraction (`StorageProvider`)
We have implemented a factory-based storage system that supports multiple drivers.
- **Supported Drivers**:
  - `DatabaseStorageProvider`: (Legacy) Stores files as Base64 in the DB.
  - `VercelBlobProvider`: Fast edge storage for Vercel deployments.
  - `GoogleCloudStorageProvider`: Scalable storage for GCP deployments.
  - `TencentCOSStorageProvider`: Low-latency storage for China-based users (`src/lib/storage/tencent-cos.ts`).
- **Auto-Routing**: The factory inspects request-origin headers stamped by the TCB proxy. WeChat-originated requests route to Tencent COS automatically when configured; everything else uses the `STORAGE_PROVIDER` setting.

### WeChat → GCP Bridge (TCB Proxy)
A Tencent CloudBase HTTP-trigger function (`infra/tcb-proxy/`) terminates inside the WeChat-allowlisted CN domain set and forwards traffic to the Cloud Run origin in `asia-southeast1`. It stamps `x-forwarded-via: tcb-proxy` and `x-forwarded-from: wechat` so the Next.js origin can make region-aware decisions (see `lib/request-origin.ts`).

## AI Integration
Gemini is the primary AI engine, integrated via both AI Studio and Vertex AI (for enterprise/GCP workloads).
- **Grounding**: Native Google Search grounding is enabled for expert profile generation.
- **Model Registry**: Model IDs (Text/Image) are now fetched asynchronously from `SystemConfig` or environment variables, allowing for seamless upgrades (e.g., Gemini 3 Flash -> Pro).

## Remaining Work
1. **Environment Sync**: Standardize `.env` variables across GCP and Vercel for the new config system.
2. **Tencent COS bucket provisioning**: stand up the actual COS bucket + CAM credentials (code is ready; `TENCENT_COS_*` env vars need values).
3. **TCB deployment**: register the function from `infra/tcb-proxy/` against the production CloudBase env and bind the WeChat-allowlisted custom domain.
