# EAA Tillgänglighetsanalys — DigitalPT

Automatisk tillgänglighetsanalys för e-handlare baserad på WCAG 2.1 AA / Lag (2023:254).

## Arkitektur

```
public/index.html          ← Landningssida (formulär)
netlify/functions/analyze  ← Serverless function (Claude API + Resend)
```

## Sätt upp projektet

### 1. Klona och installera
```bash
git clone https://github.com/DITT-KONTO/eaa-analyzer.git
cd eaa-analyzer
npm install
```

### 2. Lägg till miljövariabler
```bash
cp .env.example .env
```

Fyll i `.env`:
```
ANTHROPIC_API_KEY=sk-ant-...        ← från console.anthropic.com
RESEND_API_KEY=re_...               ← från resend.com/api-keys
FROM_EMAIL=rapport@dindomän.se      ← måste vara verifierad domän i Resend
```

### 3. Kör lokalt
```bash
npm install -g netlify-cli
netlify dev
```
Öppna http://localhost:8888

### 4. Deploya till Netlify

**Via GitHub (rekommenderat):**
1. Pusha till GitHub
2. Gå till app.netlify.com → "Add new site" → "Import from Git"
3. Välj ditt repo
4. Lägg till miljövariablerna under Site settings → Environment variables:
   - `ANTHROPIC_API_KEY`
   - `RESEND_API_KEY`
   - `FROM_EMAIL`
5. Deploya — klart!

## Resend setup (e-post)

1. Skapa konto på resend.com (gratis, 3000 mail/månad)
2. Gå till Domains → Add Domain → lägg till din domän
3. Följ DNS-instruktionerna (lägger till 3 DNS-poster)
4. Gå till API Keys → Create API Key
5. Kopiera nyckeln till `.env`

## Kostnad

| Tjänst | Gratis tier |
|--------|-------------|
| Netlify | 125k function-anrop/månad |
| Anthropic API | ~$0.015 per analys (Sonnet) |
| Resend | 3 000 mail/månad |

## Anpassa

- **Byt logga/varumärke:** Redigera `public/index.html` — sök efter "DigitalPT"
- **Byt avsändarnamn i mail:** Redigera `FROM_EMAIL` och displaynamnet i `analyze.mjs`
- **Lägg till fler sidtyper:** Lägg till pills i `index.html`
