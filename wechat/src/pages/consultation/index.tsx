/**
 * Premium live consultation — WeChat Mini Program client.
 *
 * WeChat Mini Programs ship `<live-pusher mode="RTC">` and `<live-player
 * mode="RTC">` natively, both of which speak Tencent TRTC's `room://`
 * protocol. We construct push/play URLs from the credentials issued by
 * `/api/trtc/token` and let the native components handle the WebRTC layer.
 *
 * Backend contract: same as the web client — POST /api/trtc/token with
 * { bookingId } returns sdkAppId, roomId, userId, userSig, expiresAt,
 * participantRole, premiumLiveTokenCost.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import Taro, { useRouter } from "@tarojs/taro";
import { Button, LivePlayer, LivePusher, Text, View } from "@tarojs/components";

import "./index.scss";

import { request } from "../../shared/api";

type TokenResponse = {
  sdkAppId: number;
  roomId: number;
  userId: string;
  userSig: string;
  expiresInSeconds: number;
  expiresAt: string;
  participantRole: "founder" | "expert";
  premiumLiveTokenCost: number;
};

type RoomState = "loading" | "ready" | "in-room" | "error";

/**
 * Build the TRTC `room://` URL the WeChat <live-pusher> / <live-player>
 * components consume. Spec:
 *   room://cloud.tencent.com/rtc?sdkappid=...&roomid=...&userid=...&usersig=...&appscene=videocall
 */
function buildTrtcUrl(token: TokenResponse): string {
  const params = new URLSearchParams({
    sdkappid: String(token.sdkAppId),
    roomid: String(token.roomId),
    userid: token.userId,
    usersig: token.userSig,
    appscene: "videocall",
  });
  return `room://cloud.tencent.com/rtc?${params.toString()}`;
}

/**
 * Encode a remote participant id into a play URL. Same scheme as pusher,
 * with `streamtype=main` for the camera + mic of a specific user.
 */
function buildPlayUrl(token: TokenResponse, remoteUserId: string): string {
  const params = new URLSearchParams({
    sdkappid: String(token.sdkAppId),
    roomid: String(token.roomId),
    userid: token.userId,
    usersig: token.userSig,
    appscene: "videocall",
    remoteuserid: remoteUserId,
    streamtype: "main",
  });
  return `room://cloud.tencent.com/rtc?${params.toString()}`;
}

export default function ConsultationPage() {
  const router = useRouter();
  const bookingId = String(router.params.bookingId || "").trim();

  const [state, setState] = useState<RoomState>("loading");
  const [token, setToken] = useState<TokenResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [remoteUsers, setRemoteUsers] = useState<string[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pusherCtxRef = useRef<any>(null);

  const fetchToken = useCallback(async () => {
    if (!bookingId) {
      setError("缺少订单 ID。");
      setState("error");
      return;
    }
    setState("loading");
    setError(null);
    try {
      const res = await request<TokenResponse | { error?: string }>({
        url: "/api/trtc/token",
        method: "POST",
        data: { bookingId },
      });
      if (res.statusCode !== 200 || !("sdkAppId" in res.data)) {
        const msg = ("error" in res.data && res.data.error) || "获取房间凭证失败";
        throw new Error(msg);
      }
      setToken(res.data as TokenResponse);
      setState("ready");
    } catch (err) {
      console.error("[consultation] token fetch failed", err);
      setError(err instanceof Error ? err.message : "获取房间凭证失败");
      setState("error");
    }
  }, [bookingId]);

  useEffect(() => {
    void fetchToken();
  }, [fetchToken]);

  const enterRoom = useCallback(() => {
    if (!token) return;
    setRemoteUsers([]);
    setMuted(false);
    setCameraOff(false);
    setState("in-room");
  }, [token]);

  const leaveRoom = useCallback(() => {
    setState("loading");
    Taro.navigateBack({ delta: 1 }).catch(() => {
      Taro.switchTab({ url: "/pages/dashboard/index" }).catch(() => {});
    });
  }, []);

  const onPusherStateChange = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (event: any) => {
      const { code, message } = event.detail ?? {};
      // Tencent docs: -1308 / -1313 / -1316 are network/auth fatals.
      if (typeof code === "number" && code < 0 && code <= -1300) {
        console.error(`[consultation] pusher error ${code}: ${message}`);
        setError(`推流失败 (${code})`);
        setState("error");
      }
      // 1020 = remote user joined; 1021 = remote user left.
      if (code === 1020 && typeof message === "string" && message) {
        setRemoteUsers((prev) =>
          prev.includes(message) ? prev : [...prev, message],
        );
      }
      if (code === 1021 && typeof message === "string" && message) {
        setRemoteUsers((prev) => prev.filter((id) => id !== message));
      }
    },
    [],
  );

  const onPusherReady = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (_event: any) => {
      // Cache the LivePusherContext so toggle handlers can call it without
      // re-acquiring it each press.
      pusherCtxRef.current = Taro.createLivePusherContext();
    },
    [],
  );

  const toggleMic = useCallback(() => {
    const ctx = pusherCtxRef.current;
    if (!ctx) return;
    if (muted) {
      ctx.resume?.();
      setMuted(false);
    } else {
      ctx.pause?.();
      setMuted(true);
    }
  }, [muted]);

  const toggleCamera = useCallback(() => {
    const ctx = pusherCtxRef.current;
    if (!ctx) return;
    setCameraOff((prev) => {
      // `enableCamera` requires the prop on the component; toggling state
      // re-renders <LivePusher> with the new boolean.
      return !prev;
    });
  }, []);

  // Cleanup safeguard: if the user navigates away without pressing leave,
  // stop the pusher so the SDK doesn't keep streaming in the background.
  useEffect(() => {
    return () => {
      pusherCtxRef.current?.stop?.();
    };
  }, []);

  if (state === "loading") {
    return (
      <View className="consultation">
        <View className="consultation__loading">
          <Text className="consultation__subtitle">连接房间中...</Text>
        </View>
      </View>
    );
  }

  if (state === "error") {
    return (
      <View className="consultation">
        <View className="consultation__error">
          <Text className="consultation__title">无法进入直播咨询</Text>
          <Text className="consultation__error-message">{error ?? "未知错误"}</Text>
          <Button className="consultation__primary" onClick={fetchToken}>
            重试
          </Button>
          <Button className="consultation__secondary" onClick={leaveRoom}>
            返回
          </Button>
        </View>
      </View>
    );
  }

  if (state === "ready" && token) {
    return (
      <View className="consultation">
        <View className="consultation__ready">
          <Text className="consultation__title">即将进入实时咨询</Text>
          <Text className="consultation__subtitle">
            身份：{token.participantRole === "founder" ? "学员" : "教练"} · 房间将于{" "}
            {new Date(token.expiresAt).toLocaleString("zh-CN")} 关闭
          </Text>
          {token.premiumLiveTokenCost > 0 && (
            <Text className="consultation__subtitle">
              进入将消耗 {token.premiumLiveTokenCost} H&G 代币
            </Text>
          )}
          <Button className="consultation__primary" onClick={enterRoom}>
            进入房间
          </Button>
          <Button className="consultation__secondary" onClick={leaveRoom}>
            取消
          </Button>
        </View>
      </View>
    );
  }

  // In-room layout.
  return (
    <View className="consultation">
      <View className="consultation__stage">
        <View className="consultation__tile">
          {token && (
            <LivePusher
              className="consultation__tile-stream"
              url={buildTrtcUrl(token)}
              mode="RTC"
              autopush
              enableCamera={!cameraOff}
              muted={muted}
              onStateChange={onPusherStateChange}
              onError={onPusherStateChange}
              onNetstatus={onPusherReady}
            />
          )}
          <Text className="consultation__tile-label">我</Text>
          {cameraOff && (
            <View className="consultation__tile-placeholder">
              <Text>已关闭摄像头</Text>
            </View>
          )}
        </View>

        {remoteUsers.length === 0 ? (
          <View className="consultation__tile">
            <View className="consultation__tile-placeholder">
              <Text>等待对方加入...</Text>
            </View>
          </View>
        ) : (
          remoteUsers.map((remoteUserId) => (
            <View key={remoteUserId} className="consultation__tile">
              {token && (
                <LivePlayer
                  className="consultation__tile-stream"
                  src={buildPlayUrl(token, remoteUserId)}
                  mode="RTC"
                  autoplay
                />
              )}
              <Text className="consultation__tile-label">
                {remoteUserId.split("_")[0] || remoteUserId}
              </Text>
            </View>
          ))
        )}
      </View>

      <View className="consultation__controls">
        <Button
          className="consultation__control"
          onClick={toggleMic}
          aria-label="麦克风"
        >
          {muted ? "🎙️✕" : "🎙️"}
        </Button>
        <Button
          className="consultation__control"
          onClick={toggleCamera}
          aria-label="摄像头"
        >
          {cameraOff ? "📷✕" : "📷"}
        </Button>
        <Button
          className="consultation__control consultation__control--leave"
          onClick={leaveRoom}
          aria-label="挂断"
        >
          ✕
        </Button>
      </View>
    </View>
  );
}
