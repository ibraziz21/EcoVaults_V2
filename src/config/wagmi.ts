import { http, cookieStorage, createStorage } from 'wagmi'
import { createConfig } from 'wagmi'
import { optimism } from 'wagmi/chains'
import { safe, injected, walletConnect } from 'wagmi/connectors'

const wcProjectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ||
  process.env.NEXT_PUBLIC_REOWN_PROJECT_ID

export const wagmiConfig = createConfig({
  ssr: true,

  storage: createStorage({
    storage:
      typeof window !== 'undefined'
        ? window.localStorage
        : cookieStorage,
  }),

  chains: [optimism],
  transports: {
    [optimism.id]: http('https://mainnet.optimism.io'),
  },

  connectors: [
    safe({
      // Accept all Safe hosts we use (main + OP hosts)
      allowedDomains: [
        /app\.safe\.global$/,
        /.*\.safe\.global$/,
        /safe\.optimism\.io$/,
        /.*\.safe\.optimism\.io$/,
        /account\.superchain\.eco$/,
        /.*\.superchain\.eco$/,
      ],
    }),
    ...(wcProjectId
      ? [walletConnect({ projectId: wcProjectId, showQrModal: true })]
      : []),
    injected(),
  ],
})
