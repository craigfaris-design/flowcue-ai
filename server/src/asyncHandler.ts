import type { NextFunction, Request, Response } from "express";

/**
 * Express 4 does not forward a rejected promise from an async handler to
 * error middleware -- it becomes an unhandled rejection, which crashes the
 * whole process (not just the one request). Confirmed via code review:
 * any DB error (a lost connection, a constraint violation, even something
 * as ordinary as an invalid UUID in a route param) took down the entire
 * server for every in-flight request, not just the one that hit it.
 * Wrapping every async handler in this forwards the rejection to Express's
 * error-handling middleware (see app.ts) instead.
 */
export function asyncHandler<Req extends Request = Request>(
  fn: (req: Req, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Req, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}
