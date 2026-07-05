import { ImageResponse } from "next/og";
import { SITE } from "@/lib/seo";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const alt = "Alpha by Mossland — 오늘의 알파, 모든 시각으로";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Satori (next/og) ships only a Latin fallback — without an explicit fonts
// array the Korean text renders as tofu. These are Pretendard subsets
// containing exactly the glyphs used on this static card (~14KB each).
const ogFontDir = join(process.cwd(), "app/fonts/og");
const fontRegular = readFileSync(join(ogFontDir, "Pretendard-Regular.subset.otf"));
const fontSemiBold = readFileSync(join(ogFontDir, "Pretendard-SemiBold.subset.otf"));
const fontBold = readFileSync(join(ogFontDir, "Pretendard-Bold.subset.otf"));

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background:
            "linear-gradient(135deg, #FAFAF7 0%, #FAFAF7 70%, #d8e8de 100%)",
          padding: 80,
          fontFamily: "Pretendard",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 16,
            marginBottom: 60,
          }}
        >
          <div
            style={{
              fontSize: 96,
              color: SITE.brandColor,
              fontWeight: 700,
              lineHeight: 1,
            }}
          >
            α
          </div>
          <div style={{ fontSize: 64, fontWeight: 700, color: "#1a1a1a" }}>
            Alpha
          </div>
          <div style={{ fontSize: 36, color: "#6b7280" }}>by Mossland</div>
        </div>

        <div
          style={{
            fontSize: 56,
            fontWeight: 600,
            color: "#1a1a1a",
            lineHeight: 1.2,
            marginBottom: 40,
            maxWidth: 900,
          }}
        >
          오늘의 알파, 모든 시각으로.
        </div>

        <div
          style={{
            fontSize: 28,
            color: "#6b7280",
            lineHeight: 1.5,
            maxWidth: 1000,
          }}
        >
          크립토·매크로·국제정세를 한국 유튜브·뉴스 채널 단위로 정리.
        </div>

        <div
          style={{
            position: "absolute",
            bottom: 60,
            left: 80,
            right: 80,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            color: "#6b7280",
            fontSize: 20,
            borderTop: "2px solid #e5e7eb",
            paddingTop: 30,
          }}
        >
          <span>alpha.moss.land</span>
          <span>5분이면 충분합니다</span>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Pretendard", data: fontRegular, weight: 400, style: "normal" },
        { name: "Pretendard", data: fontSemiBold, weight: 600, style: "normal" },
        { name: "Pretendard", data: fontBold, weight: 700, style: "normal" },
      ],
    }
  );
}
