"use client";

import { type ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionProvider } from "next-auth/react";
import { WagmiProvider } from "wagmi";

import { TelegramProvider } from "@/components/telegram-provider";
import { TonConnectProvider } from "@/components/ton-connect-provider";
import { TrpcProvider } from "@/components/trpc-provider";
import { wagmiConfig } from "@/lib/wagmi-config";

const queryClient = new QueryClient();

/** Wagmi v3 requires TanStack Query; we do not use useQuery elsewhere in the app. */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <TrpcProvider queryClient={queryClient}>
          <SessionProvider>
            <TonConnectProvider>
              <TelegramProvider>{children}</TelegramProvider>
            </TonConnectProvider>
          </SessionProvider>
        </TrpcProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
