import { MAIN_SCHOOL_ID, db, transaction } from "./db.js";
import { DOCS_SUBDOMAIN, MEALS_SUBDOMAIN, SITE_DOMAIN, siteUrl } from "./config.js";

// Schools and their venues, managed by site admins from the dashboard (see routes/schools.ts). Each school has its own
// Zotify: the main school at zotify.app, every other one at a subdomain like uf.zotify.app

export interface School {
    id: string;
    name: string;
    // e.g. "UCI", for short mentions
    shortName: string;
    // Null for the main school, which lives at the main domain
    subdomain: string | null;
    // A bare ID like "panteater" becomes panteater@uci.edu; null means people sign in with a full email
    emailDomain: string | null;
    // What those IDs are called there, e.g. "UCInetID"
    idLabel: string | null;
    idPlaceholder: string | null;
    // Under the homepage heading, and along the bottom
    tagline: string | null;
    footer: string | null;
    position: number;
}

export interface SchoolVenue {
    // Used throughout Zotify (queues, searches, history), so it never changes
    id: string;
    schoolId: string;
    name: string;
    rockbotId: string;
    // A Rockbot account that only ever checks in here; optional
    homeAccount: string | null;
    position: number;
}

/** Something about a school or venue that can't be saved. status is the HTTP status to answer with */
export class SchoolConfigError extends Error {
    status: number;

    constructor (message: string, status = 400) {
        super(message);
        this.name = "SchoolConfigError";
        this.status = status;
    }
}

interface SchoolRow {
    id: string; name: string; short_name: string; subdomain: string | null; email_domain: string | null;
    id_label: string | null; id_placeholder: string | null; tagline: string | null; footer: string | null; position: number;
}

interface VenueRow { id: string; school_id: string; name: string; rockbot_id: string; home_account: string | null; position: number }

const toSchool = (row: SchoolRow): School => ({
    id: row.id,
    name: row.name,
    shortName: row.short_name,
    subdomain: row.subdomain,
    emailDomain: row.email_domain,
    idLabel: row.id_label,
    idPlaceholder: row.id_placeholder,
    tagline: row.tagline,
    footer: row.footer,
    position: row.position
});

const toVenue = (row: VenueRow): SchoolVenue => ({
    id: row.id,
    schoolId: row.school_id,
    name: row.name,
    rockbotId: row.rockbot_id,
    homeAccount: row.home_account,
    position: row.position
});

const selectSchools = db.prepare("SELECT * FROM schools ORDER BY position, name");
const selectSchool = db.prepare("SELECT * FROM schools WHERE id = ?");
const selectBySubdomain = db.prepare("SELECT * FROM schools WHERE subdomain = ?");
const selectVenues = db.prepare("SELECT * FROM venues ORDER BY position, name");
const selectSchoolVenues = db.prepare("SELECT * FROM venues WHERE school_id = ? ORDER BY position, name");
const selectVenue = db.prepare("SELECT * FROM venues WHERE id = ?");

export const getSchools = () => (selectSchools.all() as unknown as SchoolRow[]).map(toSchool);

export function getSchool(id: string) {
    const row = selectSchool.get(id) as SchoolRow | undefined;
    return row ? toSchool(row) : null;
}

/** The school at the main domain */
export const mainSchool = () => getSchool(MAIN_SCHOOL_ID)!;

/** Every venue, or one school's, in order */
export const getVenues = (schoolId?: string) =>
    ((schoolId ? selectSchoolVenues.all(schoolId) : selectVenues.all()) as unknown as VenueRow[]).map(toVenue);

export function getVenue(id: unknown) {
    if (typeof id !== "string") return null;
    const row = selectVenue.get(id) as VenueRow | undefined;
    return row ? toVenue(row) : null;
}

/** The school a frontend hostname belongs to, like zotify.app or uf.zotify.app. Null for any other host */
export function schoolForHost(host: string | undefined) {
    const name = host?.toLowerCase().trim();
    if (!name) return null;
    // Zotify Meals (meals.zotify.app) is the main school's
    if (name === SITE_DOMAIN || name === `${MEALS_SUBDOMAIN}.${SITE_DOMAIN}`) return mainSchool();
    if (!name.endsWith(`.${SITE_DOMAIN}`)) return null;

    const row = selectBySubdomain.get(name.slice(0, -SITE_DOMAIN.length - 1)) as SchoolRow | undefined;
    return row ? toSchool(row) : null;
}

/** The school a request's Origin header belongs to, like https://uf.zotify.app. Null for anything else */
export function schoolForOrigin(origin: string | undefined) {
    if (!origin) return null;

    try {
        // https in production, http in development, like the main site
        const url = new URL(origin);
        return url.protocol === new URL(siteUrl(null)).protocol ? schoolForHost(url.host) : null;
    } catch {
        return null;
    }
}

/** Where a school's Zotify is */
export const schoolUrl = (school: School) => siteUrl(school.subdomain);

/** What the frontend needs to know about a school: its name, sign-in details, wording and venues */
export function publicSchool(school: School) {
    return {
        id: school.id,
        name: school.name,
        shortName: school.shortName,
        subdomain: school.subdomain,
        emailDomain: school.emailDomain,
        idLabel: school.idLabel,
        idPlaceholder: school.idPlaceholder,
        tagline: school.tagline,
        footer: school.footer,
        url: schoolUrl(school),
        venues: getVenues(school.id).map(venue => ({ id: venue.id, name: venue.name }))
    };
}

// Editing, for site admins

// Subdomains that already mean something, or would be confusing
const RESERVED_SUBDOMAINS = ["api", "www", "admin", "app", "mail", "static", MEALS_SUBDOMAIN, DOCS_SUBDOMAIN];

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;

const text = (value: unknown, max: number) => typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;

export interface SchoolInput {
    id?: unknown; name?: unknown; shortName?: unknown; subdomain?: unknown; emailDomain?: unknown;
    idLabel?: unknown; idPlaceholder?: unknown; tagline?: unknown; footer?: unknown;
}

/** Adds a school, or updates one when its id exists. The main school stays at the main domain; every other one needs a subdomain */
export function saveSchool(input: SchoolInput) {
    const id = text(input.id, 32)?.toLowerCase();
    if (!id || !SLUG.test(id)) throw new SchoolConfigError("Give the school a short ID of lowercase letters, numbers and dashes, like uf.");

    const name = text(input.name, 80);
    const shortName = text(input.shortName, 20);
    if (!name || !shortName) throw new SchoolConfigError("Give the school a name and a short name.");

    const isMain = id === MAIN_SCHOOL_ID;
    const subdomain = isMain ? null : text(input.subdomain, 32)?.toLowerCase() ?? null;

    if (!isMain) {
        if (!subdomain || !SLUG.test(subdomain)) throw new SchoolConfigError("Give the school a subdomain of lowercase letters, numbers and dashes.");
        if (RESERVED_SUBDOMAINS.includes(subdomain)) throw new SchoolConfigError(`${subdomain}.${SITE_DOMAIN} is reserved.`);

        const taken = selectBySubdomain.get(subdomain) as SchoolRow | undefined;
        if (taken && taken.id !== id) throw new SchoolConfigError(`${subdomain}.${SITE_DOMAIN} is already ${taken.name}'s.`, 409);
    }

    const emailDomain = text(input.emailDomain, 100)?.toLowerCase().replace(/^@/, "") ?? null;
    if (emailDomain && !DOMAIN.test(emailDomain)) throw new SchoolConfigError("The email domain should look like ufl.edu.");

    const existing = getSchool(id);
    const position = existing?.position ?? getSchools().length;

    db.prepare(`
        INSERT INTO schools (id, name, short_name, subdomain, email_domain, id_label, id_placeholder, tagline, footer, position, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET name = excluded.name, short_name = excluded.short_name, subdomain = excluded.subdomain,
            email_domain = excluded.email_domain, id_label = excluded.id_label, id_placeholder = excluded.id_placeholder,
            tagline = excluded.tagline, footer = excluded.footer
    `).run(id, name, shortName, subdomain, emailDomain, text(input.idLabel, 40), text(input.idPlaceholder, 40),
        text(input.tagline, 120), text(input.footer, 120), position, Date.now());

    return getSchool(id)!;
}

/** Removes a school with no venues left. The main school can't be removed */
export function deleteSchool(id: string) {
    if (id === MAIN_SCHOOL_ID) throw new SchoolConfigError("The main school can't be removed.");
    if (!getSchool(id)) throw new SchoolConfigError("There's no such school.", 404);
    if (getVenues(id).length) throw new SchoolConfigError("Remove the school's venues first.", 409);

    transaction(() => {
        db.prepare("DELETE FROM school_admins WHERE school_id = ?").run(id);
        db.prepare("DELETE FROM schools WHERE id = ?").run(id);
    });
}

export interface VenueInput { id?: unknown; schoolId?: unknown; name?: unknown; rockbotId?: unknown; homeAccount?: unknown }

/** Adds a venue, or updates one when its id exists. A venue's id and school never change, since its history is kept under them */
export function saveVenue(input: VenueInput) {
    const id = text(input.id, 32)?.toLowerCase();
    if (!id || !SLUG.test(id)) throw new SchoolConfigError("Give the venue an ID of lowercase letters, numbers and dashes, like the-eatery.");

    const existing = getVenue(id);
    const schoolId = existing?.schoolId ?? text(input.schoolId, 32);
    if (!schoolId || !getSchool(schoolId)) throw new SchoolConfigError("There's no such school.", 404);
    if (existing && input.schoolId !== undefined && input.schoolId !== existing.schoolId) {
        throw new SchoolConfigError("A venue can't move to another school. Add a new venue there instead.");
    }

    const name = text(input.name, 80);
    if (!name) throw new SchoolConfigError("Give the venue a name.");

    const rockbotId = text(input.rockbotId, 20);
    if (!rockbotId || !/^\d+$/.test(rockbotId)) throw new SchoolConfigError("The Rockbot ID is a number, like 104128.");

    const homeAccount = text(input.homeAccount, 64);
    if (homeAccount) {
        if (!db.prepare("SELECT 1 FROM rockbot_accounts WHERE username = ?").get(homeAccount)) {
            throw new SchoolConfigError(`There's no Rockbot account called ${homeAccount}.`);
        }

        const other = db.prepare("SELECT name FROM venues WHERE home_account = ? AND id != ?").get(homeAccount, id) as { name: string } | undefined;
        if (other) throw new SchoolConfigError(`${homeAccount} is already ${other.name}'s home account.`, 409);
    }

    const position = existing?.position ?? getVenues(schoolId).length;

    db.prepare(`
        INSERT INTO venues (id, school_id, name, rockbot_id, home_account, position) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET name = excluded.name, rockbot_id = excluded.rockbot_id, home_account = excluded.home_account
    `).run(id, schoolId, name, rockbotId, homeAccount, position);

    return getVenue(id)!;
}

/** Removes a venue. Its pick history stays; songs still waiting in Zotify's queue there are dropped */
export function deleteVenue(id: string) {
    if (!getVenue(id)) throw new SchoolConfigError("There's no such venue.", 404);

    transaction(() => {
        db.prepare("UPDATE zotify_queue SET status = 'removed' WHERE venue = ? AND status = 'waiting'").run(id);
        db.prepare("DELETE FROM venues WHERE id = ?").run(id);
    });
}

// School admins

export const getSchoolAdmins = (schoolId: string) =>
    (db.prepare("SELECT email FROM school_admins WHERE school_id = ? ORDER BY added_at").all(schoolId) as { email: string }[]).map(row => row.email);

export const isSchoolAdminEmail = (schoolId: string, email: string) =>
    !!db.prepare("SELECT 1 FROM school_admins WHERE school_id = ? AND email = ?").get(schoolId, email);

export function addSchoolAdmin(schoolId: string, email: string) {
    if (!getSchool(schoolId)) throw new SchoolConfigError("There's no such school.", 404);
    db.prepare("INSERT OR IGNORE INTO school_admins (school_id, email, added_at) VALUES (?, ?, ?)").run(schoolId, email, Date.now());
}

export function removeSchoolAdmin(schoolId: string, email: string) {
    db.prepare("DELETE FROM school_admins WHERE school_id = ? AND email = ?").run(schoolId, email);
}
