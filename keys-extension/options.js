const API_URL = 'https://api.zotify.app';

const form = document.getElementById('settings');
const apiKey = document.getElementById('api-key');
const test = document.getElementById('test');
const status = document.getElementById('status');

chrome.storage.local.get('apiKey').then((settings) => {
  apiKey.value = settings.apiKey ?? '';
});

/** Check an API key without using up an OTP. Returns a message. */
async function check(key) {
  try {
    const res = await fetch(`${API_URL}/v1/keys/whoami`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return body.error ?? `Zotify Keys answered ${res.status}.`;
    }
    if (!body.device) {
      return `Works for ${body.email}, but there's no key to use yet. Add one at keys.zotify.app.`;
    }
    return `Works for ${body.email} (${body.device.countersLeft} OTPs left).`;
  } catch {
    return "Couldn't reach Zotify Keys.";
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const key = apiKey.value.trim();
  if (!key.startsWith('zotify_key_')) {
    status.textContent = 'API keys start with zotify_key_.';
    return;
  }

  await chrome.storage.local.set({ apiKey: key });
  status.textContent = `Saved. ${await check(key)}`;
});

test.addEventListener('click', async () => {
  status.textContent = 'Checking…';
  status.textContent = await check(apiKey.value.trim());
});
