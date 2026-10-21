import { INTERNAL_API_URL } from "./config";

// Reading the API's OpenAPI description (src/openapi.ts) for the docs' reference: fetching it, following $refs, and turning
// schemas into rows of fields and example JSON

export type Schema = Record<string, any>;

export interface Spec {
    info: { title: string, description: string };
    servers: { url: string }[];
    tags: { name: string, description: string }[];
    paths: Record<string, Record<string, Operation>>;
    components: { schemas: Record<string, Schema>, responses: Record<string, { description: string }> };
}

export interface Operation {
    operationId: string;
    tags: string[];
    summary: string;
    description?: string;
    "x-zotify-access": "public" | "signed-in" | "member" | "admin";
    security: Record<string, string[]>[];
    parameters?: { name: string, in: "path" | "query", required: boolean, description: string, example?: string }[];
    requestBody?: { content: Record<string, { schema: Schema, example?: unknown }> };
    responses: Record<string, { description?: string, $ref?: string, content?: Record<string, { schema: Schema, example?: unknown }> }>;
}

export interface Field {
    name: string;
    type: string;
    // A component schema it is, to link to instead of listing its fields again
    schemaName?: string;
    required: boolean;
    description?: string;
    depth: number;
}

/** A reference section's anchor, from its tag: "Zotify's queue" is #zotify-s-queue */
export const sectionId = (tag: string) => tag.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** The description, from the API on this machine. Null if the API can't be reached */
export async function getSpec(): Promise<Spec | null> {
    try {
        const response = await fetch(`${INTERNAL_API_URL}/v1/openapi.json`, { next: { revalidate: 300 } });
        return response.ok ? await response.json() : null;
    } catch {
        return null;
    }
}

const refName = (schema: Schema) => typeof schema?.$ref === "string" ? schema.$ref.split("/").pop() as string : undefined;

/** A schema with its $ref followed, allOf merged into one object, and "or null" noted as nullable */
export function flatten(spec: Spec, schema: Schema): Schema {
    const name = refName(schema);
    if (name) return flatten(spec, spec.components.schemas[name]);

    if (schema?.allOf) {
        const parts = schema.allOf.map((part: Schema) => flatten(spec, part));
        return {
            type: "object",
            description: schema.description,
            properties: Object.assign({}, ...parts.map((part: Schema) => part.properties ?? {})),
            required: parts.flatMap((part: Schema) => part.required ?? [])
        };
    }

    if (schema?.anyOf) {
        const other = schema.anyOf.find((part: Schema) => part.type !== "null");
        return { ...(refName(other) ? other : flatten(spec, other)), nullable: true, description: schema.description ?? other?.description };
    }

    return schema ?? {};
}

/** How a schema reads in a table, like "string", "array of Station" or "\"up\" | \"down\"" */
export function typeOf(spec: Spec, schema: Schema): { type: string, schemaName?: string } {
    const nullable = schema?.anyOf?.some((part: Schema) => part.type === "null");
    const inner = nullable ? schema.anyOf.find((part: Schema) => part.type !== "null") : schema;
    const suffix = nullable ? " or null" : "";

    const name = refName(inner);
    if (name) return { type: name + suffix, schemaName: name };

    const flat = flatten(spec, inner);
    if (flat.enum) return { type: flat.enum.map((value: unknown) => JSON.stringify(value)).join(" | ") + suffix };

    if (flat.type === "array") {
        const items = typeOf(spec, flat.items ?? {});
        return { type: `array of ${items.type}` + suffix, schemaName: items.schemaName };
    }

    return { type: (flat.type ?? "object") + suffix };
}

/** A schema's fields as rows, nested objects indented. Component schemas link to their own section instead of repeating */
export function fieldsOf(spec: Spec, schema: Schema, depth = 0): Field[] {
    const flat = flatten(spec, schema);
    const target = flat.type === "array" && !refName(flat.items) ? flatten(spec, flat.items) : flat;
    const required = new Set<string>(target.required ?? []);

    return Object.entries<Schema>(target.properties ?? {}).flatMap(([name, property]) => {
        const { type, schemaName } = typeOf(spec, property);
        const flatProperty = flatten(spec, property);
        const nested = !schemaName && depth < 3 && (flatProperty.properties || flatProperty.items?.properties)
            ? fieldsOf(spec, property, depth + 1) : [];

        return [{ name, type, schemaName, required: required.has(name), description: flatProperty.description ?? property.description, depth }, ...nested];
    });
}

/** Made-up JSON for a schema without an example */
export function exampleOf(spec: Spec, schema: Schema, depth = 0): unknown {
    const flat = flatten(spec, schema);

    if (flat.example !== undefined) return flat.example;
    if (flat.enum) return flat.enum[0];
    if (depth > 4) return null;

    switch (flat.type) {
        case "array": return [exampleOf(spec, flat.items ?? {}, depth + 1)];
        case "string": return "string";
        case "integer": return 0;
        case "number": return 0;
        case "boolean": return false;
        case "null": return null;
        default: return Object.fromEntries(Object.entries<Schema>(flat.properties ?? {}).map(([name, property]) => [name, exampleOf(spec, property, depth + 1)]));
    }
}

/** A curl command for an operation, with its examples filled in */
export function curlFor(spec: Spec, path: string, method: string, operation: Operation) {
    const base = spec.servers[0]?.url ?? "";
    const params = operation.parameters ?? [];
    let url = path.replace(/\{(\w+)\}/g, (_, name) => params.find(param => param.name === name)?.example ?? `{${name}}`);

    const query = params.filter(param => param.in === "query" && (param.required || param.example)).slice(0, 2);
    if (query.length) url += "?" + query.map(param => `${param.name}=${encodeURIComponent(param.example ?? "")}`).join("&");

    const lines = [`curl${method === "get" ? "" : ` -X ${method.toUpperCase()}`} "${base}${url}"`];
    if (operation["x-zotify-access"] !== "public") lines.push(`-H "Authorization: Bearer $ZOTIFY_TOKEN"`);

    const json = operation.requestBody?.content["application/json"];
    if (json) {
        lines.push(`-H "Content-Type: application/json"`);
        lines.push(`-d '${JSON.stringify(json.example ?? exampleOf(spec, json.schema))}'`);
    }

    return lines.join(" \\\n  ");
}
