import { VertexAI } from '@google-cloud/vertexai';

const vertex = new VertexAI({ project: 'acme-shop', location: 'us-central1' });
// Newer models are tested in tags.next.ts.
export const model = vertex.getGenerativeModel({ model: 'gemini-2.5-flash' });
export const fallback = 'gpt-4o-mini';
