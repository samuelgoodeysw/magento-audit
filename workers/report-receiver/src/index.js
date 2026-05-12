function jsonResponse(body, { status = 200, origin = "*" } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "86400",
    },
  });
}

function textResponse(body, { status = 200, origin = "*" } = {}) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "86400",
    },
  });
}

function safeHtml(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function toBase64Utf8(text) {
  const bytes = new TextEncoder().encode(String(text || ""));
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function summarizeOpportunities(opportunities) {
  if (!Array.isArray(opportunities)) return "";
  const top = opportunities.slice(0, 10);
  return top
    .map((o) => {
      const area = safeHtml(o.area || "");
      const status = safeHtml(o.status || "");
      const signal = safeHtml(o.signal || "");
      return `<li><strong>${area}</strong> <span style="color:#666">(${status})</span><br/><span style="color:#333">${signal}</span></li>`;
    })
    .join("");
}

function summarizeFindings(findings) {
  if (!Array.isArray(findings)) return "";
  const top = findings.slice(0, 12);
  return top
    .map((f) => {
      const tag = safeHtml(f.tag || "");
      const heading = safeHtml(f.heading || "");
      const impact = safeHtml(f.impact || "");
      return `<li><strong>${heading}</strong> <span style="color:#666">(${tag})</span>${impact ? `<br/><span style="color:#333">${impact}</span>` : ""}</li>`;
    })
    .join("");
}

function extract(payload) {
  const report = payload?.report || {};
  const contact = payload?.contact || {};
  const url = payload?.audited_url || report?.url || "";
  const detectedPlatform = payload?.detected_platform || report?.detected_platform || "";
  const scores = report?.scores || payload?.scores || null;
  const opportunities = report?.opportunity_map || [];
  const findings = report?.findings || [];
  const tech = report?.technology_context || null;

  return {
    url,
    detectedPlatform,
    scores,
    opportunities,
    findings,
    tech,
    contact: {
      name: contact?.name || "",
      email: contact?.email || "",
      company: contact?.company || "",
      phone: contact?.phone || "",
      notes: contact?.notes || "",
    },
  };
}

function isEmailLike(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function resendSend(env, message) {
  if (!env?.RESEND_API_KEY) throw new Error("Missing RESEND_API_KEY secret.");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(message),
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    throw new Error(`Resend send failed (${response.status}): ${data?.message || text}`);
  }
  return data;
}

function buildSalesEmail({ url, detectedPlatform, scores, opportunities, findings, tech, contact }) {
  const subjectHost = (() => {
    try {
      return new URL(url).host;
    } catch {
      return url || "Unknown site";
    }
  })();

  const scoreLine = scores
    ? `Mobile ${scores.mobileSpeed}/100; Desktop ${scores.desktopSpeed}/100; LCP ${scores.lcp}s; TTFB ${scores.ttfb}ms; SEO ${scores.seo}/100`
    : "Scores unavailable";

  const techLine = tech?.hosting_and_security
    ? [
        tech.hosting_and_security.cdn ? `CDN: ${safeHtml(tech.hosting_and_security.cdn)}` : "",
        tech.hosting_and_security.cache_signals ? "Cache signals: yes" : "Cache signals: unclear",
        tech.hosting_and_security.server_software
          ? `Server: ${safeHtml(tech.hosting_and_security.server_software)}`
          : "Server: unclear",
        tech.hosting_and_security.php_version ? `PHP: ${safeHtml(tech.hosting_and_security.php_version)}` : "PHP: hidden/unknown",
      ]
        .filter(Boolean)
        .join(" · ")
    : "Technology context unavailable";

  const opportunitiesHtml = summarizeOpportunities(opportunities);
  const findingsHtml = summarizeFindings(findings);

  return {
    subject: `Magento audit lead: ${subjectHost}`,
    html: `
      <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.5">
        <h2 style="margin:0 0 8px 0">New audit submission</h2>
        <p style="margin:0 0 12px 0"><strong>URL:</strong> <a href="${safeHtml(url)}">${safeHtml(url)}</a></p>
        <p style="margin:0 0 12px 0"><strong>Detected platform:</strong> ${safeHtml(detectedPlatform)}</p>
        <p style="margin:0 0 12px 0"><strong>Snapshot:</strong> ${safeHtml(scoreLine)}</p>
        <p style="margin:0 0 16px 0"><strong>Hosting signals:</strong> ${techLine}</p>

        <h3 style="margin:18px 0 8px 0">Contact</h3>
        <ul style="margin:0 0 16px 18px;padding:0">
          <li><strong>Name:</strong> ${safeHtml(contact.name)}</li>
          <li><strong>Email:</strong> ${safeHtml(contact.email)}</li>
          ${contact.company ? `<li><strong>Company:</strong> ${safeHtml(contact.company)}</li>` : ""}
          ${contact.phone ? `<li><strong>Phone:</strong> ${safeHtml(contact.phone)}</li>` : ""}
          ${contact.notes ? `<li><strong>Notes:</strong> ${safeHtml(contact.notes)}</li>` : ""}
        </ul>

        ${opportunitiesHtml ? `<h3 style="margin:18px 0 8px 0">Opportunity map (top)</h3><ul style="margin:0 0 16px 18px;padding:0">${opportunitiesHtml}</ul>` : ""}
        ${findingsHtml ? `<h3 style="margin:18px 0 8px 0">Findings (scan-backed)</h3><ul style="margin:0 0 16px 18px;padding:0">${findingsHtml}</ul>` : ""}
        <p style="margin:18px 0 0 0;color:#666;font-size:12px">Full JSON attached as <code>audit.json</code>.</p>
      </div>
    `,
  };
}

function buildAckEmail({ url, contact }) {
  return {
    subject: "Scandiweb audit received",
    html: `
      <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.5">
        <h2 style="margin:0 0 8px 0">We received your audit details</h2>
        <p style="margin:0 0 12px 0">Thanks${contact.name ? `, ${safeHtml(contact.name)}` : ""}. We’ll use your audit snapshot to make the first conversation specific.</p>
        <p style="margin:0 0 12px 0"><strong>URL:</strong> <a href="${safeHtml(url)}">${safeHtml(url)}</a></p>
        <p style="margin:18px 0 0 0;color:#666;font-size:12px">Note: this is a point-in-time snapshot and can vary between runs.</p>
      </div>
    `,
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("origin") || "*";

    if (request.method === "OPTIONS") {
      return textResponse("", { status: 204, origin });
    }

    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/report") {
      return jsonResponse({ ok: false, error: "Not found" }, { status: 404, origin });
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return jsonResponse({ ok: false, error: "Invalid JSON" }, { status: 400, origin });
    }

    const extracted = extract(payload);
    if (!extracted.url) return jsonResponse({ ok: false, error: "Missing audited_url" }, { status: 400, origin });
    if (!extracted.contact.name) return jsonResponse({ ok: false, error: "Missing contact.name" }, { status: 400, origin });
    if (!isEmailLike(extracted.contact.email)) return jsonResponse({ ok: false, error: "Invalid contact.email" }, { status: 400, origin });

    const salesTo = env?.SALES_TO_EMAIL || payload?.report_recipient || payload?.report?.recipient;
    if (!isEmailLike(salesTo)) return jsonResponse({ ok: false, error: "Missing SALES_TO_EMAIL" }, { status: 500, origin });
    if (!env?.FROM_EMAIL) return jsonResponse({ ok: false, error: "Missing FROM_EMAIL var" }, { status: 500, origin });

    const jsonAttachment = toBase64Utf8(JSON.stringify(payload, null, 2));
    const salesEmail = buildSalesEmail(extracted);
    const salesResult = await resendSend(env, {
      from: env.FROM_EMAIL,
      to: [salesTo],
      subject: salesEmail.subject,
      html: salesEmail.html,
      replyTo: extracted.contact.email,
      attachments: [{ filename: "audit.json", content: jsonAttachment }],
    });

    let ackResult = null;
    if (String(env.SEND_ACK || "").toLowerCase() === "true") {
      const ack = buildAckEmail(extracted);
      ackResult = await resendSend(env, {
        from: env.FROM_EMAIL,
        to: [extracted.contact.email],
        subject: ack.subject,
        html: ack.html,
      });
    }

    return jsonResponse(
      { ok: true, sent: true, sales: salesResult?.id || null, ack: ackResult?.id || null },
      { status: 200, origin }
    );
  },
};
