"use client";
// Face ID on this phone (Nov 12), for ordering. The WebAuthn helper (about 4 KB) comes with the app (Nov 19, review):
// Safari shows Face ID only straight from a tap, and loading it at the tap (when loading ahead had failed, offline)
// put a wait between the tap and Face ID, so Safari refused it.
import { startAuthentication, startRegistration, WebAuthnError, type PublicKeyCredentialCreationOptionsJSON, type PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { api } from "./api";

/**
 * Whether this phone approves with its own Face ID (Nov 18: Robin approved each checkout step by scanning a code with
 * Sam's phone, the same approval): "here" once it has, "elsewhere" after an approval made on another phone, so the app
 * can offer to set it up here. Kept on this phone only; a phone that can't keep it just isn't offered.
 */
export const WHERE = "simmer:face-id-where";
export function faceIdWhere(): "here" | "elsewhere" | "" {
  try { const v = localStorage.getItem(WHERE); return v === "here" || v === "elsewhere" ? v : ""; } catch { return ""; }
}
function noteWhere(response: { authenticatorAttachment?: string | null }) {
  const v = response.authenticatorAttachment === "platform" ? "here" : response.authenticatorAttachment === "cross-platform" ? "elsewhere" : "";
  try { if (v) localStorage.setItem(WHERE, v); } catch { /* not kept: no offer */ }
  if (v) window.dispatchEvent(new Event(WHERE)); // the Check out sheet showing hears it at once
}

/**
 * Face ID on this phone (Nov 12). Safari only shows Face ID straight from a tap, so the options are fetched before the
 * tap (`faceIdSetUpOptions` and the like) and these are called at the tap with them; the server's answer comes after.
 * Cancelling Face ID, or anything else going wrong, comes back as an Error in plain words.
 */
export async function setUpFaceId(options: PublicKeyCredentialCreationOptionsJSON, onAnswer?: () => void): Promise<number> {
  const response = await faceId(() => startRegistration({ optionsJSON: options }));
  noteWhere({ authenticatorAttachment: "platform" });
  onAnswer?.();
  return (await api.faceIdRegister(response)).count;
}
/** A Face ID answer to send with something that needs it (a settings change, Nov 13). */
export const faceIdAnswer = (options: PublicKeyCredentialRequestOptionsJSON) => faceId(() => startAuthentication({ optionsJSON: options })).then((r) => { noteWhere(r); return r; });

/** A phone with Face ID approves the new phone waiting (the options are bound to that one request). */
export async function approveWithFaceId(options: PublicKeyCredentialRequestOptionsJSON, onAnswer?: () => void): Promise<void> {
  const response = await faceId(() => startAuthentication({ optionsJSON: options }));
  noteWhere(response);
  onAnswer?.();
  await api.faceIdApprove(response);
}
async function faceId<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof WebAuthnError && e.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") throw new Error("Face ID is already set up here.");
    if (e instanceof Error && (e.name === "NotAllowedError" || e.name === "AbortError")) throw new Error("Face ID was cancelled, or didn't finish in time.");
    throw new Error("Face ID isn't available here.");
  }
}
