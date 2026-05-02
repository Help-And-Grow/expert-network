const { createRequire } = require("module");
const fs = require("fs");
const path = require("path");

// miniprogram-ci breaks on Node 23+ (TypeError: r.getItem is not a function). Use Node 20 LTS:
//   cd wechat && nvm use
//   cd .. && WECHAT_REGION=intl node scripts/wechat-upload.js "1.0.0" "release notes"
const nodeMajor = parseInt(process.versions.node.split(".")[0], 10);
if (nodeMajor > 22) {
  console.error(
    `WeChat upload requires Node.js 18–22 (you have ${process.version}).\n` +
      `Use Node 20 for this script, for example:\n` +
      `  Homebrew:  brew install node@20\n` +
      `             export PATH="$(brew --prefix node@20)/bin:$PATH"\n` +
      `  nvm:       install https://github.com/nvm-sh/nvm then  cd wechat && nvm use\n` +
      `Then from repo root:  WECHAT_REGION=intl node scripts/wechat-upload.js "1.0.0" "description"\n`,
  );
  process.exit(1);
}

const requireWechat = createRequire(
  path.join(__dirname, "../wechat/package.json"),
);
const ci = requireWechat("miniprogram-ci");

function parseArgs(argv) {
  const flags = {};
  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--region" || arg === "--appid" || arg === "--project-path") {
      flags[arg.slice(2)] = argv[i + 1];
      i += 1;
    } else if (arg.startsWith("--region=")) {
      flags.region = arg.slice("--region=".length);
    } else if (arg.startsWith("--appid=")) {
      flags.appid = arg.slice("--appid=".length);
    } else if (arg.startsWith("--project-path=")) {
      flags["project-path"] = arg.slice("--project-path=".length);
    } else {
      positional.push(arg);
    }
  }

  return { flags, positional };
}

function loadBuildConfig(region) {
  const configPath = path.resolve(__dirname, "../wechat/build-config", `${region}.json`);
  if (!fs.existsSync(configPath)) {
    throw new Error(`Unknown WeChat region "${region}" (${configPath} not found)`);
  }
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

const { flags, positional } = parseArgs(process.argv.slice(2));
const REGION = flags.region || process.env.WECHAT_REGION || "intl";
const buildConfig = loadBuildConfig(REGION);
const APPID =
  flags.appid ||
  process.env.WECHAT_APPID ||
  buildConfig.TARO_APP_APPID ||
  "wx09d0eb079596060d";
const PROJECT_PATH =
  flags["project-path"] ||
  process.env.WECHAT_PROJECT_PATH ||
  path.resolve(__dirname, "../wechat", `dist-${REGION}`);
const KEY_NAME = `private.${APPID}.key`;
const PRIVATE_KEY_PATH =
  process.env.WECHAT_CI_KEY_PATH ||
  (() => {
    const inWechat = path.resolve(__dirname, "../wechat", KEY_NAME);
    const inRoot = path.resolve(__dirname, "..", KEY_NAME);
    if (fs.existsSync(inWechat)) return inWechat;
    if (fs.existsSync(inRoot)) return inRoot;
    return inRoot;
  })();

const VERSION = positional[0] || "1.0.0";
const DESC = positional[1] || `Help & Grow v${VERSION}`;

if (!APPID || APPID.startsWith("PENDING_")) {
  console.error(`Invalid WeChat AppID for region ${REGION}: ${APPID || "(empty)"}`);
  process.exit(1);
}

if (!fs.existsSync(PROJECT_PATH)) {
  console.error(`Build output missing: ${PROJECT_PATH}`);
  console.error(`Run: cd wechat && npm run build:weapp:${REGION}`);
  process.exit(1);
}

async function upload() {
  const project = new ci.Project({
    appid: APPID,
    type: "miniProgram",
    projectPath: PROJECT_PATH,
    privateKeyPath: PRIVATE_KEY_PATH,
    ignores: ["node_modules/**/*"],
  });

  console.log(`Uploading WeChat Mini Program...`);
  console.log(`  Region: ${REGION}`);
  console.log(`  AppId: ${APPID}`);
  console.log(`  Version: ${VERSION}`);
  console.log(`  Desc: ${DESC}`);
  console.log(`  Project path: ${PROJECT_PATH}`);
  console.log(`  Key path: ${PRIVATE_KEY_PATH}`);

  try {
    const result = await ci.upload({
      project,
      version: VERSION,
      desc: DESC,
      setting: {
        es6: true,
        es7: true,
        minifyJS: true,
        minifyWXML: true,
        minifyWXSS: true,
        autoPrefixWXSS: true,
      },
      onProgressUpdate: console.log,
    });
    console.log("\nUpload successful!");
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("\nUpload failed:", err.message || err);
    process.exit(1);
  }
}

upload();
