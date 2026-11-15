import { useState } from 'react';

// A picture of a team's chances or a scenario, drawn in the browser, sized for a text or a post (4:5).
export interface CardRow { name: string; logo?: string | null; value: string; frac?: number }
export interface Card { kind: 'team' | 'board'; title: string; logo?: string | null; sub?: string; big?: string; bigLabel?: string; lines?: string[]; rows?: CardRow[]; note?: string }
const BRAND = 'Ratings Lab';
const W = 1080, H = 1350;

function loadImg(src: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = () => res(null); im.src = src; setTimeout(() => res(null), 4000); });
}
function fit(ctx: CanvasRenderingContext2D, text: string, max: number, size: number, font: (px: number) => string) { let px = size; ctx.font = font(px); while (ctx.measureText(text).width > max && px > 24) { px -= 4; ctx.font = font(px); } return px; }
function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] { const out: string[] = []; let line = ''; for (const w of text.split(' ')) { const t = line ? `${line} ${w}` : w; if (ctx.measureText(t).width > max && line) { out.push(line); line = w; } else line = t; } if (line) out.push(line); return out; }

export async function drawCard(card: Card): Promise<HTMLCanvasElement> {
  try { await Promise.all([(document as any).fonts?.load('800 100px "Barlow Condensed"'), (document as any).fonts?.load('600 40px "Barlow"')]); } catch { /* fall back to system fonts */ }
  const c = document.createElement('canvas'); c.width = W; c.height = H; const ctx = c.getContext('2d')!;
  const disp = (px: number) => `800 ${px}px "Barlow Condensed", "Arial Narrow", sans-serif`, body = (px: number, wt = 500) => `${wt} ${px}px "Barlow", system-ui, sans-serif`;
  const INK = '#0B1220', PAPER = '#F4F5F7', MUTED = '#5D6778', HOT = '#E4312B', WIN = '#147A4B', GOLD = '#C98A00';
  ctx.fillStyle = PAPER; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = INK; ctx.fillRect(0, 0, W, 120);
  ctx.fillStyle = HOT; ctx.beginPath(); ctx.arc(72, 60, 14, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = disp(52); ctx.textBaseline = 'middle'; ctx.fillText(BRAND, 100, 62);
  ctx.font = body(30); ctx.fillStyle = '#AEB7C6'; const dt = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); ctx.fillText(dt, W - 60 - ctx.measureText(dt).width, 62);
  ctx.textBaseline = 'alphabetic';
  let y = 200;
  if (card.kind === 'team') {
    const logo = card.logo ? await loadImg(card.logo) : null;
    if (logo) { try { ctx.drawImage(logo, 60, y - 20, 170, 170); } catch { /* skip */ } }
    const x = logo ? 260 : 60; ctx.fillStyle = INK; fit(ctx, card.title, W - x - 60, 110, disp); ctx.fillText(card.title, x, y + 80);
    if (card.sub) { ctx.font = body(36); ctx.fillStyle = MUTED; ctx.fillText(card.sub, x, y + 136); }
    y += 250;
    if (card.big) { ctx.fillStyle = INK; ctx.font = disp(330); ctx.fillText(card.big, 52, y + 250); y += 290; }
    if (card.bigLabel) { ctx.font = body(46, 700); ctx.fillStyle = INK; ctx.fillText(card.bigLabel, 60, y + 20); y += 90; }
    ctx.strokeStyle = '#D8DCE3'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(60, y); ctx.lineTo(W - 60, y); ctx.stroke(); y += 70;
    ctx.fillStyle = INK; for (const ln of card.lines ?? []) { ctx.font = body(42, 600); for (const part of wrap(ctx, ln, W - 120)) { ctx.fillText(part, 60, y); y += 60; } y += 14; }
  } else {
    ctx.fillStyle = INK; fit(ctx, card.title, W - 120, 100, disp); ctx.fillText(card.title, 60, y + 50);
    if (card.sub) { ctx.font = body(34); ctx.fillStyle = MUTED; let yy = y + 104; for (const part of wrap(ctx, card.sub, W - 120).slice(0, 2)) { ctx.fillText(part, 60, yy); yy += 44; } y = yy - 44; }
    y += 150; const rows = (card.rows ?? []).slice(0, 12); const rh = Math.min(78, (H - y - 110) / Math.max(1, rows.length));
    const logos = await Promise.all(rows.map((r) => (r.logo ? loadImg(r.logo) : Promise.resolve(null))));
    rows.forEach((r, i) => { const ry = y + i * rh; ctx.fillStyle = MUTED; ctx.font = disp(40); ctx.fillText(String(i + 1), 60, ry + 12);
      if (logos[i]) { try { ctx.drawImage(logos[i]!, 120, ry - 34, 58, 58); } catch { /* skip */ } }
      ctx.fillStyle = INK; ctx.font = body(40, 700); ctx.fillText(r.name, 200, ry + 10);
      ctx.font = disp(56); const vw = ctx.measureText(r.value).width; ctx.fillText(r.value, W - 60 - vw, ry + 14);
      if (r.frac != null) { ctx.fillStyle = '#E3E6EB'; ctx.fillRect(200, ry + 26, W - 260 - 200, 6); ctx.fillStyle = r.frac >= 0.75 ? WIN : r.frac >= 0.25 ? GOLD : MUTED; ctx.fillRect(200, ry + 26, (W - 260 - 200) * Math.max(0.01, r.frac), 6); } });
  }
  ctx.fillStyle = MUTED; ctx.font = body(30); const foot = card.note ?? `${location.host} · an estimate from thousands of simulated seasons`; ctx.fillText(foot, 60, H - 50);
  return c;
}

export function ShareButton({ card, label = 'Share this' }: { card: Card | (() => Card); label?: string }) {
  const [url, setUrl] = useState<string | null>(null); const [blob, setBlob] = useState<Blob | null>(null); const [busy, setBusy] = useState(false);
  const open = async () => { setBusy(true); try { const c = await drawCard(typeof card === 'function' ? card() : card); const b: Blob | null = await new Promise((res) => c.toBlob(res, 'image/png')); if (b) { setBlob(b); setUrl(URL.createObjectURL(b)); } } catch { /* drawing failed: nothing to show */ } setBusy(false); };
  const close = () => { if (url) URL.revokeObjectURL(url); setUrl(null); setBlob(null); };
  const file = blob ? new File([blob], 'playoff-picture.png', { type: 'image/png' }) : null;
  const canShare = !!file && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  const share = async () => { try { await navigator.share({ files: [file!], url: location.href }); } catch { /* closed */ } };
  return (
    <>
      <button className="po-sharebtn" onClick={open} disabled={busy}>{busy ? 'Making your picture…' : label}</button>
      {url && (
        <div className="scrim" onClick={close}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <button className="back" onClick={close}>← Back</button>
            <img src={url} alt="A picture of these chances, ready to share" style={{ width: '100%', borderRadius: 12, border: '1px solid var(--rule)', display: 'block' }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              {canShare && <button className="po-btn" style={{ flex: 1 }} onClick={share}>Send it</button>}
              <a className="po-btn" style={{ flex: 1, textAlign: 'center' }} href={url} download="playoff-picture.png">Save the picture</a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
