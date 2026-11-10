import "server-only";
import { connection } from "next/server";
import { CrumbError } from "./core";
import { PayPalError } from "./paypal";
import { ensureSeed } from "./seed";

/** Wrap a route handler: seed demo data once, map errors to JSON. */
export function route<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    // Request-time only: never execute API handlers (or touch the database) during the build's prerender.
    await connection();
    try {
      await ensureSeed();
      return await fn(...args);
    } catch (err) {
      if (err instanceof CrumbError) return Response.json({ error: err.message, code: err.code }, { status: err.status });
      if (err instanceof PayPalError) {
        console.error("[paypal]", err.message, err.debugId, JSON.stringify(err.details));
        return Response.json(
          { error: err.message, code: "paypal_error", debugId: err.debugId },
          { status: err.status >= 500 ? 502 : 400 },
        );
      }
      console.error(err);
      return Response.json({ error: (err as Error).message ?? "Unexpected error", code: "internal" }, { status: 500 });
    }
  };
}

/** Demo-grade shop auth: a PIN in a header. Good enough for a sandbox demo, documented in the README. */
export function requireShop(req: Request) {
  const pin = req.headers.get("x-shop-pin");
  const expected = process.env.SHOP_PIN || "2468";
  if (pin !== expected) throw new CrumbError("Shop PIN required", 401, "unauthorized");
}

export async function body<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new CrumbError("Invalid JSON body");
  }
}

export function baseUrl(req: Request) {
  return process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, "") || new URL(req.url).origin;
}
