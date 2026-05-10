# CLI Setup — Tri-Cloud Dev Environment (macOS)

One-time install + authentication for the three cloud CLIs the project uses:

| CLI | Provider | Used for |
|-----|----------|----------|
| `gcloud` | Google Cloud | Vertex AI (Gemini), Cloud Run, GCS |
| `tcb` | Tencent CloudBase | TCB proxy, SCF functions, COS (WeChat MP path) |
| `aliyun` | Alibaba Cloud | Reserved for future Aliyun-hosted services |

This runbook is macOS-only (Apple Silicon + Intel both work). Reuse it whenever you set up a new development laptop.

---

## 1. Prerequisites

Confirm Homebrew is installed (or install it):

```bash
brew --version || /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Confirm Node.js + npm are installed (already required for this repo). If `node --version` reports anything older than 20, upgrade via `brew install node` or `nvm install 20`.

---

## 2. Install the CLIs

Run each command, then restart your shell.

### 2.1 Google Cloud CLI

```bash
brew install --cask google-cloud-sdk
```

### 2.2 Tencent CloudBase CLI

Distributed via npm (official channel):

```bash
npm install -g @cloudbase/cli
```

### 2.3 Alibaba Cloud CLI

```bash
brew install aliyun-cli
```

### 2.4 Reload PATH and verify

```bash
exec zsh

gcloud --version
tcb --version
aliyun --version
```

Each command should print a version string. If any fail with `command not found`, restart the terminal application (not just the tab) and retry.

---

## 3. Authenticate Google Cloud

Required to reach Vertex AI (the production AI provider for this project).

### 3.1 Sign in and pick a project

```bash
gcloud init
```

The interactive prompt will:
1. Open a browser for Google SSO.
2. Ask you to pick (or create) a project.
3. Set a default region — `us-central1` is the safest pick because it has every Gemini preview model.

If you'd rather break it apart:

```bash
gcloud auth login                       # user credentials for `gcloud` commands
gcloud auth application-default login   # ADC for client libraries (NOT used by Vercel — see §3.2)
gcloud projects list                    # find your project id
gcloud config set project <PROJECT_ID>
```

### 3.2 Confirm the active project

```bash
gcloud config get-value project
```

Send this output back to the project owner — they'll provide the next block (enable Vertex AI API → create service account → grant role → generate JSON key → base64-encode → set Vercel env vars).

---

## 4. Authenticate Tencent CloudBase

Only needed when you're about to deploy or modify the TCB proxy / SCF functions. Skip until then.

```bash
tcb login         # opens a browser for WeChat / QQ / phone-number SSO
tcb env list      # lists the envIds you have access to (CN + Intl)
```

The CN env id is what `infra/tcb-proxy/cloudbaserc.cn.json` targets; the Intl env id goes in `cloudbaserc.intl.json`. See [`docs/exec-plans/active/tencent-cloud-rollout.md`](exec-plans/active/tencent-cloud-rollout.md) for the deploy sequence.

---

## 5. Authenticate Alibaba Cloud

Reserved for future use. Skip until there's actual Aliyun work in the plan.

```bash
aliyun configure
```

The prompt asks for:
- **Access Key ID** + **Access Key Secret** — generate from https://ram.console.aliyun.com/users (use a sub-user, not the root account)
- **Region** — `cn-hongkong` is the usual default for SEA-facing services
- **Language** — `en` or `zh`

---

## 6. Troubleshooting

### `gcloud: command not found` after install

`brew install --cask google-cloud-sdk` writes to `/opt/homebrew/Caskroom/google-cloud-sdk/...` and adds the PATH update to a brew-managed shell init. If `exec zsh` doesn't pick it up, source it manually:

```bash
source "$(brew --prefix)/share/google-cloud-sdk/path.zsh.inc"
source "$(brew --prefix)/share/google-cloud-sdk/completion.zsh.inc"
```

Add those two lines to `~/.zshrc` if you want persistence.

### `tcb: command not found`

Confirm the global npm prefix is on PATH:

```bash
npm config get prefix     # usually /opt/homebrew or ~/.npm-global
echo $PATH | tr ':' '\n' | grep -i npm
```

If missing, append `$(npm config get prefix)/bin` to `~/.zshrc`.

### `aliyun configure` rejects credentials

Most often the root account's AK is blocked by a security policy. Create a sub-user under RAM, attach `AliyunVertexAIFullAccess` (or whatever scoped policy you need), and use that sub-user's keys.

---

## 7. Security checklist before you walk away

- Never paste service-account JSON or AK/SK into chat threads, commits, or screenshots.
- Service-account JSON keys live only on disk under `~/.config/gcloud/` (managed by `gcloud`) or in your password manager.
- Vercel env vars are the canonical place for production credentials — set them via `vercel env add` so they live in Vercel's encrypted store and never on a developer laptop.
- Rotate any key that has been exposed. For the database password, use `gcloud sql users set-password hg_app --instance=hg-postgres-prod --password='<new>' --project=expert-network-489508`. For service-account keys, `gcloud iam service-accounts keys delete <KEY_ID>`.
