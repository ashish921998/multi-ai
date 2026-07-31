/**
 * Browser-safe Convex function references.
 *
 * This intentionally re-exports Convex codegen output instead of importing the
 * backend modules themselves. Backend `query`/`mutation` registrations are not
 * valid client function references and crash React before it can mount.
 */
export { api } from "./_generated/api";
