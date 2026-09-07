export const UNLOCK_AT_KEY = "finance.unlockedAt";
export const WEBAUTHN_ID_KEY = "finance.webauthn.id";
export const AUTO_LOCK_OPTIONS = [0, 30, 60, 120, 300] as const;

export function readUnlockAt(storage: Pick<Storage, "getItem">): number | null {
  const raw = storage.getItem(UNLOCK_AT_KEY);
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function writeUnlockAt(storage: Pick<Storage, "setItem">, at: number): void {
  storage.setItem(UNLOCK_AT_KEY, String(at));
}

export function clearUnlock(storage: Pick<Storage, "removeItem">): void {
  storage.removeItem(UNLOCK_AT_KEY);
}

export function isUnlockValid(
  unlockedAt: number | null,
  autoLockSeconds: number,
  now: number,
): boolean {
  if (unlockedAt == null) return false;
  if (autoLockSeconds <= 0) return true;
  return now - unlockedAt < autoLockSeconds * 1000;
}

export function autoLockLabel(seconds: number): string {
  if (seconds <= 0) return "Until you close the tab";
  if (seconds < 60) return `${seconds} seconds`;
  if (seconds === 60) return "1 minute";
  return `${Math.round(seconds / 60)} minutes`;
}

export function isPinDigits(value: string): boolean {
  return /^\d{4,6}$/.test(value);
}

export function biometricAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.PublicKeyCredential === "function";
}

export function readWebauthnId(storage: Pick<Storage, "getItem">): string | null {
  return storage.getItem(WEBAUTHN_ID_KEY);
}

export function writeWebauthnId(storage: Pick<Storage, "setItem">, id: string): void {
  storage.setItem(WEBAUTHN_ID_KEY, id);
}

export function clearWebauthnId(storage: Pick<Storage, "removeItem">): void {
  storage.removeItem(WEBAUTHN_ID_KEY);
}

function bufferToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function b64ToBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export async function registerBiometric(rpId: string): Promise<string> {
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: "Finance OS", id: rpId },
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)),
        name: "finance",
        displayName: "Finance OS",
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "preferred",
      },
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("Biometrics were cancelled.");
  return bufferToB64(cred.rawId);
}

export async function assertBiometric(rpId: string, credentialId: string): Promise<boolean> {
  const cred = await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rpId,
      allowCredentials: [{ type: "public-key", id: b64ToBuffer(credentialId) }],
      userVerification: "required",
      timeout: 60_000,
    },
  });
  return cred != null;
}
