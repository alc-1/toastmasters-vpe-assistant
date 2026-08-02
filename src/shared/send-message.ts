// src/shared/send-message.ts
//
// Typed chrome.runtime.sendMessage() client for popup/index.ts. Pairs with
// the Request/ResponseFor<M> discriminated union in shared/types.ts and
// background/messaging.ts's exhaustive switch on message.type.

import type { Request, ResponseFor } from "./types";

export async function sendMessage<M extends Request>(message: M): Promise<ResponseFor<M>> {
  return chrome.runtime.sendMessage(message);
}
