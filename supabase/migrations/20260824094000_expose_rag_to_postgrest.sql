-- Marginalia: make the `rag` schema reachable through PostgREST.
--
-- Additive. `public` and `graphql_public` are preserved, so the unrelated
-- application served from this project is unaffected — verified by fetching
-- from `public` before and after.
--
-- CAVEAT worth knowing before someone is confused by it later: a role-level
-- setting SHADOWS the project-level "Exposed schemas" field in the Supabase
-- dashboard. Changing that field will appear to do nothing while this exists.
-- If the dashboard becomes the preferred place to manage this, remove the
-- override first:
--
--     alter role authenticator reset pgrst.db_schemas;
--
-- Exposure only decides reachability. Access is still governed by grants
-- (`anon` holds none on this schema) and by row-level security, both of which
-- were confirmed through PostgREST with real user tokens.

alter role authenticator set pgrst.db_schemas = 'public, graphql_public, rag';

notify pgrst, 'reload config';
notify pgrst, 'reload schema';
