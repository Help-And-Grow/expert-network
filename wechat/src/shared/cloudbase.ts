import Taro from "@tarojs/taro";

let initialized = false;

export function initCloudBase() {
  if (initialized) return;

  const envId = process.env.TARO_APP_CLOUDBASE_ENV_ID || "";
  if (!envId) return;

  const cloud = Taro.cloud;
  if (!cloud?.init) {
    console.warn("[cloudbase] Taro.cloud is not available in this runtime");
    return;
  }

  try {
    cloud.init({
      env: envId,
      traceUser: process.env.TARO_APP_CLOUDBASE_TRACE_USER === "true",
    });
    initialized = true;
    console.info(`[cloudbase] initialized env=${envId}`);
  } catch (err) {
    console.warn("[cloudbase] init failed:", err);
  }
}
