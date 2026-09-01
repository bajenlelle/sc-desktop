// Scoutable — Transactional email Edge Function
// Called from Postgres triggers and RPCs via pg_net.
// Auth: caller must send the x-email-secret header matching EMAIL_NOTIFICATION_SECRET.

// Resend API key — prefer RESEND_API_KEY; fall back to the SMTP password (same key, different name)
const RESEND_API_KEY =
  Deno.env.get("RESEND_API_KEY") ?? Deno.env.get("RESEND_SMTP_PASSWORD") ?? "";
const EMAIL_SECRET = Deno.env.get("EMAIL_NOTIFICATION_SECRET") ?? "";
const APP_URL = (Deno.env.get("APP_URL") ?? "https://app.scoutable.se").replace(/\/$/, "");
const FROM = "Scoutable <noreply@scoutable.se>";

type TemplateId =
  | "playlist_shared"
  | "playlist_reminder"
  | "license_expiry"
  | "license_expired"
  | "license_digest"
  | "renewal_requested"
  | "seat_limit_reached"
  | "added_to_team"
  | "user_joined_org"
  | "removed_from_org"
  | "promoted_to_admin"
  | "org_invite";

interface SendEmailRequest {
  to: string;
  template: TemplateId;
  data: Record<string, string>;
}

// ---------------------------------------------------------------------------
// HTML building blocks (matches the existing confirm.html / reset.html style)
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function ctaButton(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
  <tr>
    <td style="border-radius:6px;background-color:#0096b1;">
      <a href="${esc(href)}" style="display:block;padding:14px 36px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;letter-spacing:0.2px;">${esc(label)}</a>
    </td>
  </tr>
</table>`;
}

function wrapEmail(title: string, bodyHtml: string, footerNote: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <title>${esc(title)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td align="center" style="padding:48px 16px;">
        <table role="presentation" width="540" cellpadding="0" cellspacing="0" style="max-width:540px;width:100%;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background-color:#000408;padding:24px 40px 26px 40px;text-align:center;">
              <!-- alt="" on purpose: the wordmark below already names the brand,
                   so alt text would read "Scoutable SCOUTABLE" wherever images
                   are blocked. Width/height attributes are for Outlook, which
                   ignores CSS sizing on images. -->
              <img src="${APP_URL}/email/logo-mark.png" width="40" height="36" alt="" style="display:block;width:40px;height:36px;margin:0 auto 10px auto;border:0;outline:none;text-decoration:none;">
              <span style="font-family:'Barlow Condensed',Impact,'Arial Narrow',Arial,sans-serif;font-size:20px;font-weight:700;color:#ffffff;letter-spacing:3px;text-transform:uppercase;">SCOUTABLE</span>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background-color:#ffffff;padding:40px 40px 36px 40px;">
              ${bodyHtml}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f9fafb;padding:20px 40px;border-top:1px solid #f3f4f6;text-align:center;">
              <p style="margin:0;font-size:11px;line-height:1.5;color:#9ca3af;">${esc(footerNote)}</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

interface TemplateResult {
  subject: string;
  html: string;
}

function renderTemplate(
  template: TemplateId,
  data: Record<string, string>,
  appUrl: string,
): TemplateResult {
  const d = (key: string, fallback = "") => data[key] ?? fallback;

  switch (template) {
    case "playlist_shared": {
      const playlistName = d("playlist_name", "a playlist");
      const sharerName = d("sharer_name", "Your coach");
      const teamName = d("team_name", "your team");
      const playlistUrl = d("playlist_url", appUrl + "/my-playlists");
      // Direct shares go to one player, so the team-oriented copy would read
      // wrong ("shared with your team" when nobody else got it).
      const isDirect = data?.is_direct === true;
      return {
        subject: isDirect
          ? `${sharerName} shared a playlist with you: ${playlistName}`
          : `${sharerName} shared a playlist with ${teamName}: ${playlistName}`,
        html: wrapEmail(
          `New playlist: ${playlistName}`,
          `<h1 style="margin:0 0 12px 0;font-size:20px;font-weight:700;color:#111827;letter-spacing:-0.3px;">${
            isDirect ? "New playlist for you" : `New playlist for ${esc(teamName)}`
          }</h1>
<p style="margin:0 0 32px 0;font-size:14px;line-height:1.65;color:#6b7280;">
  <strong>${esc(sharerName)}</strong> shared <strong>${esc(playlistName)}</strong> ${
    isDirect ? "directly with you" : "with your team"
  }.
</p>
${ctaButton(playlistUrl, "Watch Clips")}`,
          isDirect
            ? "You received this because your coach shared a playlist with you."
            : "You received this because you are a member of this team.",
        ),
      };
    }

    case "playlist_reminder": {
      const playlistName = d("playlist_name", "a playlist");
      const coachName = d("coach_name", "Your coach");
      const playlistUrl = d("playlist_url", appUrl + "/my-playlists");
      return {
        subject: `Reminder from ${coachName}: ${playlistName}`,
        html: wrapEmail(
          `Reminder: ${playlistName}`,
          `<h1 style="margin:0 0 12px 0;font-size:20px;font-weight:700;color:#111827;letter-spacing:-0.3px;">A nudge from ${esc(coachName)}</h1>
<p style="margin:0 0 32px 0;font-size:14px;line-height:1.65;color:#6b7280;">
  <strong>${esc(coachName)}</strong> asked you to watch <strong>${esc(playlistName)}</strong> — you have clips waiting.
</p>
${ctaButton(playlistUrl, "Watch Clips")}`,
          "You received this because your coach sent a reminder.",
        ),
      };
    }

    case "license_expiry": {
      const orgName = d("org_name", "your organization");
      const days = d("days_until_expiry", "soon");
      const expiresOn = d("expires_on");
      const manageUrl = d("manage_url", appUrl + "/organization");
      const dayLabel = days === "1" ? "tomorrow" : `in ${days} days`;
      return {
        subject: `Your Scoutable license expires ${dayLabel}`,
        html: wrapEmail(
          "License expiry warning",
          `<h1 style="margin:0 0 12px 0;font-size:20px;font-weight:700;color:#111827;letter-spacing:-0.3px;">Your license is expiring soon</h1>
<p style="margin:0 0 32px 0;font-size:14px;line-height:1.65;color:#6b7280;">
  The Scoutable license for <strong>${esc(orgName)}</strong> expires <strong>${esc(dayLabel)}</strong>${
    expiresOn ? ` (${esc(expiresOn)})` : ""
  }. Request a renewal to keep your team's access uninterrupted.
</p>
${ctaButton(manageUrl, "Request renewal")}`,
          "You received this because you are an admin or contact of this organization.",
        ),
      };
    }

    case "license_expired": {
      const orgName = d("org_name", "your organization");
      const graceUntil = d("grace_until");
      const manageUrl = d("manage_url", appUrl + "/organization");
      return {
        subject: `Your Scoutable license has expired`,
        html: wrapEmail(
          "License expired",
          `<h1 style="margin:0 0 12px 0;font-size:20px;font-weight:700;color:#111827;letter-spacing:-0.3px;">The license for ${esc(orgName)} has expired</h1>
<p style="margin:0 0 32px 0;font-size:14px;line-height:1.65;color:#6b7280;">
  Your team keeps full access${graceUntil ? ` until <strong>${esc(graceUntil)}</strong>` : " for a short grace period"}. After that, importing games, sharing playlists, creating teams, and inviting members pause until the license is renewed — existing playlists stay watchable.
</p>
${ctaButton(manageUrl, "Request renewal")}`,
          "You received this because you are an admin or contact of this organization.",
        ),
      };
    }

    case "license_digest": {
      const adminUrl = d("admin_url", appUrl + "/admin");
      const orgs = Array.isArray(data?.orgs)
        ? (data.orgs as unknown as Array<Record<string, string>>)
        : [];
      const rows = orgs
        .map(
          (o) => `<tr>
  <td style="padding:8px 12px 8px 0;font-size:13px;color:#111827;"><strong>${esc(o.org_name ?? "—")}</strong></td>
  <td style="padding:8px 12px 8px 0;font-size:13px;color:${o.status === "expired" ? "#dc2626" : "#b45309"};">${
    o.status === "expired" ? "Expired" : "Expires"
  } ${esc(o.expires_on ?? "")}</td>
  <td style="padding:8px 12px 8px 0;font-size:13px;color:#6b7280;">Coaches ${esc(o.coaches ?? "")} · Players ${esc(o.players ?? "")}</td>
  <td style="padding:8px 0;font-size:13px;color:#6b7280;">${esc(o.contact ?? "—")}</td>
</tr>`,
        )
        .join("");
      const count = orgs.length;
      return {
        subject: `License digest: ${count} organization${count === 1 ? "" : "s"} need${count === 1 ? "s" : ""} attention`,
        html: wrapEmail(
          "License digest",
          `<h1 style="margin:0 0 12px 0;font-size:20px;font-weight:700;color:#111827;letter-spacing:-0.3px;">Licenses expiring or recently expired</h1>
<p style="margin:0 0 20px 0;font-size:14px;line-height:1.65;color:#6b7280;">
  These organizations expire within 45 days or expired in the last week.
</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;margin:0 0 32px 0;">${rows}</table>
${ctaButton(adminUrl, "Open platform admin")}`,
          "You received this because you are a Scoutable platform admin.",
        ),
      };
    }

    case "renewal_requested": {
      const orgName = d("org_name", "an organization");
      const requesterName = d("requester_name", "An org admin");
      const requesterEmail = d("requester_email", "");
      const coaches = d("coaches", "—");
      const players = d("players", "—");
      const expiresOn = d("expires_on", "—");
      const orgAdminUrl = d("org_admin_url", appUrl + "/admin");
      return {
        subject: `Renewal requested: ${orgName}`,
        html: wrapEmail(
          `Renewal requested for ${orgName}`,
          `<h1 style="margin:0 0 12px 0;font-size:20px;font-weight:700;color:#111827;letter-spacing:-0.3px;">${esc(orgName)} wants to renew</h1>
<p style="margin:0 0 20px 0;font-size:14px;line-height:1.65;color:#6b7280;">
  <strong>${esc(requesterName)}</strong>${requesterEmail ? ` (${esc(requesterEmail)})` : ""} requested a license renewal.
</p>
<p style="margin:0 0 32px 0;font-size:14px;line-height:1.9;color:#6b7280;">
  Coach seats: <strong>${esc(coaches)}</strong><br>
  Player seats: <strong>${esc(players)}</strong><br>
  License expires: <strong>${esc(expiresOn)}</strong>
</p>
${ctaButton(orgAdminUrl, "Open organization")}`,
          "You received this because you are a Scoutable platform admin.",
        ),
      };
    }

    case "seat_limit_reached": {
      const orgName = d("org_name", "your organization");
      const role = d("role", "coach");
      const seatLimit = d("seat_limit", "");
      const orgUrl = d("org_url", appUrl + "/organization");
      return {
        subject: `Someone couldn't join ${orgName} — ${role} seats are full`,
        html: wrapEmail(
          "Seat limit reached",
          `<h1 style="margin:0 0 12px 0;font-size:20px;font-weight:700;color:#111827;letter-spacing:-0.3px;">All ${esc(role)} seats are in use</h1>
<p style="margin:0 0 32px 0;font-size:14px;line-height:1.65;color:#6b7280;">
  Someone tried to join <strong>${esc(orgName)}</strong> as a ${esc(role)}, but all${
    seatLimit ? ` <strong>${esc(seatLimit)}</strong>` : ""
  } ${esc(role)} seats are taken. Free a seat by removing an inactive member, or contact Scoutable to add more.
</p>
${ctaButton(orgUrl, "Manage members")}`,
          "You received this because you are an admin of this organization or a Scoutable platform admin.",
        ),
      };
    }

    case "added_to_team": {
      const teamName = d("team_name", "a team");
      const orgName = d("org_name", "your organization");
      return {
        subject: `You've been added to ${teamName} on Scoutable`,
        html: wrapEmail(
          `Added to ${teamName}`,
          `<h1 style="margin:0 0 12px 0;font-size:20px;font-weight:700;color:#111827;letter-spacing:-0.3px;">You've been added to a team</h1>
<p style="margin:0 0 32px 0;font-size:14px;line-height:1.65;color:#6b7280;">
  You're now a member of <strong>${esc(teamName)}</strong> in <strong>${esc(orgName)}</strong> on Scoutable.
</p>
${ctaButton(appUrl, "Open Scoutable")}`,
          "You received this because you were added to a team.",
        ),
      };
    }

    case "user_joined_org": {
      const userName = d("user_name", "A new user");
      const orgName = d("org_name", "your organization");
      const orgUrl = d("org_url", appUrl + "/organization");
      return {
        subject: `${userName} has joined ${orgName}`,
        html: wrapEmail(
          `${userName} joined ${orgName}`,
          `<h1 style="margin:0 0 12px 0;font-size:20px;font-weight:700;color:#111827;letter-spacing:-0.3px;">New member joined</h1>
<p style="margin:0 0 32px 0;font-size:14px;line-height:1.65;color:#6b7280;">
  <strong>${esc(userName)}</strong> has joined <strong>${esc(orgName)}</strong> on Scoutable.
</p>
${ctaButton(orgUrl, "See Members")}`,
          "You received this because you are an admin of this organization.",
        ),
      };
    }

    case "removed_from_org": {
      const orgName = d("org_name", "your organization");
      return {
        subject: `Your access to ${orgName} has been removed`,
        html: wrapEmail(
          "Access removed",
          `<h1 style="margin:0 0 12px 0;font-size:20px;font-weight:700;color:#111827;letter-spacing:-0.3px;">You've been removed from ${esc(orgName)}</h1>
<p style="margin:0 0 0 0;font-size:14px;line-height:1.65;color:#6b7280;">
  Your access to <strong>${esc(orgName)}</strong> on Scoutable has been removed. If you believe this was a mistake, contact your team administrator.
</p>`,
          "If you have questions, contact your organization administrator.",
        ),
      };
    }

    case "promoted_to_admin": {
      const orgName = d("org_name", "your organization");
      return {
        subject: `You're now an admin of ${orgName} on Scoutable`,
        html: wrapEmail(
          "Admin promotion",
          `<h1 style="margin:0 0 12px 0;font-size:20px;font-weight:700;color:#111827;letter-spacing:-0.3px;">You've been promoted to admin</h1>
<p style="margin:0 0 32px 0;font-size:14px;line-height:1.65;color:#6b7280;">
  You're now an admin of <strong>${esc(orgName)}</strong> on Scoutable. You can now manage team members, create teams, and share playlists.
</p>
${ctaButton(appUrl + "/organization", "Manage Organization")}`,
          "You received this because your role was updated by an admin.",
        ),
      };
    }

    case "org_invite": {
      const orgName = d("org_name", "an organization");
      const role = d("role", "coach");
      const inviteUrl = d("invite_url", appUrl + "/join");
      const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);
      return {
        subject: `You've been invited to join ${orgName} on Scoutable`,
        html: wrapEmail(
          `Join ${orgName} on Scoutable`,
          `<h1 style="margin:0 0 12px 0;font-size:20px;font-weight:700;color:#111827;letter-spacing:-0.3px;">You're invited to join ${esc(orgName)}</h1>
<p style="margin:0 0 32px 0;font-size:14px;line-height:1.65;color:#6b7280;">
  You've been invited to join <strong>${esc(orgName)}</strong> on Scoutable as a <strong>${esc(roleLabel)}</strong>. Click below to accept your invitation.
</p>
${ctaButton(inviteUrl, "Accept Invitation")}`,
          "This invitation expires in 7 days. If you weren't expecting this, you can ignore this email.",
        ),
      };
    }

    default:
      throw new Error(`Unknown template: ${template}`);
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "content-type, x-email-secret",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // Verify shared secret. Fail closed: this function is reachable from the
  // public internet and sends from noreply@scoutable.se — a missing secret
  // must never mean "no auth".
  if (!EMAIL_SECRET) {
    console.error(
      "[send-email] EMAIL_NOTIFICATION_SECRET is not configured — refusing all requests",
    );
    return new Response("Server misconfigured", { status: 500 });
  }
  if ((req.headers.get("x-email-secret") ?? "") !== EMAIL_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  let body: SendEmailRequest;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { to, template, data } = body;
  if (!to || !template) {
    return new Response(JSON.stringify({ error: "Missing required fields: to, template" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Skip actual sending if no API key (local dev without Resend)
  if (!RESEND_API_KEY) {
    console.log(`[send-email] No API key configured — skipping send to ${to} (template: ${template})`);
    return new Response(JSON.stringify({ ok: true, skipped: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  let result: TemplateResult;
  try {
    result = renderTemplate(template as TemplateId, data ?? {}, APP_URL);
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const resendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM,
      to: [to],
      subject: result.subject,
      html: result.html,
    }),
  });

  if (!resendRes.ok) {
    const errText = await resendRes.text();
    console.error(`[send-email] Resend error for ${to}:`, errText);
    return new Response(JSON.stringify({ error: errText }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
