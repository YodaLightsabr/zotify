import type { Request, Response } from "express";

export function status(_req: Request, res: Response) {
    res.type("text/plain").send("OK");
}
