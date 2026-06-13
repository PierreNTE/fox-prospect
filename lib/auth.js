// Jeton de session : empreinte SHA-256 de user:password + sel applicatif.
// Compatible Edge (middleware) et Node (routes API) : Web Crypto uniquement.
// Si le mot de passe change, tous les cookies existants deviennent invalides.

export const SESSION_COOKIE = "fox_session";

export async function sessionToken(user, password) {
  const data = new TextEncoder().encode(`${user}:${password}:fox-session-v1`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
