import puppeteer from 'puppeteer';
(async ()=>{
  try {
    const browser = await puppeteer.launch({args:['--no-sandbox','--disable-setuid-sandbox']});
    const page = await browser.newPage();
    page.setDefaultTimeout(20000);
    await page.goto('http://127.0.0.1:3000', {waitUntil:'networkidle2'});
    await page.waitForSelector('#calculatorPrivacyView', {visible:true});
    // give app.js a moment to attach listeners
    await new Promise((r) => setTimeout(r, 300));

    async function clickSel(sel) {
      const ok = await page.evaluate((s) => {
        const el = document.querySelector(s);
        if (!el) return false;
        el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return true;
      }, sel);
      if (!ok) throw new Error('Missing selector: ' + sel);
      await new Promise((r) => setTimeout(r, 120));
    }

    // sequence: 1 2 + 3 =  => expect 12 + 3 = 15
    await clickSel('[data-calc-value="1"]');
    await clickSel('[data-calc-value="2"]');
    await clickSel('[data-calc-value="+"]');
    await clickSel('[data-calc-value="3"]');
    await clickSel('[data-calc-action="equals"]');

    await new Promise((r) => setTimeout(r, 250));
    const display = await page.$eval('#calculatorDisplay', el => el.textContent.trim());
    const history = await page.$eval('#calculatorHistory', el => el.textContent.trim());
    console.log(JSON.stringify({display, history}));
    await browser.close();
  } catch (err) {
    console.error('ERROR_TEST:', err && err.message);
    process.exit(2);
  }
})();
