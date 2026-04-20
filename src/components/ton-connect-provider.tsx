"use client";

import { useMemo, type ReactNode } from "react";

import type { WalletInfoRemote } from "@tonconnect/ui";
import { TonConnectUIProvider } from "@tonconnect/ui-react";

const TELEGRAM_WALLET: WalletInfoRemote = {
  appName: "telegram-wallet",
  name: "Wallet",
  imageUrl: "https://wallet.tg/images/logo-288.png",
  aboutUrl: "https://wallet.tg/",
  universalLink: "https://t.me/wallet/start",
  bridgeUrl: "https://bridge.tonapi.io/bridge",
  platforms: ["ios", "android", "macos", "windows", "linux"],
};

const DEFAULT_MANIFEST_URL = "https://expert-network.vercel.app/api/tonconnect-manifest";
const TELEGRAM_TWA_RETURN_URL = process.env.NEXT_PUBLIC_TELEGRAM_TWA_RETURN_URL?.trim() as
  | `${string}://${string}`
  | undefined;

export function TonConnectProvider({ children }: { children: ReactNode }) {
  const manifestUrl = useMemo(() => {
    if (typeof window === "undefined") return DEFAULT_MANIFEST_URL;
    return `${window.location.origin}/api/tonconnect-manifest`;
  }, []);

  return (
    <TonConnectUIProvider
      manifestUrl={manifestUrl}
      walletsListConfiguration={{ includeWallets: [TELEGRAM_WALLET] }}
      {...(TELEGRAM_TWA_RETURN_URL
        ? {
            actionsConfiguration: {
              twaReturnUrl: TELEGRAM_TWA_RETURN_URL,
            },
          }
        : {})}
    >
      {children}
    </TonConnectUIProvider>
  );
}
