import { Resend } from "resend";

// The key lives in .env as RESEND_API_KEY. Without it, emails are printed to the console instead, which is handy for local development
const apiKey = process.env.RESEND_API_KEY;
// zotify.app is verified in Resend, so codes can go to any @uci.edu address. RESEND_FROM overrides it, e.g. for testing
const from = process.env.RESEND_FROM ?? "Zotify <hello@zotify.app>";

const resend = apiKey ? new Resend(apiKey) : null;

export type CodeDelivery = "email" | "console";

export const codeDelivery: CodeDelivery = resend ? "email" : "console";

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);

/** Wraps email content in Zotify's simple layout. The parts are HTML, so escape anything user-provided first */
function layout(title: string, parts: string[]) {
    return `
        <div style="font-family: system-ui, sans-serif; max-width: 420px; margin: 0 auto; padding: 24px; color: #002244;">
            <h1 style="font-size: 20px; margin: 0 0 16px;">${title}</h1>
            ${parts.join("\n")}
        </div>
    `;
}

const paragraph = (html: string, muted = false) =>
    `<p style="margin: 0 0 12px;${muted ? " color: #555759; font-size: 13px;" : ""}">${html}</p>`;

const button = (url: string, label: string) =>
    `<p style="margin: 0 0 16px;"><a href="${escapeHtml(url)}" style="display: inline-block; padding: 12px 20px; border-radius: 999px; background: #fecc07; color: #002244; font-weight: 700; text-decoration: none;">${escapeHtml(label)}</a></p>`;

/** Sends an email, or prints it without a Resend key. Throws if Resend refuses or can't be reached */
async function sendEmail({ to, subject, text, html }: { to: string, subject: string, text: string, html: string }) {
    if (!resend) {
        console.log(`Email to ${to}: ${subject}\n${text}\n`);
        return;
    }

    const { error } = await resend.emails.send({ from, to, subject, text, html });
    if (error) throw new Error(`Resend couldn't send to ${to}: ${error.name}: ${error.message}`);
}

export async function sendLoginCode(email: string, code: string, minutesValid: number) {
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

/** Tells someone they're in, with a link that signs them straight in */
export async function sendWelcomeEmail(email: string, magicLink: string, reason: "invited" | "approved", daysValid: number) {
    const intro = reason === "invited" ? "You've been invited to Zotify." : "Your request to join Zotify was approved.";

    await sendEmail({
        to: email,
        subject: reason === "invited" ? "You're invited to Zotify" : "You're in! Welcome to Zotify",
        text: `${intro} Sign in with this link (it works once and expires in ${daysValid} days):\n\n${magicLink}\n\nAfter that, sign in any time with your UCInetID.`,
        html: layout(reason === "invited" ? "You're invited to Zotify" : "You're in!", [
            paragraph(`${intro} Zotify lets you search and queue songs at the Anteatery and Brandywine.`),
            button(magicLink, "Open Zotify"),
            paragraph(`This link signs you in. It works once and expires in ${daysValid} days; after that, sign in any time with your UCInetID.`, true)
        ])
    });
}

/** Lets an admin know someone asked to join */
export async function sendRequestNotification(adminEmail: string, requesterEmail: string, adminUrl: string) {
    await sendEmail({
        to: adminEmail,
        subject: `${requesterEmail} asked to join Zotify`,
        text: `${requesterEmail} asked for an invitation to Zotify.\n\nApprove or reject it on the admin dashboard: ${adminUrl}`,
        html: layout("New invitation request", [
            paragraph(`<strong>${escapeHtml(requesterEmail)}</strong> asked for an invitation to Zotify.`),
            button(adminUrl, "Review on the dashboard")
        ])
    });
}
