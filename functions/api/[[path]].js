import { json } from '../_shared/auth.js';

// Any /api address that doesn't exist gets a plain "not found" instead of the app page.
export const onRequest = () => json({ error: 'Not found.' }, 404);
