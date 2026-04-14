import Anthropic from "@anthropic-ai/sdk";
import { Resend } from "resend";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const resend = new Resend(process.env.RESEND_API_KEY);

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Ogiltig JSON" }) };
  }

  const { url, email, pageType = "Startsida", companyName = "" } = body;

  if (!url || !email) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "URL och e-post krävs" }),
    };
  }

  // --- 1. Kör Claude-analys ---
  let analysis;
  try {
    const prompt = `Du är expert på webbtillgänglighet (WCAG 2.1 AA) och EU:s tillgänglighetslag EAA / Lag (2023:254) om vissa produkters och tjänsters tillgänglighet.

Analysera denna e-handelswebbplats: ${url}
Sidtyp att fokusera på: ${pageType}
Företagsnamn: ${companyName || url}

Generera en detaljerad tillgänglighetsanalys. Returnera ENDAST ett JSON-objekt, absolut ingenting utanför JSON-blocket.

{
  "url": "${url}",
  "companyName": "${companyName || url}",
  "pageType": "${pageType}",
  "analyzedAt": "YYYY-MM-DD",
  "overallScore": <0-100>,
  "complianceStatus": "Hög risk" | "Medelhög risk" | "Låg risk",
  "summary": { "criticalCount": <n>, "warningCount": <n>, "passCount": <n> },
  "issues": [
    {
      "severity": "critical" | "warning" | "pass",
      "name": "Kort namn",
      "wcagCriteria": "t.ex. WCAG 1.1.1 (A)",
      "businessImpact": "Affärskonsekvens för e-handlaren (2-3 meningar)",
      "technicalFix": "Konkret teknisk instruktion för en webbutvecklare (2-3 meningar)",
      "effort": "low" | "medium" | "high"
    }
  ],
  "actionPlan": {
    "phase1": { "label": "Omedelbart (vecka 1-2)", "items": ["..."] },
    "phase2": { "label": "Kort sikt (månad 1)", "items": ["..."] },
    "phase3": { "label": "Löpande underhåll", "items": ["..."] }
  },
  "complianceNote": "Specifik notering om lagstatus för just denna typ av e-handel"
}

Ge 10-12 issues totalt med en bra mix av critical (4-5st), warning (3-4st) och pass (2-3st).
Fokusera på vanliga e-handelsbrister: alt-texter, kontrastförhållanden, tangentbordsnavigering, checkout-tillgänglighet, formuläretiketter, tillgänglighetsredogörelse, skärmläsarkompatibilitet, felhantering, rubrikstruktur, fokusindikatorer.
Var specifik och praktisk i dina råd — inte generiska.`;

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = response.content.map((b) => b.text || "").join("");
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Ingen JSON i Claude-svaret");
    analysis = JSON.parse(match[0]);
  } catch (err) {
    console.error("Claude-fel:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Analysen misslyckades: " + err.message }),
    };
  }

  // --- 2. Bygg HTML-rapport ---
  const reportHtml = buildReportHtml(analysis);

  // --- 3. Skicka e-post med Resend ---
  try {
    await resend.emails.send({
      from: process.env.FROM_EMAIL || "rapport@tillganglighet.se",
      to: email,
      subject: `Tillgänglighetsanalys — ${analysis.companyName || url}`,
      html: buildEmailHtml(analysis, reportHtml),
      attachments: [
        {
          filename: `tillganglighet-${new Date().toISOString().slice(0, 10)}.html`,
          content: Buffer.from(reportHtml).toString("base64"),
        },
      ],
    });
  } catch (err) {
    console.error("Resend-fel:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "E-post misslyckades: " + err.message }),
    };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      success: true,
      score: analysis.overallScore,
      status: analysis.complianceStatus,
      criticalCount: analysis.summary.criticalCount,
    }),
  };
};

// --- HTML-rapport (standalone PDF-vänlig fil) ---
function buildReportHtml(d) {
  const effortLabel = { low: "Låg insats", medium: "Medel insats", high: "Hög insats" };
  const effortColor = { low: "#b5f542", medium: "#f5a842", high: "#f54242" };
  const severityLabel = { critical: "KRITISK", warning: "VARNING", pass: "GODKÄNT" };
  const severityColor = { critical: "#f54242", warning: "#f5a842", pass: "#b5f542" };

  const issueRows = d.issues.map((issue) => `
    <tr style="border-bottom:1px solid #e5e7eb">
      <td style="padding:14px 12px;vertical-align:top">
        <span style="display:inline-block;padding:2px 8px;border-radius:3px;font-size:10px;font-weight:700;letter-spacing:.08em;background:${severityColor[issue.severity]}22;color:${severityColor[issue.severity]}">${severityLabel[issue.severity]}</span>
      </td>
      <td style="padding:14px 12px;vertical-align:top">
        <strong style="font-size:14px">${issue.name}</strong><br>
        <span style="font-size:11px;color:#6b7280;font-family:monospace">${issue.wcagCriteria}</span>
      </td>
      <td style="padding:14px 12px;vertical-align:top;font-size:13px;color:#374151">${issue.businessImpact}</td>
      <td style="padding:14px 12px;vertical-align:top;font-size:12px;color:#6b7280;font-family:monospace">${issue.technicalFix}</td>
      <td style="padding:14px 12px;vertical-align:top;text-align:center">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${effortColor[issue.effort]};margin-right:4px"></span>
        <span style="font-size:11px;color:#6b7280">${effortLabel[issue.effort]}</span>
      </td>
    </tr>`).join("");

  const phaseHtml = ["phase1", "phase2", "phase3"].map((p) => {
    const phase = d.actionPlan?.[p];
    if (!phase) return "";
    return `
      <div style="margin-bottom:24px">
        <div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#059669;margin-bottom:8px">${phase.label}</div>
        ${phase.items.map((item) => `<div style="display:flex;gap:8px;margin-bottom:6px;font-size:14px"><span style="color:#9ca3af;flex-shrink:0">→</span><span>${item}</span></div>`).join("")}
      </div>`;
  }).join("");

  const scoreColor = d.overallScore >= 70 ? "#059669" : d.overallScore >= 40 ? "#d97706" : "#dc2626";

  return `<!DOCTYPE html>
<html lang="sv">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tillgänglighetsanalys — ${d.companyName || d.url}</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827;margin:0;padding:0;background:#f9fafb}
  @media print{body{background:white}.no-print{display:none}}
</style>
</head>
<body>
<div style="max-width:900px;margin:0 auto;padding:40px 24px">

  <!-- HEADER -->
  <div style="background:linear-gradient(135deg,#0d1f17,#1a3a2a);color:white;border-radius:8px;padding:40px;margin-bottom:32px;display:flex;justify-content:space-between;align-items:center;gap:24px">
    <div>
      <div style="font-size:11px;letter-spacing:.15em;text-transform:uppercase;color:#6ee7b7;margin-bottom:8px">EAA / WCAG 2.1 AA · Lag (2023:254)</div>
      <h1 style="margin:0 0 8px;font-size:28px;font-weight:700">Tillgänglighetsanalys</h1>
      <div style="font-size:14px;color:#a7f3d0">${d.companyName || d.url}</div>
      <div style="font-size:12px;color:#6ee7b7;margin-top:4px">${d.pageType} · ${d.analyzedAt}</div>
    </div>
    <div style="text-align:center;flex-shrink:0">
      <div style="width:90px;height:90px;border-radius:50%;border:3px solid ${scoreColor};display:flex;flex-direction:column;align-items:center;justify-content:center">
        <div style="font-size:30px;font-weight:700;color:${scoreColor};line-height:1">${d.overallScore}</div>
        <div style="font-size:10px;color:#9ca3af;letter-spacing:.1em">/100</div>
      </div>
      <div style="margin-top:8px;font-size:11px;color:#f87171;font-weight:600">${d.complianceStatus}</div>
    </div>
  </div>

  <!-- SUMMARY -->
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:32px">
    <div style="background:white;border:1px solid #e5e7eb;border-radius:8px;padding:24px;text-align:center;border-top:3px solid #dc2626">
      <div style="font-size:42px;font-weight:700;color:#dc2626;line-height:1">${d.summary.criticalCount}</div>
      <div style="font-size:12px;color:#6b7280;margin-top:4px;text-transform:uppercase;letter-spacing:.05em">Kritiska brister</div>
    </div>
    <div style="background:white;border:1px solid #e5e7eb;border-radius:8px;padding:24px;text-align:center;border-top:3px solid #d97706">
      <div style="font-size:42px;font-weight:700;color:#d97706;line-height:1">${d.summary.warningCount}</div>
      <div style="font-size:12px;color:#6b7280;margin-top:4px;text-transform:uppercase;letter-spacing:.05em">Varningar</div>
    </div>
    <div style="background:white;border:1px solid #e5e7eb;border-radius:8px;padding:24px;text-align:center;border-top:3px solid #059669">
      <div style="font-size:42px;font-weight:700;color:#059669;line-height:1">${d.summary.passCount}</div>
      <div style="font-size:12px;color:#6b7280;margin-top:4px;text-transform:uppercase;letter-spacing:.05em">Godkänt</div>
    </div>
  </div>

  <!-- ISSUES TABLE -->
  <div style="background:white;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:32px;overflow:hidden">
    <div style="padding:20px 24px;border-bottom:1px solid #e5e7eb">
      <h2 style="margin:0;font-size:18px">Identifierade brister</h2>
    </div>
    <table style="width:100%;border-collapse:collapse">
      <thead>
        <tr style="background:#f9fafb;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#6b7280">
          <th style="padding:10px 12px;text-align:left">Status</th>
          <th style="padding:10px 12px;text-align:left">Brist</th>
          <th style="padding:10px 12px;text-align:left">Affärspåverkan</th>
          <th style="padding:10px 12px;text-align:left">Teknisk åtgärd</th>
          <th style="padding:10px 12px;text-align:left">Insats</th>
        </tr>
      </thead>
      <tbody>${issueRows}</tbody>
    </table>
  </div>

  <!-- ACTION PLAN -->
  <div style="background:white;border:1px solid #e5e7eb;border-radius:8px;padding:28px;margin-bottom:24px">
    <h2 style="margin:0 0 24px;font-size:18px">Prioriterad åtgärdsplan</h2>
    ${phaseHtml}
  </div>

  <!-- COMPLIANCE NOTE -->
  <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:20px;margin-bottom:32px">
    <strong style="color:#dc2626">⚖ Juridisk status:</strong>
    <span style="font-size:13px;color:#6b7280;margin-left:6px">${d.complianceNote}</span>
  </div>

  <!-- FOOTER -->
  <div style="text-align:center;font-size:12px;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:24px">
    Rapporten är genererad av DigitalPT tillgänglighetsanalys · ${d.analyzedAt}<br>
    Baserad på WCAG 2.1 AA och Lag (2023:254) om vissa produkters och tjänsters tillgänglighet (EAA)
  </div>

</div>
</body>
</html>`;
}

// --- E-postmall (sammanfattning + bifogad full rapport) ---
function buildEmailHtml(d, _reportHtml) {
  const scoreColor = d.overallScore >= 70 ? "#059669" : d.overallScore >= 40 ? "#d97706" : "#dc2626";
  const criticals = d.issues.filter((i) => i.severity === "critical").slice(0, 3);

  return `<!DOCTYPE html>
<html lang="sv">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;margin:0;padding:24px">
<div style="max-width:600px;margin:0 auto">

  <div style="background:linear-gradient(135deg,#0d1f17,#1a3a2a);color:white;border-radius:8px 8px 0 0;padding:32px">
    <div style="font-size:11px;letter-spacing:.15em;text-transform:uppercase;color:#6ee7b7;margin-bottom:8px">EAA Tillgänglighetsanalys</div>
    <h1 style="margin:0 0 4px;font-size:22px">Din rapport är klar</h1>
    <div style="font-size:14px;color:#a7f3d0">${d.url}</div>
  </div>

  <div style="background:white;border:1px solid #e5e7eb;padding:32px">

    <div style="display:flex;align-items:center;gap:16px;padding:20px;background:#f9fafb;border-radius:8px;margin-bottom:24px">
      <div style="font-size:40px;font-weight:700;color:${scoreColor}">${d.overallScore}</div>
      <div>
        <div style="font-size:13px;color:#6b7280">av 100 möjliga poäng</div>
        <div style="font-size:16px;font-weight:600;color:${scoreColor}">${d.complianceStatus}</div>
      </div>
      <div style="margin-left:auto;text-align:right">
        <div style="font-size:12px;color:#6b7280">${d.summary.criticalCount} kritiska · ${d.summary.warningCount} varningar · ${d.summary.passCount} godkänt</div>
      </div>
    </div>

    <h3 style="font-size:14px;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;margin:0 0 12px">Viktigaste åtgärderna</h3>
    ${criticals.map((i) => `
      <div style="border-left:3px solid #dc2626;padding:12px 16px;margin-bottom:10px;background:#fef2f2;border-radius:0 6px 6px 0">
        <div style="font-weight:600;font-size:14px;margin-bottom:4px">${i.name}</div>
        <div style="font-size:12px;color:#6b7280">${i.businessImpact}</div>
      </div>`).join("")}

    <div style="margin-top:24px;padding:16px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;font-size:13px;color:#166534">
      📎 Den fullständiga rapporten med alla ${d.issues.length} punkter och tekniska åtgärdsinstruktioner finns bifogad som HTML-fil. Öppna den i webbläsaren för bästa läsbarhet — fungerar även att skriva ut som PDF.
    </div>
  </div>

  <div style="padding:20px;text-align:center;font-size:12px;color:#9ca3af">
    Genererad av DigitalPT · Baserad på WCAG 2.1 AA och EAA (Lag 2023:254)
  </div>

</div>
</body>
</html>`;
}
