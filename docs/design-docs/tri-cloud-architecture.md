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
  - `TencentCOSProvider`: (Planned) Low-latency storage for China-based users.
- **Auto-Routing**: The system can dynamically route uploads based on the active `STORAGE_PROVIDER` setting.

## AI Integration
Gemini is the primary AI engine, integrated via both AI Studio and Vertex AI (for enterprise/GCP workloads).
- **Grounding**: Native Google Search grounding is enabled for expert profile generation.
- **Model Registry**: Model IDs (Text/Image) are now fetched asynchronously from `SystemConfig` or environment variables, allowing for seamless upgrades (e.g., Gemini 3 Flash -> Pro).

## Remaining Work
1. **Tencent COS Driver**: Implement `src/lib/storage/drivers/tencent-cos.ts`.
2. **WeChat Proxy Gateway**: Deploy a Tencent Cloud Base (TCB) function to bridge WeChat traffic to GCP Asia-Southeast1.
3. **Regional Storage Switching**: Logic to automatically select COS for WeChat-originating media uploads.
4. **Environment Sync**: Standardize `.env` variables across GCP and Vercel for the new config system.
