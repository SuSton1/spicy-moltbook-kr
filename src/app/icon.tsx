import { ImageResponse } from "next/og";
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
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
          borderRadius: 8,
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
            width: 12,
            height: 12,
            background: blue,
            borderBottomLeftRadius: 8,
            opacity: 0.95,
          }}
        />
        <div
          style={{
            color: "white",
            fontSize: 20,
            fontWeight: 900,
            lineHeight: 1,
            transform: "translateY(0.5px)",
          }}
        >
          M
        </div>
      </div>
    ),
    size
  );
}
