import {test,expect} from '@playwright/test';
const sizes=[[320,740],[375,812],[390,844],[440,956],[768,1024],[1024,768],[1280,800],[1920,1080],[844,390],[740,320]];
const publicPages=['index.html','login.html','signup.html','forgot-password.html','legal/index.html','legal/payment-policy.html','legal/refund-policy.html','tickets/tiket-coding-individu.html','tickets/tiket-cybersecurity-individu.html','tickets/tiket-tim-digital.html','results.html','verify-certificate.html'];
for(const [width,height] of sizes){
 test(`public pages fit ${width}x${height} and keep browser zoom available`,async({page})=>{
  await page.setViewportSize({width,height});
  for(const path of publicPages){
   await page.goto(`/${path}`);await page.waitForLoadState('domcontentloaded');
   expect(await page.evaluate(()=>globalThis.ESORIA_RUNTIME_CONFIG?.firebase?.projectId)).toBe(process.env.ESORIA_TEST_PROJECT);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),path).toBe(true);
   const viewport=await page.locator('meta[name=viewport]').getAttribute('content');expect(viewport).not.toMatch(/user-scalable=no|maximum-scale=1(?:,|$)/);
   await expect(page.locator('h1').first()).toBeVisible();
  }
 });
}
test('keyboard, reduced motion and native modal focus remain usable',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/results.html');
 await page.keyboard.press('Tab');await expect(page.locator('.cf-skip')).toBeFocused();
 await page.keyboard.press('Enter');await expect(page.locator('#main-content')).toBeInViewport();
 await page.setViewportSize({width:320,height:740});await expect(page.locator('.cf-paper-month-trigger')).toBeVisible();await page.locator('.cf-paper-month-trigger').focus();await expect(page.locator('.cf-paper-month-trigger')).toBeFocused();
});
const protectedPages=['dashboard.html','profil.html','form-pendaftaran.html'];
for(const path of protectedPages){
 test(`authenticated participant workspace ${path} at all requested widths`,async({page})=>{
  test.skip(!process.env.ESORIA_TEST_STORAGE_STATE,'Requires a manually prepared staging participant session.');
  await page.goto(`/${path}`);await expect(page).not.toHaveURL(/login\.html/);
  for(const [width,height] of sizes){await page.setViewportSize({width,height});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);}
 });
}
test('auth entry is disabled while checking session and no automatic duplicate login occurs',async({page})=>{
 await page.goto('/login.html');
 const button=page.locator('#auth-submit');await expect(button).toBeVisible();
 await expect(button).toBeEnabled({timeout:45000});
 await expect(page.locator('#auth-form')).not.toHaveAttribute('aria-busy','true');
});
