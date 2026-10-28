/*
 * Zotify Keys. Ported from yksim's Chrome extension; licensed under the GNU General Public License, version 3 or later
 * (see https://www.gnu.org/licenses/).
 *
 * Walks through the Duo prompt: "Other options" -> YubiKey -> passcode.
 *
 * The prompt is a single-page app, so the steps are re-checked whenever the
 * page changes, and repeatedly for a few seconds after the last change in
 * case elements are only shown or enabled later. They are checked
 * last-to-first because the "Other options" button is likely also shown next
 * to the passcode field. Hidden elements are ignored, and each element is
 * acted on only once, so a rejected OTP doesn't cause a loop.
 */

const POLL_INTERVAL = 250; // ms
const POLL_DURATION = 5000; // ms after the last change

const handled = new WeakSet();

// set once YubiKey was chosen, so that "Other options" next to a passcode
// field that isn't shown yet doesn't get clicked
let pastOptions = false;

/** Return the element if it is shown on the page, otherwise null. */
const visible = (el) => (el?.checkVisibility() ? el : null);

/** Return true the first time it is called with a given element. */
function once(el) {
  if (handled.has(el)) {
    return false;
  }
  handled.add(el);
  return true;
}

/** Fill in an OTP from Zotify Keys and submit the form. */
async function fillPasscode(input) {
  const { otp, error } = await chrome.runtime.sendMessage({ type: 'otp' });
  if (error) {
    console.error(`Zotify Keys: ${error}`);
    return;
  }

  // use the native setter so that frameworks like React see the change
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  ).set;
  setValue.call(input, otp);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));

  // let the page update its state before submitting
  await new Promise((resolve) => { setTimeout(resolve, 100); });
  const { form } = input;
  if (!form) {
    console.error('Zotify Keys: passcode field is not in a form');
    return;
  }
  const submit = form.querySelector('[type="submit"]');
  if (submit) {
    submit.click();
  } else {
    form.requestSubmit();
  }
}

function step() {
  const passcode = visible(document.querySelector('input#passcode-input'));
  if (passcode) {
    pastOptions = true;
    if (once(passcode)) {
      fillPasscode(passcode);
    }
    return;
  }

  const yubikey = [...document.querySelectorAll('button.auth-method')]
    .find((button) => visible(button) && button.innerText.includes('YubiKey'));
  if (yubikey) {
    pastOptions = true;
    if (once(yubikey)) {
      yubikey.click();
    }
    return;
  }

  if (pastOptions) {
    return;
  }
  const other = visible(
    document.querySelector('button[data-testid="other-options"]'),
  );
  if (other?.innerText.trim() === 'Other options' && once(other)) {
    other.click();
  }
}

let pollTimer = null;
let pollUntil = 0;

/** Run the steps now and keep re-running them until a while after the last change. */
function poll() {
  step();
  pollUntil = Date.now() + POLL_DURATION;
  if (pollTimer === null) {
    pollTimer = setInterval(() => {
      if (Date.now() > pollUntil) {
        clearInterval(pollTimer);
        pollTimer = null;
        return;
      }
      step();
    }, POLL_INTERVAL);
  }
}

new MutationObserver(poll).observe(document.documentElement, {
  childList: true,
  subtree: true,
});
poll();
