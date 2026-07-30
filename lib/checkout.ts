export const CHECKOUT_URL = "https://audit.pencilproof.com/handoff";
export const QUOTE_HANDOFF_KEY = "pencilproof:pending-import";
export const QUOTE_HANDOFF_TYPE = "pencilproof:quote-handoff:v1";

export const createQuoteHandoffEnvelope = (payload: unknown) =>
  JSON.stringify({
    type: QUOTE_HANDOFF_TYPE,
    payload,
  });
