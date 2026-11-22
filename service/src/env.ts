/** LINK_KEY seals reviewer tokens at rest (src/linkcrypt.ts); without it, links can't be copied again. */
export type Env = { DB: D1Database; SHOTS: R2Bucket; OWNER_TOKEN: string; LINK_KEY?: string };
