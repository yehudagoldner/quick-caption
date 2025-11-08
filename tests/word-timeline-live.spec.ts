import { test, expect } from '@playwright/test';

test.describe('WordTimeline Live Test', () => {
  const editUrl = 'http://localhost:5173/?screen=edit&video=eyJ2aWRlb0lkIjo0NSwidXNlclVpZCI6IlVPTlg4WmtsRFBPNFc3bXdXVzJieDQwQ0tJMTMiLCJleHAiOjE3NjA1Mzk4ODkzMjYsInJhbmRvbSI6IjIzNzZhYTNkMzVjZjQ2YjQxYjc2NmJhZDQ3YzkyN2VkIn0';

  test.beforeEach(async ({ page, context }) => {
    // Instead of mocking Firebase auth, let's check if we need to authenticate manually
    // For now, we'll navigate directly and see what happens
    // The URL already contains a video token that should authorize access
  });

  test('should load video editing page and capture console logs', async ({ page }) => {
    // Capture all console messages
    const consoleLogs: Array<{type: string, text: string}> = [];

    page.on('console', msg => {
      consoleLogs.push({
        type: msg.type(),
        text: msg.text()
      });

      // Log important messages in real-time
      const text = msg.text();
      if (
        text.includes('WordTimeline') ||
        text.includes('🎯') ||
        text.includes('📊') ||
        text.includes('⚙️') ||
        text.includes('💾')
      ) {
        console.log(`[${msg.type()}]`, text);
      }
    });

    // Capture any errors
    page.on('pageerror', error => {
      console.error('Page error:', error);
    });

    console.log('\n=== Navigating to edit page ===');
    await page.goto(editUrl);

    // Wait for the page to load
    console.log('Waiting for page to load...');
    await page.waitForLoadState('networkidle');

    // Wait for timeline to appear (or error message)
    try {
      await page.waitForSelector('.subtitle-timeline, [role="alert"]', { timeout: 10000 });
    } catch {
      console.log('Neither timeline nor error message appeared');
    }

    // Wait a bit more for any async operations
    await page.waitForTimeout(2000);

    console.log('\n=== Checking page elements ===');

    // Check if there's an error message
    const errorMessage = await page.locator('[role="alert"]').textContent().catch(() => null);
    if (errorMessage) {
      console.log('Error message displayed:', errorMessage);
    }

    // Check if we're on the edit page
    const pageTitle = await page.locator('h4, h1, h2, h3').first().textContent().catch(() => null);
    console.log('Page title:', pageTitle);

    // Look for timeline elements
    const hasTimeline = await page.locator('.subtitle-timeline').count();
    console.log('Timeline elements found:', hasTimeline);

    // Try to find and click on a segment to activate word timeline
    console.log('\n=== Looking for segments ===');
    const segments = await page.locator('.subtitle-timeline-action').count();
    console.log('Number of segments found:', segments);

    if (segments > 0) {
      console.log('Clicking on first segment...');
      await page.locator('.subtitle-timeline-action').first().click();
      await page.waitForTimeout(2000);

      // Check if word timeline appeared
      const wordTimelineVisible = await page.locator('.word-timeline-action').count();
      console.log('Word timeline actions visible:', wordTimelineVisible);
    }

    // Print all relevant console logs
    console.log('\n=== All Relevant Console Logs ===');
    const relevantLogs = consoleLogs.filter(log =>
      log.text.includes('WordTimeline') ||
      log.text.includes('🎯') ||
      log.text.includes('📊') ||
      log.text.includes('⚙️') ||
      log.text.includes('segmentWords') ||
      log.text.includes('editorData') ||
      log.text.includes('config')
    );

    relevantLogs.forEach(log => {
      console.log(`[${log.type}]`, log.text);
    });

    console.log('\n=== Log Summary ===');
    console.log('Total console messages:', consoleLogs.length);
    console.log('Relevant messages:', relevantLogs.length);

    // Check for specific patterns
    const hasSegmentWordsLog = relevantLogs.some(log => log.text.includes('🎯 WordTimeline - segmentWords filter'));
    const hasEditorDataLog = relevantLogs.some(log => log.text.includes('📊 WordTimeline - editorData'));
    const hasConfigLog = relevantLogs.some(log => log.text.includes('⚙️ WordTimeline config'));

    console.log('\nLog pattern checks:');
    console.log('  - Segment words filter log:', hasSegmentWordsLog);
    console.log('  - Editor data log:', hasEditorDataLog);
    console.log('  - Config log:', hasConfigLog);

    // Extract and display key data if available
    if (hasSegmentWordsLog) {
      const segmentLog = relevantLogs.find(log => log.text.includes('🎯 WordTimeline - segmentWords filter'));
      if (segmentLog) {
        console.log('\n=== Segment Words Data ===');
        console.log(segmentLog.text);
      }
    }

    if (hasConfigLog) {
      const configLog = relevantLogs.find(log => log.text.includes('⚙️ WordTimeline config'));
      if (configLog) {
        console.log('\n=== Timeline Configuration ===');
        console.log(configLog.text);

        // Extract baseScaleCount
        const match = configLog.text.match(/baseScaleCount:\s*(\d+)/);
        if (match) {
          const baseScaleCount = parseInt(match[1]);
          console.log(`Base scale count: ${baseScaleCount}`);
          expect(baseScaleCount).toBeGreaterThanOrEqual(20);
        }
      }
    }

    if (hasEditorDataLog) {
      const editorLog = relevantLogs.find(log => log.text.includes('📊 WordTimeline - editorData'));
      if (editorLog) {
        console.log('\n=== Editor Data ===');
        console.log(editorLog.text);
      }
    }

    // Take a screenshot for visual verification
    await page.screenshot({ path: 'test-results/word-timeline-live.png', fullPage: true });
    console.log('\nScreenshot saved to test-results/word-timeline-live.png');
  });

  test('should verify all words are visible in timeline', async ({ page }) => {
    const consoleLogs: string[] = [];

    page.on('console', msg => {
      consoleLogs.push(msg.text());
    });

    await page.goto(editUrl);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Click on a segment to open word timeline
    const segments = await page.locator('.subtitle-timeline-action');
    const count = await segments.count();

    if (count > 0) {
      // Try to click on a segment in the middle/later part of the video
      const segmentIndex = Math.min(5, count - 1); // Click on 6th segment or last
      console.log(`Clicking on segment ${segmentIndex + 1} of ${count}`);
      await segments.nth(segmentIndex).click();
      await page.waitForTimeout(2000);

      // Check for word timeline
      const wordActions = await page.locator('.word-timeline-action').count();
      console.log(`Word actions visible: ${wordActions}`);

      // Get segment info from console logs
      const segmentLog = consoleLogs.find(log => log.includes('🎯 WordTimeline - segmentWords filter'));
      if (segmentLog) {
        console.log('\nSegment information:');
        console.log(segmentLog);

        // Extract word count
        const match = segmentLog.match(/filteredWords:\s*(\d+)/);
        if (match) {
          const expectedWords = parseInt(match[1]);
          console.log(`Expected words from log: ${expectedWords}`);
          console.log(`Visible word actions: ${wordActions}`);

          // They should match
          if (expectedWords > 0) {
            expect(wordActions).toBe(expectedWords);
          }
        }
      }
    }
  });
});
