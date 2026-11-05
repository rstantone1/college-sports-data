const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const out = '/home/claude/college-sports-data/web/shots/'; require('fs').mkdirSync(out, { recursive: true });
  const errs = [];
  const cases = [
    ['ratings', '/mbb/2027'], ['ratings-adv', '/mbb/2027', async (p) => { await p.click('button:has-text("Advanced")'); }],
    ['scores', '/mbb/2027/scores'], ['matchup', '/mbb/2026/matchup'], ['leaders', '/mbb/2026/leaders'], ['tourney', '/mbb/2026/tournament'],
    ['transfers', '/mbb/2027/transfers'], ['ballot', '/mbb/2026/ballot', async (p) => { await p.click('button:has-text("Start from the model")'); }],
    ['team', '/mbb/2026', async (p) => { await p.click('tr.row >> nth=0'); }],
    ['game', '/mbb/2026/scores', async (p) => { await p.click('a.gcard >> nth=0'); }],
    ['about', '/about'], ['sb', '/sb/2026'], ['cfb', '/cfb/2026'],
  ];
  for (const scheme of ['dark', 'light']) for (const [n, u, act] of cases) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme, isMobile: true, hasTouch: true }); const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(scheme + '/' + n + ': ' + e.message));
    try { await p.goto('http://localhost:4173' + u, { waitUntil: 'networkidle' }); await p.waitForTimeout(1200); if (act) { await act(p); await p.waitForLoadState('networkidle'); await p.waitForTimeout(1500); } await p.screenshot({ path: out + scheme + '-' + n + '.png', fullPage: true }); }
    catch (e) { errs.push(scheme + '/' + n + ' FAIL ' + e.message.slice(0, 150)); }
    await ctx.close();
  }
  console.log(errs.join('\n') || 'no errors'); await b.close();
})();
