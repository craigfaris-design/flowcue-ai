// Placeholder single-user scoping until real auth (Auth0/Clerk per Technical
// Architecture §4.1) is wired in. Every row in the schema already carries this
// as its user_id default, so swapping in real auth is a middleware change,
// not a schema migration.
export const DEV_USER_ID = "00000000-0000-0000-0000-000000000001";
