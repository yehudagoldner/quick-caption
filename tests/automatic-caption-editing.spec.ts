import { test, expect, type Page } from '@playwright/test';
import { prepareApp } from './app-fixtures';
import type { Segment, Word } from '../src/client/types';
async function setup(page: Page) {
  await page.setViewportSize({width:1366,height:768}); await prepareApp(page);
  const segment={id:1,start:0,end:1,text:'אחת שתיים שלוש ארבע',wordTimingMode:'automatic'};
  const words=segment.text.split(' ').map((word,i)=>({word,start:i/4,end:(i+1)/4,segmentId:1}));
  const saves: { segments: Segment[]; words: Word[] }[]=[];
  await page.route('**/api/videos/load?**',r=>r.fulfill({json:{video:{id:42,subtitle_json:[segment],words_json:words,format:'.srt',stored_path:'portrait.mp4'}}}));
  await page.route('**/api/videos/update-subtitles',r=>{const b=r.request().postDataJSON();saves.push({segments:JSON.parse(b.subtitleJson),words:JSON.parse(b.wordsJson)});return r.fulfill({json:{success:true}})});
  await page.goto('/?screen=edit&video=review-token');
  await page.getByTestId('subtitle-clip').first().click();
  await page.getByRole('button',{name:'מילה אקטיבית',exact:true}).click();
  await expect(page.getByTestId('word-clip')).toHaveCount(4);
  return saves;
}
test('new caption must redistribute after selected-word deletion',async({page})=>{
  const saves=await setup(page);await page.getByTestId('word-clip').nth(1).click();await page.keyboard.press('Delete');
  await expect.poll(()=>saves.length).toBeGreaterThan(0);
  expect(saves.at(-1)!.segments[0].text).toBe('אחת שלוש ארבע');
  expect(saves.at(-1)!.segments[0].wordTimingMode).toBe('automatic');
  for(const word of saves.at(-1)!.words)expect(word.end-word.start).toBeCloseTo(1/3);
});
test('text-only word correction must retain automatic caption timing',async({page})=>{
  const saves=await setup(page);await page.getByTestId('word-clip').first().click();
  await page.getByRole('button',{name:'ערוך מילה ותזמון',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'עריכת מילה ותזמון'});
  await dialog.getByRole('textbox',{name:'טקסט המילה'}).fill('ראשונה');
  await dialog.getByRole('button',{name:'החל בטיוטה'}).click();
  await expect.poll(()=>saves.length,{timeout:10000}).toBeGreaterThan(0);
  expect(saves.at(-1)!.segments[0].wordTimingMode).toBe('automatic');
  const field=page.getByRole('textbox',{name:'טקסט המקטע',exact:true});
  await field.fill('ראשונה שתיים שלוש ארבע חמש'); await field.blur();
  await expect.poll(()=>saves.at(-1)?.words.length).toBe(5);
  for(const word of saves.at(-1)!.words)expect(word.end-word.start).toBeCloseTo(.2);
});

test('changing word timing explicitly switches a new caption to manual timing',async({page})=>{
  const saves=await setup(page);await page.getByTestId('word-clip').first().click();
  await page.getByRole('button',{name:'ערוך מילה ותזמון',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'עריכת מילה ותזמון'});
  await dialog.getByRole('button',{name:'סיום המילה: פריים אחורה',exact:true}).click();
  await dialog.getByRole('button',{name:'החל בטיוטה'}).click();
  await expect.poll(()=>saves.length).toBeGreaterThan(0);
  expect(saves.at(-1)!.segments[0].wordTimingMode).toBe('manual');
  const firstEnd=saves.at(-1)!.words[0].end;
  const field=page.getByRole('textbox',{name:'טקסט המקטע',exact:true});
  await field.fill('אחת שתיים שלוש ארבע חמש'); await field.blur();
  await expect.poll(()=>saves.at(-1)?.words.length).toBe(5);
  expect(saves.at(-1)!.words[0].end).toBe(firstEnd);
  expect(saves.at(-1)!.words.at(-1)!.end-saves.at(-1)!.words.at(-1)!.start).toBeCloseTo(4/24);
});
