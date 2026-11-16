/**
 * The open loops' pure rules and helpers — what a question, a request and a "later" are, when a loop is overdue, whether a reply is about a promise — and the
 * few small things they read. No Zeff code beyond them, so the Open loops plugin bundles it (scripts/port-loops.mts). Client-safe.
 */
export { OVERDUE_DAYS, SNOOZE_DAYS, addressedTo, isDeferral, isOverdue, isQuestion, isRequest, isSendPromise, sharesTopic } from "./shared";
export { flatSlice } from "@/lib/text";
export { CLOSE_INSTRUCTIONS, CLOSE_SCHEMA } from "./close-prompt";
/** WhatsApp's own lines (a changed number, the encryption notice …): no conversation. The same as lib/mail/store.ts WA_SYSTEM. */
export const WA_SYSTEM = /^\u202a?\s*(\+?[\d\s]+ wurde in \+?[\d\s]+ geändert|\+?[\d\s]+ changed (their phone number|to \+?[\d\s]+)|\d+ (ungelesene Nachricht(en)?|unread messages?)\b|.{0,80} hat (dich|die Gruppe|den Gruppennamen|das Gruppenbild)|.{0,80} (added you|created group|changed the group)|Nachrichten und Anrufe sind Ende-zu-Ende-verschlüsselt|Messages and calls are end-to-end encrypted|Deine Sicherheitsnummer|Your security code)/i;
