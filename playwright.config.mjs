import {defineConfig} from '@playwright/test';
const baseURL=process.env.ESORIA_TEST_BASE_URL;
const project=process.env.ESORIA_TEST_PROJECT;
if(!baseURL||!project||project==='esoria-codefest'||!/^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1))/.test(baseURL)||/esoria-codefest\.(web\.app|firebaseapp\.com)/.test(baseURL))throw new Error('Browser tests require an explicit isolated staging URL and ESORIA_TEST_PROJECT, never production.');
export default defineConfig({testDir:'tests/browser',timeout:60000,fullyParallel:false,reporter:[['list'],['json',{outputFile:'evidence/local/browser-results.json'}]],use:{baseURL,trace:'off',screenshot:'off',video:'off',...(process.env.ESORIA_TEST_STORAGE_STATE?{storageState:process.env.ESORIA_TEST_STORAGE_STATE}:{})}});
