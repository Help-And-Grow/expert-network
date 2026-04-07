const { createRequire } = require("module");
const fs = require("fs");
const path = require("path");

// miniprogram-ci breaks on Node 23+ (TypeError: r.getItem is not a function). Use Node 20 LTS:
//   cd wechat && nvm use
//   cd .. && node scripts/wechat-upload.js "1.0.0" "release notes"
const nodeMajor = parseInt(process.versions.node.split(".")[0], 10);
if (nodeMajor > 22) {
  console.error(
    `WeChat upload requires Node.js 18–22 (you have ${process.version}).\n` +
      `Use Node 20 for this script, for example:\n` +
      `  Homebrew:  brew install node@20\n` +
      `             export PATH="$(brew --prefix node@20)/bin:$PATH"\n` +
      `  nvm:       install https://github.com/nvm-sh/nvm then  cd wechat && nvm use\n` +
      `Then from repo root:  node scripts/wechat-upload.js "1.0.0" "description"\n`,
  );
  process.exit(1);
}

const requireWechat = createRequire(
  path.join(__dirname, "../wechat/package.json"),
);
const ci = requireWechat("miniprogram-ci");

const APPID = "wx09d0eb079596060d";
const PROJECT_PATH = path.resolve(__dirname, "../wechat/dist");
const KEY_NAME = "private.wx09d0eb079596060d.key";
const PRIVATE_KEY_PATH =
  process.env.WECHAT_CI_KEY_PATH ||
  (() => {
    const inWechat = path.resolve(__dirname, "../wechat", KEY_NAME);
    const inRoot = path.resolve(__dirname, "..", KEY_NAME);
    if (fs.existsSync(inWechat)) return inWechat;
    if (fs.existsSync(inRoot)) return inRoot;
    return inRoot;
  })();

const VERSION = process.argv[2] || "1.0.0";
const DESC = process.argv[3] || `Help & Grow v${VERSION}`;

async function upload() {
  const project = new ci.Project({
    appid: APPID,
    type: "miniProgram",
    projectPath: PROJECT_PATH,
    privateKeyPath: PRIVATE_KEY_PATH,
    ignores: ["node_modules/**/*"],
  });

  console.log(`Uploading WeChat Mini Program...`);
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
