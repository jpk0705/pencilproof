export const CHECKOUT_URL = "https://audit.pencilproof.com/handoff";
export const QUOTE_HANDOFF_KEY = "pencilproof:pending-import";

export const checkoutUrlForQuote = (serializedQuote: string) =>
  `${CHECKOUT_URL}#${encodeURIComponent(serializedQuote)}`;
