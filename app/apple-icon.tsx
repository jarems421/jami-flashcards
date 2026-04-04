import { ImageResponse } from "next/og";

export const size = {
  width: 180,
  height: 180,
};

export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          position: "relative",
          display: "flex",
          width: "100%",
          height: "100%",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          background:
            "radial-gradient(circle at 20% 20%, #1e3358 0%, #081120 58%, #050912 100%)",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 12,
            borderRadius: 36,
            background:
              "linear-gradient(145deg, rgba(255,255,255,0.18), rgba(255,255,255,0.06))",
            border: "1px solid rgba(255,255,255,0.16)",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 34,
            right: 34,
            width: 24,
            height: 24,
            borderRadius: 9999,
            background: "#f6be4b",
            boxShadow: "0 0 22px rgba(246, 190, 75, 0.65)",
          }}
        />
        <div
          style={{
            display: "flex",
            width: 88,
            height: 106,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 24,
            background: "linear-gradient(180deg, #f6be4b 0%, #ef9e2e 100%)",
            color: "#081120",
            fontSize: 72,
            fontWeight: 700,
            fontFamily: "sans-serif",
            letterSpacing: "-0.08em",
          }}
        >
          J
        </div>
      </div>
    ),
    size
  );
}