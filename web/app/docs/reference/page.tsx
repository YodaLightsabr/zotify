import { Fragment } from "react";
import Code from "@/components/docs/Code";
import { curlFor, exampleOf, fieldsOf, getSpec, sectionId, type Field, type Operation, type Spec } from "@/lib/openapi";

export const metadata = { title: "API reference" };

const METHODS = ["get", "post", "put", "patch", "delete"];

const ACCESS: Record<Operation["x-zotify-access"], string> = {
    public: "No token needed",
    "signed-in": "Any signed-in person",
    member: "Members of the venue's or school's Zotify",
    admin: "The school's admins"
};

/** Every route, grouped like the sidebar, from the API's OpenAPI description */
export default async function Reference() {
    const spec = await getSpec();

    if (!spec) {
        return (
            <article className="docs-article">
                <h1>API reference</h1>
                <p>The reference couldn&apos;t be loaded just now. Try again in a moment.</p>
            </article>
        );
    }

    const operations = Object.entries(spec.paths).flatMap(([path, methods]) =>
        METHODS.filter(method => methods[method]).map(method => ({ path, method, operation: methods[method] })));

    return (
        <article className="docs-article docs-reference">
            <h1>API reference</h1>
            <p className="docs-lead">
                Every route a token can use, with examples. It&apos;s built from the API&apos;s OpenAPI description,{" "}
                <a href={`${spec.servers[0]?.url}/v1/openapi.json`}><code>/v1/openapi.json</code></a>.
            </p>

            {spec.tags.map(tag => (
                <section key={tag.name} id={sectionId(tag.name)} className="docs-section">
                    <h2>{tag.name}</h2>
                    <p>{tag.description}</p>
                    {operations.filter(({ operation }) => operation.tags.includes(tag.name)).map(({ path, method, operation }) => (
                        <Endpoint key={operation.operationId} spec={spec} path={path} method={method} operation={operation} />
                    ))}
                </section>
            ))}

            <section id="schemas" className="docs-section">
                <h2>Objects</h2>
                <p>Objects that come up in more than one place.</p>
                {Object.entries(spec.components.schemas).map(([name, schema]) => (
                    <div key={name} id={`schema-${name}`} className="docs-schema">
                        <h3>{name}</h3>
                        {schema.description && <p>{schema.description}</p>}
                        <Fields spec={spec} fields={fieldsOf(spec, schema)} />
                    </div>
                ))}
            </section>
        </article>
    );
}

function Endpoint({ spec, path, method, operation }: { spec: Spec, path: string, method: string, operation: Operation }) {
    const scopes = [...new Set(operation.security.flatMap(requirement => Object.values(requirement).flat()))];
    const body = operation.requestBody && Object.entries(operation.requestBody.content)[0];
    const [status, success] = Object.entries(operation.responses).find(([code]) => code.startsWith("2")) ?? [];
    const content = success?.content?.["application/json"];
    const errors = Object.keys(operation.responses).filter(code => !code.startsWith("2"));

    return (
        <div className="docs-endpoint" id={operation.operationId}>
            <h3>
                <a href={`#${operation.operationId}`}>
                    <span className={`docs-method ${method}`}>{method.toUpperCase()}</span> <code>{path}</code>
                </a>
            </h3>
            <p className="docs-summary">{operation.summary}</p>
            <p className="docs-badges">
                <span className="docs-badge">{ACCESS[operation["x-zotify-access"]]}</span>
                {scopes.map(scope => <span key={scope} className="docs-badge scope">{scope}</span>)}
            </p>
            {operation.description?.split("\n\n").map((paragraph, i) => <p key={i}>{paragraph}</p>)}

            {!!operation.parameters?.length && <>
                <h4>Parameters</h4>
                <table className="docs-table docs-fields">
                    <tbody>
                        {operation.parameters.map(param => (
                            <tr key={param.name}>
                                <td><code>{param.name}</code>{param.required && <span className="docs-required">required</span>}</td>
                                <td className="docs-type">{param.in === "path" ? "in the path" : "query"}</td>
                                <td>{param.description}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </>}

            {body && <>
                <h4>Body <span className="docs-type">{body[0]}</span></h4>
                <Fields spec={spec} fields={fieldsOf(spec, body[1].schema)} requiredLabel="required" />
            </>}

            <h4>Response <span className="docs-type">{status}</span></h4>
            {success?.description && <p>{success.description}</p>}
            {content && <Fields spec={spec} fields={fieldsOf(spec, content.schema)} />}

            {errors.length > 0 && (
                <p className="docs-errors">
                    Errors: {errors.map((code, i) => <Fragment key={code}>{i > 0 && ", "}<a href="/conventions#errors">{code}</a></Fragment>)}
                </p>
            )}

            <div className="docs-examples">
                {!path.startsWith("/v1/oauth") && <Code label="Request">{curlFor(spec, path, method, operation)}</Code>}
                {content && <Code label="Response">{JSON.stringify(content.example ?? exampleOf(spec, content.schema), null, 2)}</Code>}
            </div>
        </div>
    );
}

/** Fields as rows. requiredLabel marks the required ones: "required" in requests, "always" in responses */
function Fields({ spec, fields, requiredLabel = "always" }: { spec: Spec, fields: Field[], requiredLabel?: string }) {
    if (!fields.length) return null;

    return (
        <table className="docs-table docs-fields">
            <tbody>
                {fields.map((field, i) => (
                    <tr key={i}>
                        <td style={{ paddingLeft: `${8 + field.depth * 18}px` }}>
                            <code>{field.name}</code>{field.required && field.depth === 0 && <span className="docs-required">{requiredLabel}</span>}
                        </td>
                        <td className="docs-type">
                            {field.schemaName && spec.components.schemas[field.schemaName]
                                ? <a href={`#schema-${field.schemaName}`}>{field.type}</a>
                                : field.type}
                        </td>
                        <td>{field.description}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}
