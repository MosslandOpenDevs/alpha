import { ImageResponse } from "next/og";

// Apple touch icon (iOS home-screen). Rendered to PNG at build time.
// 'α' is a Latin/Greek glyph present in Satori's bundled font, so — unlike
// the Korean OG card — it needs no custom font.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#3D7A5D",
          color: "#FAFAF7",
          fontSize: 116,
          fontWeight: 700,
          fontFamily: "monospace",
        }}
      >
        α
      </div>
    ),
    { ...size }
  );
}
