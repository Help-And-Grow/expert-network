const ci = require("miniprogram-ci");
const path = require("path");

const APPID = "wx09d0eb079596060d";
const PROJECT_PATH = path.resolve(__dirname, "../wechat/dist");
const PRIVATE_KEY_PATH =
  process.env.WECHAT_CI_KEY_PATH ||
  path.resolve(__dirname, "../private.wx09d0eb079596060d.key");

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
