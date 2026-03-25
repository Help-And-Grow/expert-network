# Help & Grow — AI Native Expert Network

**Help & Grow** is the **AI Native Expert Network**: connect as **both expert and learner**, book real sessions, and grow with AI-assisted discovery—toward *service as agent* (digital experts that learn from you and facilitate your work). Strong roots in **Singapore & Southeast Asia**.

Canonical brand copy: [`docs/BRAND.md`](docs/BRAND.md).

## Tech Stack

- **Frontend:** Next.js 15 (App Router), TypeScript, Tailwind CSS, shadcn/ui
- **Backend:** Next.js API Routes (serverless), Prisma ORM 7
- **Database:** PostgreSQL (via Supabase or Railway)
- **Auth:** NextAuth.js (magic link + Google OAuth)
- **AI:** Google Gemini API (profile generation + expert matching)
- **Deployment:** Vercel

## Features

### 1. Expert Onboarding (Chat-Oriented)
WhatsApp-style conversational onboarding that collects social profiles, expertise domains, and session preferences through an AI-guided chat interface. Gemini generates personalized bios and service descriptions.

### 2. Expert Discovery
Dual discovery paths — filter-based browsing and AI chatbot matching. Founders can search by domain, session type, and ratings, or describe their challenge to get AI-powered expert recommendations.

### 3. Seamless Free Booking
Calendar-based booking with timezone-aware scheduling, instant confirmation, and post-session review prompts.

## Getting Started

### Prerequisites
- Node.js 20.x (see `package.json` engines)
- PostgreSQL database (local, Supabase, or Railway)

### Setup

1. **Clone and install:**
   ```bash
   cd expert-network
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` with your credentials:
   - `DATABASE_URL` — PostgreSQL connection string
   - `NEXTAUTH_SECRET` — Generate with `openssl rand -base64 32`
   - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — From Google Cloud Console
   - `EMAIL_SERVER_*` — SMTP credentials for magic link emails
   - `GEMINI_API_KEY` — From Google AI Studio

3. **Set up database:**
   ```bash
   npx prisma migrate dev --name init
   ```

4. **Run development server:**
   ```bash
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000)

## Project Structure

```
src/
├── app/
│   ├── api/                  # API routes
│   │   ├── auth/             # NextAuth endpoints
│   │   ├── bookings/         # Booking CRUD
│   │   ├── experts/          # Expert listing, matching, slots
│   │   ├── onboarding/       # Expert onboarding flow
│   │   ├── reviews/          # Review CRUD
│   │   └── user/             # User profile
│   ├── auth/                 # Auth pages (signin, verify, error)
│   ├── bookings/             # Booking success page
│   ├── dashboard/            # User dashboard
│   ├── discover/             # Expert discovery + AI matching
│   ├── experts/[id]/         # Expert profile + booking
│   ├── onboarding/           # Expert onboarding chat
│   └── reviews/              # Post-session review
├── components/
│   ├── providers.tsx          # Session provider
│   └── ui/                   # shadcn/ui components
├── generated/prisma/         # Prisma generated client
├── lib/
│   ├── auth.ts               # NextAuth configuration
│   ├── constants.ts           # Domain lists, social platforms
│   ├── gemini.ts             # Gemini AI integration
│   ├── prisma.ts             # Prisma client singleton
│   └── utils.ts              # Utility functions
└── types/
    └── next-auth.d.ts        # NextAuth type augmentation
```

## Deployment

Deploy to Vercel:

```bash
npm i -g vercel
vercel
```

Set all environment variables in the Vercel dashboard.
