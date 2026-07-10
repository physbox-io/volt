import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  
  page.on('console', msg => {
    console.log(`BROWSER CONSOLE: ${msg.text()}`);
  });
  
  await page.goto('http://localhost:5174');
  
  // Wait for React to mount and render the Simulate button
  await page.waitForSelector('button');
  
  // Select Astable Multivibrator
  await page.evaluate(() => {
    const select = document.querySelector('select');
    if (select) {
      select.value = 'astableMultivibrator';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });

  // Wait for the new preset to load and paths to register
  await new Promise(r => setTimeout(r, 1000));

  // Find the Simulate button
  const buttons = await page.$$('button');
  for (const btn of buttons) {
    const text = await page.evaluate(el => el.textContent, btn);
    if (text.includes('Simulate')) {
      console.log("Clicking Simulate...");
      await btn.click();
      break;
    }
  }
  
  // Wait a few seconds for simulation to finish and logs to appear
  await new Promise(r => setTimeout(r, 1000));

  // Inspect the circles inside edges
  const circles = await page.evaluate(() => {
    const edgeCircles = Array.from(document.querySelectorAll('.react-flow__edge circle'));
    return edgeCircles.map(c => ({
      cx: c.getAttribute('cx'),
      cy: c.getAttribute('cy'),
      r: c.getAttribute('r'),
      fill: window.getComputedStyle(c).fill,
      parent: c.parentElement ? c.parentElement.getAttribute('data-id') : null
    }));
  });
  console.log("RENDERED CIRCLES:", JSON.stringify(circles, null, 2));
  
  await browser.close();
})();
