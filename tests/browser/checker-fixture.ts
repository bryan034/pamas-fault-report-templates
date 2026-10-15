import { test as base, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Raw browser coverage is collected from owned client modules, including navigations. */
export const test=base.extend<{checkerCoverage:void}>({
  checkerCoverage:[async({page},runTest,info)=>{
    const collected:Awaited<ReturnType<typeof page.coverage.stopJSCoverage>>=[];
    await page.coverage.startJSCoverage({resetOnNavigation:false});
    // Snapshot explicit navigations without blocking network interception.
    // Link-driven navigations may lose old contexts, so this is partial client coverage.
    const goto=page.goto.bind(page);
    page.goto=async(...args)=>{
      collected.push(...await page.coverage.stopJSCoverage());
      await page.coverage.startJSCoverage({resetOnNavigation:false});
      return goto(...args);
    };
    try {await runTest();} finally {
      const coverage=[...collected,...await page.coverage.stopJSCoverage()];
      const own=coverage.filter(entry=>entry.url.startsWith('http://127.0.0.1:5174/')&&/\/(app\/|lib\/|components\/template-pdf-viewer)/.test(entry.url)&&!entry.url.includes('/node_modules/'));
      const directory=process.env.QA_ARTIFACT_DIR || join('test-results','checker-coverage');
      mkdirSync(directory,{recursive:true});
      writeFileSync(join(directory,`${info.testId}-${info.retry}.json`),JSON.stringify(own));
    }
  },{auto:true}],
});
export {expect};
