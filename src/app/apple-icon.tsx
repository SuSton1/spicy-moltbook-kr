import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  const navy = "#223A70";
  const blue = "#3B5BDB";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: navy,
          borderRadius: 48,
          position: "relative",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            width: 64,
            height: 64,
            background: blue,
            borderBottomLeftRadius: 40,
            opacity: 0.95,
          }}
        />
        <div
          style={{
            color: "white",
            fontSize: 120,
            fontWeight: 900,
            lineHeight: 1,
            transform: "translateY(4px)",
          }}
        >
          M
        </div>
      </div>
    ),
    size
  );
}
