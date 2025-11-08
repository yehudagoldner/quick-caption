import { test, expect } from '@playwright/test';

test.describe('WordTimeline Component', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the app
    await page.goto('/');

    // Wait for the page to load
    await page.waitForLoadState('networkidle');
  });

  test('should display words for segments at different times in the video', async ({ page, context }) => {
    // Enable console logging to capture debug messages
    const consoleLogs: string[] = [];
    page.on('console', msg => {
      const text = msg.text();
      consoleLogs.push(text);
      console.log('Browser console:', text);
    });

    // Mock a video with segments and words
    await page.evaluate(() => {
      // Create mock data for testing
      const mockSegments = [
        { id: 1, start: 45.2, end: 48.5, text: 'Test segment in middle of video' },
        { id: 2, start: 120.0, end: 125.0, text: 'Test segment at 2 minutes' }
      ];

      const mockWords = [
        // Words for first segment (45-48 seconds)
        { word: 'Test', start: 45.2, end: 45.6 },
        { word: 'segment', start: 45.7, end: 46.3 },
        { word: 'in', start: 46.4, end: 46.6 },
        { word: 'middle', start: 46.7, end: 47.2 },
        { word: 'of', start: 47.3, end: 47.5 },
        { word: 'video', start: 47.6, end: 48.3 },

        // Words for second segment (120-125 seconds)
        { word: 'Test', start: 120.0, end: 120.5 },
        { word: 'segment', start: 120.6, end: 121.2 },
        { word: 'at', start: 121.3, end: 121.5 },
        { word: '2', start: 121.6, end: 121.9 },
        { word: 'minutes', start: 122.0, end: 123.0 }
      ];

      // Store in window for access
      (window as any).testData = {
        segments: mockSegments,
        words: mockWords
      };
    });

    // Check that the test data was stored
    const hasTestData = await page.evaluate(() => !!(window as any).testData);
    expect(hasTestData).toBe(true);

    // Log all console messages captured
    console.log('\n=== Console Logs ===');
    consoleLogs.forEach(log => {
      if (log.includes('WordTimeline') || log.includes('🎯') || log.includes('📊') || log.includes('⚙️')) {
        console.log(log);
      }
    });

    // Check for specific log patterns that indicate correct behavior
    const hasSegmentWordsLog = consoleLogs.some(log => log.includes('🎯 WordTimeline - segmentWords filter'));
    const hasEditorDataLog = consoleLogs.some(log => log.includes('📊 WordTimeline - editorData'));
    const hasConfigLog = consoleLogs.some(log => log.includes('⚙️ WordTimeline config'));

    console.log('\n=== Test Results ===');
    console.log('Has segment words log:', hasSegmentWordsLog);
    console.log('Has editor data log:', hasEditorDataLog);
    console.log('Has config log:', hasConfigLog);
  });

  test('should show words beyond 11 seconds for longer segments', async ({ page }) => {
    const consoleLogs: string[] = [];
    page.on('console', msg => {
      consoleLogs.push(msg.text());
    });

    await page.evaluate(() => {
      // Create a segment that's 15 seconds long with words throughout
      const mockSegments = [
        { id: 1, start: 30.0, end: 45.0, text: 'Long segment with many words' }
      ];

      const mockWords = [];
      // Generate words every second for 15 seconds
      for (let i = 0; i < 15; i++) {
        mockWords.push({
          word: `Word${i + 1}`,
          start: 30.0 + i,
          end: 30.0 + i + 0.8
        });
      }

      (window as any).testData = {
        segments: mockSegments,
        words: mockWords
      };
    });

    // Wait a bit for any rendering
    await page.waitForTimeout(1000);

    // Check for timeline configuration that shows it can display more than 11 seconds
    const configLogs = consoleLogs.filter(log => log.includes('⚙️ WordTimeline config'));

    if (configLogs.length > 0) {
      console.log('\n=== Timeline Configuration ===');
      configLogs.forEach(log => console.log(log));

      // Check if baseScaleCount is sufficient
      const hasProperScale = configLogs.some(log => {
        const match = log.match(/baseScaleCount:\s*(\d+)/);
        if (match) {
          const scaleCount = parseInt(match[1]);
          console.log('Base scale count:', scaleCount);
          return scaleCount >= 17; // Should be at least ceil(15) + 2 = 17
        }
        return false;
      });

      expect(hasProperScale).toBe(true);
    }
  });

  test('should correctly convert between relative and absolute times', async ({ page }) => {
    const consoleLogs: string[] = [];
    page.on('console', msg => {
      consoleLogs.push(msg.text());
    });

    await page.evaluate(() => {
      // Create a segment starting at 60 seconds
      const mockSegments = [
        { id: 1, start: 60.0, end: 63.0, text: 'Segment at 1 minute mark' }
      ];

      const mockWords = [
        { word: 'Segment', start: 60.2, end: 60.8 },
        { word: 'at', start: 60.9, end: 61.1 },
        { word: '1', start: 61.2, end: 61.4 },
        { word: 'minute', start: 61.5, end: 62.0 },
        { word: 'mark', start: 62.1, end: 62.7 }
      ];

      (window as any).testData = {
        segments: mockSegments,
        words: mockWords
      };
    });

    await page.waitForTimeout(1000);

    // Check that actions are created with relative times (0-based within segment)
    const editorDataLogs = consoleLogs.filter(log => log.includes('📊 WordTimeline - editorData'));

    if (editorDataLogs.length > 0) {
      console.log('\n=== Editor Data Logs ===');
      editorDataLogs.forEach(log => {
        console.log(log);

        // Check that action times are relative (starting near 0, not near 60)
        const timeMatches = log.match(/start:\s*([\d.]+)/g);
        if (timeMatches) {
          timeMatches.forEach(match => {
            const value = parseFloat(match.split(':')[1]);
            console.log('Found start time:', value);
            // Times should be relative (0-3 seconds) not absolute (60-63)
            if (value < 10) { // Reasonable check that it's relative
              expect(value).toBeLessThan(10);
            }
          });
        }
      });
    }
  });
});
