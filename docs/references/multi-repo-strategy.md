# Multi-Repo & Multi-Tenant Deployment Strategy

This document outlines the architectural plan and operational guidelines for managing the Help & Grow platform across multiple GitHub repositories and multi-tenant Vercel deployments.

## 1. Dual Repository Strategy

To balance rapid, experimental development with stable, open-source presentations (for hackathons, investors, and partners), the codebase is split into two synchronized repositories:

### A. The Origin Repository (`jlzxwt8/expert-network`)
- **Visibility:** Private
- **Purpose:** 
  - Core R&D environment.
  - Testing bleeding-edge multi-agent frameworks (OpenClaw, HiClaw, Scion, BytePlus Coze).
  - Storing experimental prompts, proprietary AI logic, and sensitive integration keys.
- **Iteration Cycle:** High frequency, experimental branches, rapid prototyping.

### B. The Showcase Repository (`Help-And-Grow/expert-network`)
- **Visibility:** Public
- **Purpose:** 
  - Stable, open-source reference for the community.
  - Clean, sanitized codebase for hackathons, investor demos, and partner showcases.
- **Iteration Cycle:** Periodically synced from the Origin repository when features reach a stable, demo-ready state. Sensitive hardcoded keys and purely experimental logic must be stripped before pushing.

---

## 2. Multi-Tenant Vercel Architecture

Instead of duplicating code, the Showcase repository powers multiple distinct cloud-provider environments using a single codebase.

We have established three dedicated Vercel projects:
1. **`expert-network-alibabacloud`**: Uses the DashScope/Qwen provider (`AI_PROVIDER="qwen"`).
2. **`expert-network-googlecloud`**: Uses the Vertex AI/Gemini provider (`AI_PROVIDER="gemini"`).
3. **`expert-network-byteplus`**: Uses the ModelArk/Doubao provider (`AI_PROVIDER="byteplus"`).

### How it works:
All three Vercel projects are linked to the **same** GitHub repository branch (`Help-And-Grow/expert-network:main`). The codebase dynamically adapts its behavior based on the Vercel Environment Variables injected at runtime.

---

## 3. Operational Guidelines (Long-Term Self-Iteration)

To maintain this system long-term without configuration drift, follow these operational workflows:

### Syncing Code (Private -> Public)
When a feature in the private repository is ready for public showcase:
1. Ensure no sensitive keys (API keys, DB credentials) are hardcoded.
2. Push the changes to the public repository:
   ```bash
   git push origin main      # Pushes to private R&D repo
   git push hackathon main   # Pushes to public showcase repo
   ```
3. Vercel will automatically detect the push to the `hackathon` remote and trigger parallel builds across all three cloud provider projects.

### Managing Multi-Tenant Environment Variables
Managing separate environment variables for 3 projects can be tedious. We built the `scripts/vercel-merge-env.mjs` utility to safely propagate shared core settings (like Database URLs, Auth Secrets) while preserving provider-specific keys.

**Workflow to update environments:**
```bash
# 1. Pull the master configuration from your private origin project
npx vercel env pull /tmp/vercel-origin-production.env --project expert-network --environment production

# 2. Pull the target project's current configuration
npx vercel env pull /tmp/vercel-alibabacloud-production.env --project expert-network-alibabacloud --environment production

# 3. Merge them intelligently using our script
npm run vercel:env:alibabacloud

# 4. Apply the merged configuration back to Vercel
npx vercel env push .env.vercel.alibabacloud.sync --project expert-network-alibabacloud --environment production
```

This strategy ensures your product remains highly agile in private while maintaining a robust, multi-cloud presence publicly.