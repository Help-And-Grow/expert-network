# Core Beliefs

These are the operating principles that guide development decisions in this project.

## 1. Repository is the Single Source of Truth

All knowledge — architecture decisions, product specs, coding conventions, and plans — must live in the repository as versioned artifacts. Information in chat threads, emails, or people's heads is effectively invisible to both new engineers and AI agents.

## 2. Progressive Disclosure Over Monolithic Docs

Short entry points (like AGENTS.md) link to deeper docs. Agents and humans should be able to navigate from high-level to detailed context without being overwhelmed.

## 3. Parse at Boundaries, Trust Internally

Validate and parse all external inputs (API request bodies, webhook payloads, environment variables) at the boundary. Internal function calls between trusted layers can assume correct types.

## 4. Prefer Boring Technology

Choose well-documented, stable, widely-adopted technologies. They have better training data coverage for AI agents, more predictable behavior, and lower maintenance burden.

## 5. Mechanical Enforcement Over Documentation

When a rule matters, encode it in tooling (linters, type checks, CI). Documentation alone drifts; code-enforced rules apply everywhere automatically.

## 6. Double-Write for Critical Paths

Payment and meetup (`Booking`) creation use redundant paths (webhook + verify endpoint). For any business-critical operation, assume one path will fail and provide a fallback.

## 7. Fire-and-Forget for Non-Critical Side Effects

Notifications, analytics, and memory storage should never block the primary response. Use `.catch(() => {})` to isolate failures.

## 8. Multi-Platform from Day One

Every API route must support all three client surfaces (Web, Telegram, WeChat) through unified `resolveUserId()` auth. Never add platform-specific checks that exclude other platforms.
