"use client";

import { useCallback, useState } from "react";

import {
  inferVoiceChatTranslationTarget,
  type VoiceChatTranslationTarget,
} from "@/lib/voice-chat-translation";

export interface VoiceChatTranslationState {
  error?: string;
  status: "loading" | "ready" | "error";
  targetLanguage: VoiceChatTranslationTarget;
  translatedText?: string;
  visible: boolean;
}

export function useVoiceChatTranslations() {
  const [translations, setTranslations] = useState<
    Record<string, VoiceChatTranslationState>
  >({});

  const toggleTranslation = useCallback(async (messageId: string, text: string) => {
    const existing = translations[messageId];
    if (existing?.status === "loading") return;

    if (existing?.status === "ready") {
      setTranslations((prev) => ({
        ...prev,
        [messageId]: { ...existing, visible: !existing.visible },
      }));
      return;
    }

    const targetLanguage = existing?.targetLanguage ?? inferVoiceChatTranslationTarget(text);
    setTranslations((prev) => ({
      ...prev,
      [messageId]: {
        status: "loading",
        targetLanguage,
        visible: true,
      },
    }));

    try {
      const res = await fetch("/api/voice-chat/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ text, targetLanguage }),
      });
      const data = (await res.json()) as {
        error?: string;
        translatedText?: string;
      };

      if (!res.ok || !data.translatedText) {
        throw new Error(data.error || `Server error ${res.status}`);
      }

      setTranslations((prev) => ({
        ...prev,
        [messageId]: {
          status: "ready",
          targetLanguage,
          translatedText: data.translatedText,
          visible: true,
        },
      }));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not translate this message.";
      setTranslations((prev) => ({
        ...prev,
        [messageId]: {
          error: message,
          status: "error",
          targetLanguage,
          visible: true,
        },
      }));
    }
  }, [translations]);

  const resetTranslations = useCallback(() => {
    setTranslations({});
  }, []);

  return { resetTranslations, toggleTranslation, translations };
}
