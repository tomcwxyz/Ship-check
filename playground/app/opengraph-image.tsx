import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Ship Check Playground — Before you ship, check. Findings, to verify, coverage.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const ink = "#19372e";
const cream = "#f6f3e9";
const lime = "#e0ee8b";
const sage = "#97b09b";

const labelStyle = {
  display: "flex" as const,
  alignItems: "center" as const,
  gap: 11,
  padding: "10px 14px",
  borderRadius: 28,
  background: "#f8f8ee",
  border: "1px solid #dce4d7",
  color: ink,
  fontSize: 18,
  fontWeight: 600
};

export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{
      width: "100%",
      height: "100%",
      display: "flex",
      position: "relative",
      overflow: "hidden",
      backgroundColor: cream,
      color: ink
    }}>
      {/* Subtle landscape contours echo the site's circular hero artwork. */}
      <div style={{
        position: "absolute", width: 930, height: 380, borderRadius: "50%",
        left: -150, bottom: -295, backgroundColor: "#d2e0cb", transform: "rotate(-9deg)"
      }}/>
      <div style={{
        position: "absolute", width: 790, height: 310, borderRadius: "50%",
        left: 360, bottom: -260, backgroundColor: "#a9c0ad", transform: "rotate(-12deg)"
      }}/>
      <div style={{
        position: "absolute", width: 830, height: 310, borderRadius: "50%",
        right: -340, bottom: -226, backgroundColor: ink, transform: "rotate(-11deg)"
      }}/>

      {/* Main message stays legible at small social-preview sizes. */}
      <div style={{
        display: "flex", flexDirection: "column", zIndex: 2,
        width: 758, paddingTop: 48, paddingLeft: 64, paddingBottom: 48
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{
            width: 46, height: 46, display: "flex",
            alignItems: "center", justifyContent: "center",
            borderRadius: 12, backgroundColor: lime, color: ink,
            fontSize: 36, lineHeight: 1
          }}>✳</div>
          <span style={{
            fontFamily: "Georgia, serif", fontSize: 39, letterSpacing: -1.8
          }}>ship/check</span>
        </div>

        <div style={{
          marginTop: 58, display: "flex", flexDirection: "column",
          fontFamily: "Georgia, serif", letterSpacing: -3.1,
          fontSize: 75, lineHeight: 1.02
        }}>
          <span>Before you ship,</span>
          <span>check.</span>
        </div>
        <div style={{
          width: 225, height: 7, borderRadius: 99,
          marginTop: 11, backgroundColor: lime
        }}/>
        <div style={{
          marginTop: 27, fontFamily: "Arial, sans-serif",
          fontSize: 24, lineHeight: 1.35, maxWidth: 585
        }}>
          <span>See what needs fixing — and what</span>
          <span>still needs checking.</span>
        </div>
        <div style={{
          display: "flex", marginTop: "auto", alignSelf: "flex-start",
          borderRadius: 10, padding: "12px 17px", backgroundColor: lime,
          fontFamily: "Arial, sans-serif", color: ink,
          fontSize: 16, fontWeight: 700, letterSpacing: 1.4
        }}>PUBLIC PLAYGROUND  ·  NO SIGN-IN</div>
      </div>

      <div style={{
        position: "relative", display: "flex", alignItems: "center",
        justifyContent: "center", flex: 1, marginTop: 35
      }}>
        <div style={{
          display: "flex", position: "absolute",
          width: 365, height: 365, borderRadius: "50%",
          border: "2px solid #a7baa8", top: 93, left: -15
        }}/>
        <div style={{
          display: "flex", position: "absolute",
          width: 270, height: 270, borderRadius: "50%",
          border: "2px solid #9db49f", top: 140, left: 33
        }}/>
        <div style={{
          display: "flex", width: 188, height: 188, borderRadius: "50%",
          backgroundColor: ink, alignItems: "center", justifyContent: "center",
          color: "#ffffff", fontFamily: "Arial, sans-serif", fontSize: 117,
          zIndex: 1, marginRight: 100, marginBottom: 13
        }}>✓</div>
        <div style={{
          display: "flex", flexDirection: "column", position: "absolute",
          gap: 34, right: 18, top: 115, zIndex: 3
        }}>
          <div style={labelStyle}><span style={{ color: "#b65a46" }}>●</span> Findings</div>
          <div style={labelStyle}><span style={{ color: "#957c32" }}>?</span> To verify</div>
          <div style={labelStyle}><span style={{ color: "#5a866b" }}>✓</span> Coverage</div>
        </div>
      </div>
    </div>,
    size
  );
}
