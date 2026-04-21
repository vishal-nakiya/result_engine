import crypto from "node:crypto";

export function newId() {
  return crypto.randomUUID();
}

