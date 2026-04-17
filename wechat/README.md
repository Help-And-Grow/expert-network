# WeChat Mini Program (Help & Grow)

## Why you don’t see errors in Vercel logs

Mini Program code runs **on the user’s phone** (or the WeChat DevTools simulator). Only **HTTP requests to your server** show up in Vercel. `console.log` in the Mini Program appears in:

- **WeChat DevTools** → **Console** / **Network** (not Vercel).

### Debug checklist

1. **DevTools**  
   Open the project → Preview with DevTools → **Network** tab: confirm `request` / `uploadFile` / `downloadFile` to `expert-network.vercel.app` return **200**.

2. **Request 合法域名**  
   [微信公众平台](https://mp.weixin.qq.com/) → 开发 → 开发管理 → 服务器域名 → **request 合法域名** must include your API host (e.g. `https://expert-network.vercel.app`).

3. **downloadFile 合法域名** (voice intro, TTS fallback)  
   Same page → **downloadFile 合法域名** — add the **same** host. Without this, `AudioPlayer` and `downloadFile` for audio will fail.

4. **uploadFile 合法域名**  
   Required for voice messages to `/api/voice-chat/message`.

5. **Forward logs to Vercel (optional)**  
   - Vercel: set `WECHAT_CLIENT_LOG=1` on the project.  
   - Local `wechat/.env.production`: add `TARO_APP_CLIENT_LOG=1`.  
   - Call `logToVercel()` from `wechat/src/shared/debug-log.ts` where needed (already wired from voice/chat errors).  
   - Then check **Vercel → Deployment → Functions → Logs**.

## Audio (voice intro & voice chat)

- WeChat **does not reliably play `data:audio/...;base64,...`** in `InnerAudioContext`.  
- TTS replies are written to a **temp file** under `USER_DATA_PATH` before play (`wechat/src/shared/wechat-audio.ts`).  
- Async voice chat uses **Gemini** for transcription / reply / preferred TTS; if audio is unavailable, the expert reply still shows as text instead of hard-failing.  
- Voice intro uses `downloadFile` + local file; if download fails, check **downloadFile** domain whitelist.

## Env

| Variable | Purpose |
|----------|---------|
| `TARO_APP_API_BASE` | API origin, e.g. `https://expert-network.vercel.app` |
| `TARO_APP_CLIENT_LOG` | `1` to POST debug lines to `/api/debug/wechat-client-log` |
