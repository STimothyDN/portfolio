import puppeteer from 'puppeteer';

(async () => {
  console.log('Starting puppeteer...');
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => {
    if (msg.text().includes('[vite]')) return;
    console.log('BROWSER LOG:', msg.text());
  });
  page.on('pageerror', err => console.log('BROWSER ERROR:', err.toString()));
  
  await page.goto('http://localhost:4324');
  console.log('Page loaded. URL:', page.url());
  
  await new Promise(r => setTimeout(r, 2000));
  
  // Expose a function to log window state
  await page.evaluate(() => {
    window.logState = () => {
      console.log('__sectionTransition:', window.__sectionTransition);
    };
    window.logState();
  });
  
  console.log('Clicking Photography link...');
  await page.evaluate(() => {
     const link = document.querySelector('a[href="/photography/"]');
     if (link) link.click();
     else console.log('Link not found');
  });
  
  console.log('Waiting for transition...');
  await new Promise(r => setTimeout(r, 3000));
  
  console.log('Current URL:', page.url());
  await page.evaluate(() => {
    if (window.logState) window.logState();
    else console.log('window.logState is gone! Native reload occurred.');
  });
  
  console.log('Done.');
  await browser.close();
})();
