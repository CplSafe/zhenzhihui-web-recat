const { chromium } = require('playwright-core');
(async () => {
  const path = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const b = await chromium.launch({ executablePath: path, headless: true });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await p.goto('http://localhost:5173/hot-copy', { waitUntil: 'networkidle', timeout: 30000 }).catch(e=>console.log('goto:', e.message));
  await p.waitForTimeout(2000);
  console.log('title=', await p.title());
  const info = await p.evaluate(() => ({
    iw: innerWidth, ih: innerHeight,
    text: document.body.innerText.slice(0, 400)
  }));
  console.log(JSON.stringify(info, null, 1));
  await p.screenshot({ path: 'probe-1440.png' });
  await b.close();
})();
