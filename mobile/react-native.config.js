/**
 * Clerk's web package brings in an optional Solana wallet adapter. PencilProof
 * does not use wallet connections, so keep that optional native module out of
 * the Android build (it also avoids an unnecessary Windows path-length issue).
 */
module.exports = {
  dependencies: {
    '@solana-mobile/mobile-wallet-adapter-protocol': {
      platforms: {
        android: null,
        ios: null,
      },
    },
  },
};
