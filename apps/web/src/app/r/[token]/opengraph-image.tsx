/**
 * The card a pasted report link unfurls with. It carries the title, the
 * opponent and the counts, never a player's name, stat or note: chat apps
 * cache these images. A bare anon client (no cookies: this runs for
 * unauthenticated unfurl bots), and a plain card whatever goes wrong.
 */
import { ImageResponse } from "next/og";
import { createClient } from "@supabase/supabase-js";
import { parseScoutingReport } from "@scoutable/shared/lib/scouting-report";
import { formatCardDate } from "@scoutable/shared/lib/stats-card";
import { BRAND, brandAlpha } from "@/lib/brand";

export const alt = "Scouting report made with Scoutable";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OgImage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  let title = "Scouting report";
  let overline = "Scouting report";
  let counts = "";
  try {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    const { data } = await supabase.rpc("get_scouting_report", { p_id: token });
    const report = data?.valid ? parseScoutingReport(data.content) : null;
    if (report) {
      if (data.title) title = data.title;
      const h = report.header;
      overline = h.opponent ? `Scouting report · ${h.opponent}` : "Scouting report";
      counts = [
        `${h.players} ${h.players === 1 ? "player" : "players"}`,
        `${h.clips} ${h.clips === 1 ? "clip" : "clips"}`,
        `Prepared ${formatCardDate(h.preparedAt)}`,
      ].join(" · ");
    }
  } catch {
    // The generic card: never fail the unfurl.
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
          padding: "0 80px",
          background: `linear-gradient(160deg, ${BRAND.ink} 0%, ${BRAND.inkRaised} 55%, ${BRAND.plum} 100%)`,
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
            background: `radial-gradient(circle, ${brandAlpha(BRAND.cyan, 0.25)} 0%, ${brandAlpha(BRAND.cyan, 0)} 65%)`,
          }}
        />
        <div style={{ display: "flex", fontSize: 30, fontWeight: 600, color: BRAND.cyan, marginBottom: 20 }}>{overline}</div>
        <div
          style={{
            display: "flex",
            fontSize: title.length > 40 ? 64 : 80,
            fontWeight: 800,
            letterSpacing: -2,
            color: BRAND.paper,
            lineHeight: 1.08,
            maxWidth: 1040,
          }}
        >
          {title}
        </div>
        {counts && <div style={{ display: "flex", fontSize: 30, color: brandAlpha(BRAND.paper, 0.7), marginTop: 28 }}>{counts}</div>}
        <div style={{ position: "absolute", left: 80, bottom: 56, display: "flex", alignItems: "baseline" }}>
          <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: -0.5, color: brandAlpha(BRAND.paper, 0.85) }}>scoutable</div>
          <div style={{ width: 9, height: 9, borderRadius: 9999, background: BRAND.cyan, marginLeft: 3 }} />
        </div>
      </div>
    ),
    size,
  );
}
