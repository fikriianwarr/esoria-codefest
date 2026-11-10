import {test,expect} from '@playwright/test';
// Isolated staging URL is enforced by playwright.config.mjs; NEVER run against production.
test('disabled categories stay unselectable and the paper picker retains native values',async({page})=>{
 await page.goto('/results.html');
 const selector=page.locator('select[name="package"]');
 await expect(page.locator('.cf-paper-dropdown-trigger').first()).toBeVisible();
 await selector.locator('option[value="cyber"]').evaluate(option=>{option.disabled=true;});
 await page.locator('.cf-paper-dropdown-trigger').first().click();
 const unavailable=page.locator('.cf-paper-dropdown-option').filter({hasText:'Cybersecurity Mini CTF'});
 await expect(unavailable).toHaveAttribute('aria-disabled','true');
 await unavailable.click();
 await expect(selector).toHaveValue('web');
 const team=page.locator('.cf-paper-dropdown-option').filter({hasText:'Full Stack Development Team'});
 await team.click();
 await expect(selector).toHaveValue('team');
 await page.locator('.cf-paper-month-trigger').click();
 await expect(page.locator('.cf-paper-month-panel')).toBeVisible();
 await page.keyboard.press('Escape');
 await expect(page.locator('.cf-paper-month-panel')).toBeHidden();
});
for(const width of [320,390,768,1440]){
 test(`paper period popup and navigation fit ${width}px screen`,async({page})=>{
  await page.setViewportSize({width,height:740});
  await page.goto('/results.html');
  await expect(page.locator('.cf-paper-month-trigger')).toBeVisible();
  await page.locator('.cf-paper-month-trigger').click();
  expect(await page.locator('.cf-paper-month-panel').evaluate(el=>{
   const bounds=el.getBoundingClientRect();
   return bounds.left>=-1 && bounds.right<=innerWidth+1;
  })).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth+1)).toBe(true);
 });
}
