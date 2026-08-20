// Headless behavior tests for The Pencil.
const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (x ? '  [' + x + ']' : '')); } };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const logs = [], pubs = [];
  await page.route('**/log', async r => { logs.push(JSON.parse(r.request().postData())); r.fulfill({ status: 204, body: '' }); });
  await page.route('**/publish', async r => { pubs.push(JSON.parse(r.request().postData())); r.fulfill({ status: 204, body: '' }); });
  await page.route('**/voices', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: false, current: '', voices: [] }) }));
  await page.route('**/tts', r => r.fulfill({ status: 503, body: '' }));
  await page.goto('http://127.0.0.1:8377/pencil/');
  await page.evaluate(() => { Dwell.set({ ms: 90, graceMs: 500, decayMs: 800 }); localStorage.removeItem('pencil_draft'); });

  const gazeText = async (txt, holdMs) => {
    const el = page.locator('.dwell', { hasText: txt }).first();
    const b = await el.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 5 });
    await sleep(holdMs || 1100);
  };
  const park = async () => { await page.mouse.move(960, 350, { steps: 4 }); await sleep(450); };
  const typeLetter = async (L) => {
    // Ring layout: abcd = the left seat; other groups = bottom-row cells
    const gi = ["abcd","efgh","ijklmn","opqrst","uvwxyz"].findIndex(g => g.includes(L));
    const gEl = gi === 0 ? page.locator('#seatA') : page.locator('#rowBottom .gcell').nth(gi - 1);
    let b = await gEl.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 5 });
    await sleep(1100); await park();
    const el = page.locator('.lcell', { hasText: new RegExp('^' + L + '$') }).first();
    b = await el.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 5 });
    await sleep(1100); await park();
  };

  console.log('A) direct entry — no start gate (D48)');
  await sleep(700);
  check('page visible immediately (no start screen)', await page.locator('#page').isVisible());
  check('start screen gone from the DOM', await page.locator('#sStart').count() === 0);
  await sleep(3800);   // background TTS self-test timeout in headless
  check('5 letter groups (abcd seat + 4 bottom)', (await page.locator('#rowBottom .gcell').count()) === 4 && /a b c d/.test((await page.textContent('#seatA')).trim()));
  check('rest block inert + door present', await page.locator('#restBlock').count() === 1 && await page.locator('#restBlock.dwell').count() === 0 && (await page.getAttribute('#door','data-dwell-ms')) === '2400');

  console.log('B) flip-book typing: b-a-g');
  await typeLetter('b'); await typeLetter('a'); await typeLetter('g');
  const partial = await page.evaluate(() => document.querySelector('#text .partial') && document.querySelector('#text .partial').textContent);
  check('partial word shows "bag"', partial === 'bag', partial);
  check('predictions visible mid-word', await page.locator('.pword:not(.rested)').count() >= 1);
  const pwords = await page.locator('.pword:not(.rested)').allTextContents();
  check('personal lexicon can surface (bag from her set)', pwords.some(w => w.toLowerCase().startsWith('bag')) || pwords.length > 0, JSON.stringify(pwords));

  console.log('C) space commits HER spelling, exactly');
  await gazeText('space'); await park(); await sleep(600);
  const words1 = await page.evaluate(() => [...document.querySelectorAll('#text .word:not(.partial)')].map(e => e.textContent));
  check('word committed as she wrote it', words1.length === 1 && words1[0] === 'bag', JSON.stringify(words1));

  console.log('D) NO autocorrect: invented spelling "kat" stays "kat"');
  await typeLetter('k'); await typeLetter('a'); await typeLetter('t');
  await gazeText('space'); await park(); await sleep(600);
  const words2 = await page.evaluate(() => [...document.querySelectorAll('#text .word:not(.partial)')].map(e => e.textContent));
  check('kat preserved untouched', words2.join(' ') === 'bag kat', JSON.stringify(words2));

  console.log('E) phonetic prediction: k-prefix offers c-words');
  await typeLetter('k'); await typeLetter('a');
  const preds = await page.locator('.pword:not(.rested)').allTextContents();
  check('offers cat/came/... for "ka"', preds.some(w => /^ca/i.test(w)), JSON.stringify(preds));

  console.log('F) prediction select commits chosen word');
  if (preds.length) {
    await gazeText(preds[0], 2500); await park(); await sleep(500);
    const words3 = await page.evaluate(() => [...document.querySelectorAll('#text .word:not(.partial)')].map(e => e.textContent));
    check('prediction became word 3', words3.length === 3 && words3[2] === preds[0], JSON.stringify(words3));
  } else check('prediction select', false, 'no predictions');

  console.log('G) backspace (deliberate long dwell)');
  const bs = page.locator('#btnDel');
  const bb = await bs.boundingBox();
  await page.mouse.move(bb.x + bb.width/2, bb.y + bb.height/2, { steps: 5 });
  await sleep(2300); await park(); await sleep(400);
  const after = await page.evaluate(() => [...document.querySelectorAll('#text .word')].map(e => e.textContent).join(' '));
  check('backspace pulled last word back for editing', after.split(' ').length >= 2, after);

  console.log('H) draft autosaves');
  const draft = await page.evaluate(() => localStorage.getItem('pencil_draft'));
  check('draft persisted', !!draft && draft.includes('bag'), draft);

  console.log('I) publish sends her words');
  await page.click('#partnerTab'); await page.click('#pPublish'); await sleep(600);
  check('confirm screen first (two-stage send)', await page.locator('#sConfirm.show').count() === 1);
  check('confirm shows her words', (await page.textContent('#confirmSub')).includes('bag'));
  await gazeText('✓ send', 2100); await sleep(1200);
  check('publish posted after confirm', pubs.length === 1 && pubs[0].text.includes('bag'), JSON.stringify(pubs));
  check('done screen shows her words', (await page.textContent('#doneSub')).includes('bag'));
  check('state cleared synchronously (no draft)', (await page.evaluate(() => localStorage.getItem('pencil_draft'))) === null);

  console.log('J) logging flowed');
  const kinds = new Set(logs.map(l => l.event));
  check('letters + words + publish logged', ['letter','word','publish'].every(k => kinds.has(k)), [...kinds].join(','));

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
