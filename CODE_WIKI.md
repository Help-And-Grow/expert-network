# Help & Grow - Code Wiki

Welcome to the Code Wiki for **Help & Grow**, an AI Native Expert Network. This document provides a structured, comprehensive overview of the project's architecture, major modules, key functions, dependency relationships, and instructions for running the system locally and in production.

---

## 1. Overall Project Architecture

Help & Grow operates as a multi-platform product serving web browsers, a Telegram Mini App, and a WeChat Mini Program. All platforms communicate with a unified Next.js API layer hosted on Vercel.

### System Diagram

```text
┌─────────────┐  ┌─────────────────┐  ┌──────────────────┐
│ Web Browser │  │ Telegram MiniApp│  │ WeChat MiniProg  │
│ (Next.js SSR)│ │ (React SPA)     │  │ (Taro + React)   │
└──────┬───────┘ └───────┬─────────┘  └───────┬──────────┘
       │                 │                    │
       └─────────────────┼────────────────────┘
                         │
               ┌─────────▼──────────┐
               │  Next.js API Layer │  (Vercel Serverless)
               │  /api/*            │
               └──┬──────┬──────┬───┘
                  │      │      │
          ┌──────────┐ ┌───▼───┐ ┌▼──────────────┐
          │ Prisma + │ │Stripe │ │AI Providers   │
          │ Postgres │ │(Pay)  │ │(Qwen/Gemini/  │
          │ +pgvector│ │Connect│ │ OpenAI/Ollama)│
          └──────────┘ └───────┘ └───────────────┘
```

### Sidecar Architecture: HiClaw
Beyond the Vercel API, there is an offline expert service called **HiClaw** (`hiclaw/service/`). It acts as an asynchronous agent loop (shadow worker, evaluator, waiting room) that uses local Postgres (`HICLAW_POSTGRES_URL`) and Local LLMs (Ollama) to manage expert memories and session handoffs.

---

## 2. Responsibilities of Major Modules

The application is structured into domain-specific modules. Below are the core domains:

| Module / Domain | Location | Responsibility |
| --- | --- | --- |
| **Auth** | `src/auth.ts`, `src/lib/request-auth.ts` | Multi-platform authentication (Auth.js / NextAuth v5, Telegram init data, WeChat openId). |
| **Experts** | `src/app/api/experts/` | Expert profile management, domain mapping, pricing, and schedules. |
| **Meetups** (`Booking`) | `src/app/api/bookings/` | Meetup scheduling (product copy), timezone handling, conflict detection. |
| **Payments** | `src/lib/stripe.ts` | Processing via Stripe Connect, TON crypto, and WeChat Pay. Webhooks handle post-payment logic. |
| **AI Matching & Chat** | `src/lib/ai/` | Expert matching, profile generation, chat via multiple AI providers (Qwen, Gemini, OpenAI, Ollama). |
| **Memory** | `src/lib/integrations/` | Persistent expert context management via `mem9` and/or `pgvector`. |
| **On-chain & Tokens**| `src/lib/hg-token.ts`, `contracts/` | Issues Help & Grow ERC-20 tokens and registers POMP (Proof of Meet Protocol) via EAS attestations on Base. |
| **WeChat Client** | `wechat/` | Taro 4.x React project for the WeChat Mini Program interface. |

---

## 3. Dependency Relationships

The system follows a strict downward-flowing layer architecture within domains.

### Internal Dependency Flow

```text
Types (Prisma models, Zod schemas)
    ↓
Config (Env vars, constants)
    ↓
Repository (Prisma queries in src/lib/)
    ↓
Service (Business logic, agnostic of framework)
    ↓
API Route (HTTP handlers in src/app/api/)
    ↓
UI (React components in src/app/, src/components/)
```
**Rules:**
- UI components may call API routes via fetch/tRPC, but **never** import directly from the Service or Repository layers.
- API Routes validate inputs (e.g., using Zod) and delegate to the Service layer.

### Core Tech Stack Dependencies
- **Frontend / Framework:** [Next.js](https://nextjs.org/) 15 (App Router), React 18, TailwindCSS, shadcn/ui (Radix UI).
- **Database / ORM:** [Prisma](https://www.prisma.io/) 7 with `@prisma/adapter-pg`. Requires PostgreSQL.
- **State & Fetching:** Zustand, TanStack React Query, tRPC.
- **Web3 / Crypto:** `viem`, `wagmi`, `@ethereum-attestation-service/eas-sdk`, TON SDKs.
- **AI & Realtime:** OpenAI SDK, Google GenAI, Agora RTC SDK (`agora-rtc-sdk-ng`).

---

## 4. Key Classes and Functions

### Authentication
- [resolveUserId](file:///Users/qiumiao/Desktop/expert-network/src/lib/request-auth.ts): The unified auth resolver. It checks `x-wechat-token` (WeChat), `x-telegram-init-data` (Telegram), or Auth.js session cookies to identify the user making an API request.

### AI Engine
- **`AIProvider` Factory** ([src/lib/ai/index.ts](file:///Users/qiumiao/Desktop/expert-network/src/lib/ai/index.ts)): Reads the `AI_PROVIDER` environment variable and returns the specific implementation class (e.g., `GeminiProvider`, `QwenProvider`, `OllamaProvider`).

### Memory & State
- **`storeBookingEvent()` & `storeReviewEvent()`** ([src/lib/integrations/mem9-lifecycle.ts](file:///Users/qiumiao/Desktop/expert-network/src/lib/integrations/mem9-lifecycle.ts)): Fire-and-forget hooks that accumulate **meetup** and **appreciation** context into the expert's memory backend.
- **`searchExpertMemories()`**: Queries `pgvector` or `mem9` to inject historical context into AI matching prompts.

### On-chain / Smart Contracts
- **`pomp-credential.ts`**: Handles logic to create EAS (Ethereum Attestation Service) attestations whenever a **meetup** (`Booking`) is completed.
- **`redeemDiscount()`**: A Solidity function within `contracts/src/HelpGrowToken.sol` that burns H&G tokens on the Base network to apply session discounts.

---

## 5. Running the Project

The application offers both local containerized execution (preferred for development parity) and standard Node-based execution.

### Prerequisites
- Node.js (v20.x recommended)
- Docker Desktop (for running the local stack)
- PostgreSQL (if not using Docker)

### 1. Local Full-Stack (Recommended)
You can spin up the entire backend stack (Postgres + pgvector + Ollama + Next.js + HiClaw) using Docker Compose:
```bash
# Start all local services
npm run local:up

# View logs for the Next.js app and HiClaw sidecar
npm run local:logs

# Pull necessary local models into Ollama
npm run local:models
```

### 2. Standard Development Mode
If you want to run the Next.js dev server on your host machine against a remote database (e.g., Supabase):

1. Copy `.env.example` to `.env` and fill in the required `DATABASE_URL` (must be `postgresql://`).
2. Install dependencies and ensure the database provider is set properly:
   ```bash
   npm install
   ```
3. Generate the Prisma client and push the schema:
   ```bash
   npm run db:push
   npm run typecheck
   ```
4. Start the development server:
   ```bash
   npm run dev
   # Server runs on http://0.0.0.0:5000 by default
   ```

### 3. Running UI Smoke Tests
Ensure Playwright is installed, then run the test suite:
```bash
# Install playwright dependencies
npm run test:ui:install

# Run tests
npm run test:ui
```

### 4. WeChat Mini Program Development
The WeChat project is built using Taro and is located in the `wechat/` directory.
```bash
# Build the WeChat Mini Program
npm run wechat:build

# Upload to WeChat CI (requires proper CI keys)
npm run wechat:upload
```