import { Resend } from "resend";
// The key lives in .env as RESEND_API_KEY. Without it, emails are printed to the console instead, which is handy for local development
const apiKey = process.env.RESEND_API_KEY;
// zotify.app is verified in Resend, so codes can go to any address. RESEND_FROM overrides it, e.g. for testing
const from = process.env.RESEND_FROM ?? "Zotify <hello@zotify.app>";
const resend = apiKey ? new Resend(apiKey) : null;
export const codeDelivery = resend ? "email" : "console";
const escapeHtml = (text) => text.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);
/** Wraps email content in Zotify's simple layout. The parts are HTML, so escape anything user-provided first */
function layout(title, parts) {
    return `
        <div style="font-family: system-ui, sans-serif; max-width: 420px; margin: 0 auto; padding: 24px; color: #002244;">
            <h1 style="font-size: 20px; margin: 0 0 16px;">${title}</h1>
            ${parts.join("\n")}
        </div>
    `;
}
const paragraph = (html, muted = false) => `<p style="margin: 0 0 12px;${muted ? " color: #555759; font-size: 13px;" : ""}">${html}</p>`;
const button = (url, label) => `<p style="margin: 0 0 16px;"><a href="${escapeHtml(url)}" style="display: inline-block; padding: 12px 20px; border-radius: 999px; background: #fecc07; color: #002244; font-weight: 700; text-decoration: none;">${escapeHtml(label)}</a></p>`;
/** Sends an email, or prints it without a Resend key. Throws if Resend refuses or can't be reached */
async function sendEmail({ to, subject, text, html }) {
    if (!resend) {
        console.log(`Email to ${to}: ${subject}\n${text}\n`);
        return;
    }
    const { error } = await resend.emails.send({ from, to, subject, text, html });
    if (error)
        throw new Error(`Resend couldn't send to ${to}: ${error.name}: ${error.message}`);
}
export async function sendLoginCode(email, code, minutesValid) {
    if (!resend) {
        console.log(`Login code for ${email}: ${code}`);
        return;
    }
    await sendEmail({
        to: email,
        subject: `${code} is your Zotify login code`,
        text: `Your Zotify login code is ${code}. It expires in ${minutesValid} minutes.\n\nIf you didn't ask for this, you can ignore this email.`,
        html: layout("Your Zotify login code", [
            `<p style="font-size: 32px; font-weight: 700; letter-spacing: 6px; margin: 0 0 16px;">${escapeHtml(code)}</p>`,
            paragraph(`It expires in ${minutesValid} minutes.`),
            paragraph("If you didn't ask for this, you can ignore this email.", true)
        ])
    });
}
// "A", "A and B", or "A, B and C"
const listOf = (names) => names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0] ?? "";
/** Tells someone they're in, with a link that signs them straight in */
export async function sendWelcomeEmail(email, magicLink, reason, daysValid, school) {
    const intro = reason === "invited" ? `You've been invited to Zotify at ${school.shortName}.` : `Your request to join Zotify at ${school.shortName} was approved.`;
    const signIn = `sign in any time with your ${school.idLabel ?? "email address"}`;
    const venues = school.venueNames.length ? ` at ${escapeHtml(listOf(school.venueNames))}` : "";
    await sendEmail({
        to: email,
        subject: reason === "invited" ? "You're invited to Zotify" : "You're in! Welcome to Zotify",
        text: `${intro} Sign in with this link (it works once and expires in ${daysValid} days):\n\n${magicLink}\n\nAfter that, ${signIn}.`,
        html: layout(reason === "invited" ? "You're invited to Zotify" : "You're in!", [
            paragraph(`${escapeHtml(intro)} Zotify lets you search and queue songs${venues}.`),
            button(magicLink, "Open Zotify"),
            paragraph(`This link signs you in. It works once and expires in ${daysValid} days; after that, ${escapeHtml(signIn)}.`, true)
        ])
    });
}
/** Lets an admin know someone asked to join a school's Zotify */
export async function sendRequestNotification(adminEmail, requesterEmail, adminUrl, schoolName) {
    await sendEmail({
        to: adminEmail,
        subject: `${requesterEmail} asked to join Zotify at ${schoolName}`,
        text: `${requesterEmail} asked for an invitation to Zotify at ${schoolName}.\n\nApprove or reject it on the admin dashboard: ${adminUrl}`,
        html: layout("New invitation request", [
            paragraph(`<strong>${escapeHtml(requesterEmail)}</strong> asked for an invitation to Zotify at ${escapeHtml(schoolName)}.`),
            button(adminUrl, "Review on the dashboard")
        ])
    });
}
//# sourceMappingURL=email.js.map