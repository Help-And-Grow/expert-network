#!/usr/bin/env node
/**
 * Generate cloudbaserc.json inside the SCF bundle directory, populated with
 * runtime env vars sourced from infra/tencent-cn/.env.cn.
 *
 * Usage: write-cloudbaserc.mjs --bundle <dir> --env <env-file>
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || i === process.argv.length - 1) {
    throw new Error(`Missing --${name}`);
  }
  return process.argv[i + 1];
}

const bundle = resolve(arg("bundle"));
const envFile = resolve(arg("env"));

const env = {};
for (const line of readFileSync(envFile, "utf8").split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const i = trimmed.indexOf("=");
  if (i === -1) continue;
  env[trimmed.slice(0, i)] = trimmed.slice(i + 1);
}

const required = [
  "DATABASE_URL_CN",
  "TENCENT_CN_ENV_ID",
  "TENCENT_CN_FN_NAME",
  "TENCENT_COS_SECRET_ID",
  "TENCENT_COS_SECRET_KEY",
  "TENCENT_CN_COS_BUCKET",
  "HUNYUAN_API_KEY",
  "NEXTAUTH_SECRET",
  "WECHAT_APP_ID",
  "WECHAT_APP_SECRET",
];
for (const k of required) {
  if (!env[k]) {
    console.error(`✖ ${k} is empty in ${envFile}`);
    process.exit(1);
  }
}

const runtimeEnv = {
  DATABASE_URL: env.DATABASE_URL_CN,
  STORAGE_PROVIDER: "tencent-cos",
  TENCENT_COS_SECRET_ID: env.TENCENT_COS_SECRET_ID,
  TENCENT_COS_SECRET_KEY: env.TENCENT_COS_SECRET_KEY,
  TENCENT_COS_BUCKET: env.TENCENT_CN_COS_BUCKET,
  TENCENT_COS_REGION: env.TENCENT_CN_COS_REGION || "ap-shanghai",
  AI_PROVIDER: "hunyuan",
  HUNYUAN_API_KEY: env.HUNYUAN_API_KEY,
  IS_WECHAT: "true",
  PROXY_REGION: env.WECHAT_STACK_REGION || "intl",
  WECHAT_APP_ID: env.WECHAT_APP_ID,
  WECHAT_APP_SECRET: env.WECHAT_APP_SECRET,
  NEXTAUTH_SECRET: env.NEXTAUTH_SECRET,
};

const cfg = {
  $schema: "https://static.cloudbase.net/cli/cloudbaserc.schema.json",
  envId: env.TENCENT_CN_ENV_ID,
  functionRoot: ".",
  functions: [
    {
      name: env.TENCENT_CN_FN_NAME,
      handler: "scf_bootstrap",
      // Next.js 15.5 requires Node >=18.18; CloudBase's Node 18 runtime is
      // 18.15, so use the supported Node 20 runtime instead.
      runtime: "Nodejs20.19",
      // First cold start runs `prisma migrate deploy` before the server
      // starts, which can take 10–20s on a fresh DB. 120s leaves headroom;
      // subsequent cold starts hit a no-op migrate so the budget is unused.
      timeout: 120,
      memorySize: 512,
      description: "WeChat CN Next.js app",
      // IMPORTANT: standalone bundle already contains all node_modules.
      // Setting installDependency=false prevents TCB from running `npm install`
      // inside the deployed code, which would fail and cause "Creation failed".
      installDependency: false,
      envVariables: runtimeEnv,
    },
  ],
};

writeFileSync(resolve(bundle, "cloudbaserc.json"), JSON.stringify(cfg, null, 2));
console.log(`▶ Wrote ${bundle}/cloudbaserc.json with runtime env`);
