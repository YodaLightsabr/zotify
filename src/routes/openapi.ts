import type { Request, Response } from "express";
import { spec } from "../openapi.js";

/** The API's OpenAPI 3.1 description, which docs.zotify.app is built from */
export function openApi(_req: Request, res: Response) {
    res.set("Cache-Control", "public, max-age=300").json(spec);
}
