/*
 * Zotify Keys. Ported from yksim's Chrome extension; licensed under the GNU General Public License, version 3 or later
 * (see https://www.gnu.org/licenses/).
 *
 * Fetches OTPs from Zotify Keys for the content script. Requests are made
 * here rather than in the content script so that they are not subject to the
 * Duo page's CORS restrictions.
 */

const API_URL = 'https://api.zotify.app';

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    chrome.runtime.openOptionsPage();
  }
});

// the toolbar button opens the options too
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

/** Request a new OTP with the configured API key. */
async function fetchOtp() {
  const { apiKey } = await chrome.storage.local.get('apiKey');
  if (!apiKey) {
    throw new Error('no API key yet (see the extension options)');
  }

  const res = await fetch(`${API_URL}/v1/keys/otp`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error ?? `Zotify Keys answered ${res.status}`);
  }
  return body.otp;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'otp') {
    return false;
  }
  fetchOtp().then(
    (otp) => sendResponse({ otp }),
    (e) => sendResponse({ error: e.message }),
  );
  return true; // respond asynchronously
});
