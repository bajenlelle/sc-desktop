/**
 * Generated poster for public highlight links: brand-dark card with the
 * highlight title and a play affordance, so pasted links unfurl with a real
 * image. Uses a bare anon supabase-js client (no cookies — this runs for
 * unauthenticated unfurl bots).
 */
import { ImageResponse } from "next/og";
import { createClient } from "@supabase/supabase-js";

export const alt = "Basketball highlight made with Scoutable";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OgImage({ params }: { params: Promise<{ shareId: string }> }) {
  const { shareId } = await params;

  let title = "Basketball highlight";
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    const { data } = await supabase.rpc("get_highlight_share", { p_id: shareId });
    if (data?.valid && data.title) title = data.title;
  } catch {
    // Fall back to the generic title — never fail the unfurl.
  }
  if (title.length > 70) title = `${title.slice(0, 67)}…`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          background: "linear-gradient(160deg, #0c1018 0%, #161b24 55%, #1a1430 100%)",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: -180,
            right: -120,
            width: 560,
            height: 560,
            borderRadius: 9999,
            background: "radial-gradient(circle, rgba(34, 211, 238, 0.25) 0%, rgba(34, 211, 238, 0) 65%)",
          }}
        />

        {/* Play affordance */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 120,
            height: 120,
            borderRadius: 9999,
            background: "rgba(34, 211, 238, 0.14)",
            border: "3px solid #22d3ee",
            marginBottom: 48,
          }}
        >
          <svg width="52" height="52" viewBox="0 0 24 24" style={{ marginLeft: 8 }}>
            <path d="M8 5v14l11-7z" fill="#22d3ee" />
          </svg>
        </div>

        {/* Highlight title */}
        <div
          style={{
            fontSize: title.length > 40 ? 52 : 64,
            fontWeight: 800,
            letterSpacing: -1.5,
            color: "#f1f5f9",
            textAlign: "center",
            maxWidth: 1000,
            lineHeight: 1.15,
          }}
        >
          {title}
        </div>

        {/* Wordmark footer */}
        <div style={{ display: "flex", alignItems: "baseline", marginTop: 52 }}>
          <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: 4, color: "rgba(241, 245, 249, 0.7)" }}>
            MADE WITH SCOUTABLE
          </div>
          <div
            style={{
              width: 9,
              height: 9,
              borderRadius: 9999,
              background: "#22d3ee",
              marginLeft: 5,
            }}
          />
        </div>
      </div>
    ),
    size,
  );
}
