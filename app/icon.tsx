import { ImageResponse } from "next/og";

export const size = {
  width: 512,
  height: 512,
};

export const contentType = "image/png";

export default function Icon() {
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
            inset: 36,
            borderRadius: 108,
            background:
              "linear-gradient(145deg, rgba(255,255,255,0.16), rgba(255,255,255,0.04))",
            border: "1px solid rgba(255,255,255,0.12)",
            boxShadow: "0 28px 72px rgba(0, 0, 0, 0.45)",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 104,
            right: 112,
            width: 74,
            height: 74,
            borderRadius: 9999,
            background: "#f6be4b",
            boxShadow: "0 0 40px rgba(246, 190, 75, 0.65)",
          }}
        />
        <div
          style={{
            display: "flex",
            width: 244,
            height: 296,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 56,
            background: "linear-gradient(180deg, #f6be4b 0%, #ef9e2e 100%)",
            color: "#081120",
            fontSize: 196,
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