import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Help & Grow — AI Native Expert Network";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #312e81 100%)",
          color: "white",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "16px",
          }}
        >
          <div
            style={{
              fontSize: 64,
              fontWeight: 800,
              letterSpacing: "-0.02em",
              lineHeight: 1.1,
              textAlign: "center",
            }}
          >
            Help &amp; Grow
          </div>
          <div
            style={{
              fontSize: 32,
              fontWeight: 400,
              opacity: 0.85,
              textAlign: "center",
            }}
          >
            AI Native Expert Network
          </div>
          <div
            style={{
              marginTop: 24,
              fontSize: 20,
              opacity: 0.6,
              maxWidth: 600,
              textAlign: "center",
              lineHeight: 1.5,
            }}
          >
            Expert &amp; learner · Singapore &amp; Southeast Asia
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
