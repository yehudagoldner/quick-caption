import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

export const testUid = 'review-user';
export const portraitVideo = Buffer.from(readFileSync('tests/fixtures/portrait-video.base64', 'utf8').trim(), 'base64');
export const segments = [{ id: 1, start: 0, end: 2, text: 'שלום עולם' }, { id: 2, start: 2, end: 4, text: 'סרטון לבדיקה' }];
export async function prepareApp(page: Page) {
  await page.route('**/src/client/contexts/AuthContext.tsx', route => route.fulfill({ contentType: 'application/javascript', body: `const user = { uid: '${testUid}', displayName: 'Review' }; export const useAuth = () => ({ user, loading: false, signIn: async () => {}, signOut: async () => {} }); export const AuthProvider = ({ children }) => children;` }));
  await page.route('**/api/**', route => route.fulfill({ json: { credits: 50, videos: [] } }));
  await page.routeWebSocket('**/socket.io/**', () => {});
  await page.route('**/api/videos/load?**', route => route.fulfill({ json: { video: { id: 42, subtitle_json: segments, words_json: [], format: '.srt', stored_path: 'portrait.mp4' } } }));
  await page.route('**/api/videos/42/media?**', route => route.fulfill({ contentType: 'video/webm', body: portraitVideo }));
}

export async function mockPayPal(page: Page, { deferApproval = false } = {}) {
  await page.route('https://www.paypal.com/sdk/js?**', route => route.fulfill({ contentType: 'application/javascript', body: `
    window.paypal = { Buttons(options) {
      let button, approveButton, orderID;
      return {
        isEligible: () => true,
        render: async (container) => {
          button = document.createElement('button'); button.textContent = 'PayPal test checkout';
          button.onclick = async () => {
            try {
              orderID = await options.createOrder();
              if (${deferApproval}) approveButton.hidden = false;
              else await options.onApprove({ orderID });
            }
            catch (error) { options.onError(error); }
          };
          container.appendChild(button);
          approveButton = document.createElement('button'); approveButton.textContent = 'PayPal test approve'; approveButton.hidden = true;
          approveButton.onclick = () => options.onApprove({ orderID });
          container.appendChild(approveButton);
          options.onInit({}, {
            disable: async () => { button.disabled = approveButton.disabled = true; },
            enable: async () => { button.disabled = approveButton.disabled = false; },
          });
        },
        close: async () => { button?.remove(); approveButton?.remove(); },
      };
    } };
  ` }));
}
