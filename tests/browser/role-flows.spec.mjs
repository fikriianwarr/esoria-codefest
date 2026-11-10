import {test,expect} from '@playwright/test';
// These are real staging interactions; test accounts must contain only synthetic data.
test('participant draft, payment review, jury and MFA operator walkthrough entry points',async({page})=>{
 test.skip(!process.env.ESORIA_TEST_STORAGE_STATE,'Requires a staging role session.');
 const role=process.env.ESORIA_TEST_ROLE||'participant';
 const target={participant:'/dashboard.html',payment:'/operations.html',committee:'/operations.html',judge:'/jury.html',admin:'/admin.html'}[role];
 if(!target)throw new Error('Invalid staging test role');
 await page.goto(target);await expect(page).not.toHaveURL(/login\.html/);
 await expect(page.locator('main')).toBeVisible();
 if(role==='judge')await expect(page.locator('#jury-list')).toBeVisible();
 if(['payment','committee'].includes(role))await expect(page.locator('#scope-form')).toBeVisible();
});
test('App Check attestation failure keeps protected data behind its session gate',async({page})=>{
 await page.route('**/firebaseappcheck.googleapis.com/**',route=>route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({error:{code:403,status:'PERMISSION_DENIED',message:'Staging test attestation rejected'}})}));
 await page.goto('/dashboard.html');
 // An anonymous session can redirect; an existing session must show a security error rather than private data.
 await expect.poll(async()=>/login\.html/.test(page.url())||await page.locator('#workspace-alert').isVisible()).toBe(true);
});
