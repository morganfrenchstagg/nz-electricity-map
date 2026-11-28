// Serves each page's Markdown to agents that ask for it (see app/edge/markdown.ts).
// `wrangler pages deploy` builds this folder, from the folder it runs in.
export { onRequest } from '../app/edge/markdown'
