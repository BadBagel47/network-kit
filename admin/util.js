// Small helpers the admin page's stores share (D-111: they were written twice).
export const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const hashText = async (text) => b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
export const day = (ms) => new Date(ms).toISOString().slice(0, 10);
