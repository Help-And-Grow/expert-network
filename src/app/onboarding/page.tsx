"use client";

import { useEffect, useRef, useState, useCallback } from "react";

import { useRouter } from "next/navigation";


import { useTonConnectUI, useTonWallet } from "@tonconnect/ui-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2,
  Send,
  SkipForward,
  Check,
  Sparkles,
  Upload,
  FileText,
  Volume2,
  Wallet,
  CheckCircle,
  DollarSign,
  CreditCard,
} from "lucide-react";
import { useSession } from "next-auth/react";

import { AudioPlayer } from "@/components/audio-player";
import { useTelegram } from "@/components/telegram-provider";
import { useInviteGuard } from "@/hooks/use-invite-guard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { VoiceInputButton } from "@/components/voice-input-button";
import { VoiceRecorder } from "@/components/voice-recorder";
import { WeeklyScheduleEditor, type WeeklySchedule } from "@/components/weekly-schedule-editor";
import {
  DOMAINS,
  SOCIAL_PLATFORMS,
  ONBOARDING_STEPS,
} from "@/lib/constants";
import { getTelegramInitData } from "@/lib/telegram";
import { cn } from "@/lib/utils";

type Step =
  | "GREETING"
  | "NICKNAME"
  | "TELEGRAM_ID"
  | "GENDER"
  | "WALLET"
  | "SOCIAL_LINKS"
  | "DOMAINS"
  | "DOCUMENT_UPLOAD"
  | "SESSION_PREFS"
  | "PRICING"
  | "AVAILABILITY"
  | "STRIPE_KYC"
  | "AI_GENERATION"
  | "VOICE_SAMPLE"
  | "PREVIEW";

type Message = {
  id: string;
  role: "ai" | "user";
  content: string;
  type?: "text" | "input" | "chips" | "options";
};

type SocialLinks = Partial<
  Record<(typeof SOCIAL_PLATFORMS)[number]["key"], string>
>;

type GeneratedProfile = {
  bio: string;
  services: { title: string; description: string }[];
  videoScript: string;
  profileImage: string | null;
};

const SESSION_OPTIONS = [
  { value: "ONLINE", label: "Online Only", desc: "Video calls & remote sessions" },
  { value: "OFFLINE", label: "Offline Only", desc: "In-person meetings" },
  { value: "BOTH", label: "Both Online & Offline", desc: "Flexible availability" },
] as const;

function getProgressValue(step: Step): number {
  switch (step) {
    case "GREETING":
    case "NICKNAME":
      return 10;
    case "TELEGRAM_ID":
      return 12;
    case "GENDER":
      return 15;
    case "WALLET":
      return 20;
    case "SOCIAL_LINKS":
    case "DOMAINS":
    case "DOCUMENT_UPLOAD":
    case "SESSION_PREFS":
      return 25;
    case "PRICING":
      return 35;
    case "AVAILABILITY":
      return 42;
    case "STRIPE_KYC":
      return 46;
    case "AI_GENERATION":
      return 50;
    case "VOICE_SAMPLE":
      return 65;
    case "PREVIEW":
      return 75;
    default:
      return 0;
  }
}

export default function OnboardingPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { isTelegram, authDone } = useTelegram();
  const { checked: inviteChecked, hasInvite } = useInviteGuard();
  const [tonConnectUI] = useTonConnectUI();
  const tonWallet = useTonWallet();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatAreaRef = useRef<HTMLDivElement>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [currentStep, setCurrentStep] = useState<Step>("GREETING");
  const [isTyping, setIsTyping] = useState(false);
  const [socialLinks, setSocialLinks] = useState<SocialLinks>({});
  const [selectedDomains, setSelectedDomains] = useState<string[]>([]);
  const [sessionType, setSessionType] = useState<string>("");
  const [generatedProfile, setGeneratedProfile] =
    useState<GeneratedProfile | null>(null);
  const [currentSocialIndex, setCurrentSocialIndex] = useState(0);
  const [inputValue, setInputValue] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editedBio, setEditedBio] = useState("");
  const [editingServiceIndex, setEditingServiceIndex] = useState<number | null>(null);
  const [editedServiceTitle, setEditedServiceTitle] = useState("");
  const [editedServiceDesc, setEditedServiceDesc] = useState("");
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);

  const [userNickName, setUserNickName] = useState("");
  const [selectedGender, setSelectedGender] = useState<string>("");
  const [priceOnline, setPriceOnline] = useState("");
  const [priceOffline, setPriceOffline] = useState("");
  const [onboardSchedule, setOnboardSchedule] = useState<WeeklySchedule>({});
  const [cloningVoice, setCloningVoice] = useState(false);
  const [voiceCloned, setVoiceCloned] = useState(false);
  const [audioIntroUrl, setAudioIntroUrl] = useState<string | null>(null);
  const [generatingDefaultAudio, setGeneratingDefaultAudio] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const [stripeKycLoading, setStripeKycLoading] = useState(false);
  const [stripeKycDone] = useState(false);

  // Track which step-questions have already been added to avoid duplicates
  const addedQuestionsRef = useRef<Set<string>>(new Set());

  const tgInitData = getTelegramInitData();
  const tgHeaders: Record<string, string> = tgInitData
    ? { "x-telegram-init-data": tgInitData }
    : {};

  const nickName =
    userNickName ||
    ((session?.user as { nickName?: string })?.nickName ??
    session?.user?.name ??
    "");

  const addStepMessage = useCallback(
    (stepKey: string, msg: Message, delayMs = 800) => {
      if (addedQuestionsRef.current.has(stepKey)) return;
      addedQuestionsRef.current.add(stepKey);

      const run = async () => {
        setIsTyping(true);
        await new Promise((r) => setTimeout(r, delayMs));
        setIsTyping(false);
        setMessages((prev) => [...prev, msg]);
      };
      run();
    },
    []
  );

  useEffect(() => {
    if (status === "unauthenticated" && !isTelegram) {
      router.push("/auth/signin?role=expert");
      return;
    }
    if (status === "authenticated") {
      const userRole = (session?.user as { role?: string })?.role;
      if (userRole !== "EXPERT") {
        fetch("/api/user", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...tgHeaders },
          body: JSON.stringify({ role: "EXPERT" }),
        }).catch(console.error);
      }
    }
  }, [status, session, router, isTelegram]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  // Auto-focus the text input when switching to a step that has one
  useEffect(() => {
    const stepsWithInput: Step[] = ["NICKNAME", "TELEGRAM_ID", "SOCIAL_LINKS"];
    if (stepsWithInput.includes(currentStep)) {
      setTimeout(() => textInputRef.current?.focus(), 100);
    }
  }, [currentStep, currentSocialIndex]);

  // Greeting — trigger when NextAuth session is authenticated, or when
  // Telegram auth has completed (the cookie is set but useSession may lag)
  const canStartOnboarding = status === "authenticated" || (isTelegram && authDone);

  useEffect(() => {
    if (!canStartOnboarding || messages.length > 0) return;

    const addGreeting = async () => {
      addedQuestionsRef.current.add("greeting");
      setIsTyping(true);
      await new Promise((r) => setTimeout(r, 800));
      setIsTyping(false);
      setMessages([
        {
          id: "greeting",
          role: "ai",
          content:
            "Hey! Welcome to Help & Grow — the AI Native Expert Network for Singapore & Southeast Asia. Everyone's both expert and learner here; let's set up your profile so others can find you. About 2 minutes.",
          type: "text",
        },
      ]);

      await new Promise((r) => setTimeout(r, 800));
      setMessages((prev) => [
        ...prev,
        {
          id: "ask-nickname",
          role: "ai",
          content: "First, what should we call you? (Your display name)",
          type: "input",
        },
      ]);
      setCurrentStep("NICKNAME");
    };

    addGreeting();
  }, [canStartOnboarding, messages.length]);

  // Gender selection
  useEffect(() => {
    if (currentStep !== "GENDER") return;
    addStepMessage("gender", {
      id: "gender",
      role: "ai",
      content: `Nice to meet you, ${userNickName || "there"}! How should we set your default voice?`,
      type: "options",
    });
  }, [currentStep, addStepMessage, userNickName]);

  // Wallet step — TON Connect
  useEffect(() => {
    if (currentStep !== "WALLET") return;
    addStepMessage("wallet", {
      id: "wallet",
      role: "ai",
      content:
        "Let's set up your TON wallet for payments. Connect your wallet (Telegram Wallet, Tonkeeper, etc.) so you can receive and make payments easily. You can also skip this.",
      type: "text",
    });
  }, [currentStep, addStepMessage]);

  const handleWalletTonConnect = async () => {
    setWalletLoading(true);
    try {
      await tonConnectUI.openModal();
    } catch {
      // Modal closed without connecting — that's OK
    } finally {
      setWalletLoading(false);
    }
  };

  // When TON Connect wallet becomes connected, save it to the backend
  useEffect(() => {
    if (currentStep !== "WALLET" || !tonWallet) return;
    const address = tonWallet.account.address;
    const friendlyAddr = address.slice(0, 8) + "..." + address.slice(-6);

    setWalletAddress(address);
    setMessages((prev) => {
      if (prev.some((m) => m.id === "user-wallet-connected")) return prev;
      return [
        ...prev,
        { id: "user-wallet-connected", role: "user", content: `Connected: ${friendlyAddr}` },
      ];
    });

    fetch("/api/expert/wallet", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...tgHeaders },
      body: JSON.stringify({ action: "connect", address }),
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep, tonWallet]);

  const handleWalletContinue = () => {
    setCurrentStep("SOCIAL_LINKS");
    setCurrentSocialIndex(0);
  };

  // Social link questions
  useEffect(() => {
    if (currentStep !== "SOCIAL_LINKS" || currentSocialIndex >= SOCIAL_PLATFORMS.length)
      return;

    const platform = SOCIAL_PLATFORMS[currentSocialIndex];
    const questionKey = `social-${platform.key}`;

    const isOptional = !platform.required;
    const skipHint = isOptional ? " (paste link or press Skip)" : "";

    const question =
      currentSocialIndex === 0
        ? `Now let's add your social profiles. What's your ${platform.label} profile URL?${platform.required ? " (required)" : skipHint}`
        : `What's your ${platform.label}?${skipHint}`;

    addStepMessage(questionKey, {
      id: questionKey,
      role: "ai",
      content: question,
      type: "input",
    });
  }, [currentStep, currentSocialIndex, addStepMessage]);

  // Domains question
  useEffect(() => {
    if (currentStep !== "DOMAINS") return;
    addStepMessage("domains", {
      id: "domains",
      role: "ai",
      content:
        "Great! Now, what areas do you specialize in? Select all that apply.",
      type: "chips",
    });
  }, [currentStep, addStepMessage]);

  // Document upload question (now between links and session prefs)
  useEffect(() => {
    if (currentStep !== "DOCUMENT_UPLOAD") return;
    addStepMessage("upload-question", {
      id: "upload-question",
      role: "ai",
      content:
        "Would you like to upload a PDF to help me better understand your services? This could be a resume, portfolio, or service description. You can also skip this step.",
      type: "text",
    });
  }, [currentStep, addStepMessage]);

  // Session prefs question
  useEffect(() => {
    if (currentStep !== "SESSION_PREFS") return;
    addStepMessage("session", {
      id: "session",
      role: "ai",
      content: "How would you like to meet with people who book sessions with you?",
      type: "options",
    });
  }, [currentStep, addStepMessage]);

  // Pricing step
  useEffect(() => {
    if (currentStep !== "PRICING") return;
    const showOnline = sessionType !== "OFFLINE";
    const showOffline = sessionType !== "ONLINE";
    const parts: string[] = [];
    if (showOnline) parts.push("online");
    if (showOffline) parts.push("offline");
    addStepMessage("pricing", {
      id: "pricing",
      role: "ai",
      content: `Set your hourly rate in SGD for ${parts.join(" and ")} sessions. This helps mentees know what to expect.`,
      type: "input",
    });
  }, [currentStep, addStepMessage, sessionType]);

  const handlePricingSubmit = async () => {
    const onlineCents = priceOnline ? Math.round(parseFloat(priceOnline) * 100) : undefined;
    const offlineCents = priceOffline ? Math.round(parseFloat(priceOffline) * 100) : undefined;

    if (sessionType !== "OFFLINE" && (!onlineCents || onlineCents <= 0)) return;
    if (sessionType !== "ONLINE" && (!offlineCents || offlineCents <= 0)) return;

    const parts: string[] = [];
    if (onlineCents) parts.push(`Online: SGD ${priceOnline}/hr`);
    if (offlineCents) parts.push(`Offline: SGD ${priceOffline}/hr`);

    setMessages((prev) => [
      ...prev,
      { id: "user-pricing", role: "user", content: parts.join(", ") },
    ]);

    try {
      const data: Record<string, number> = {};
      if (onlineCents) data.priceOnlineCents = onlineCents;
      if (offlineCents) data.priceOfflineCents = offlineCents;
      await saveOnboarding(data);
    } catch {
      // Silently fail
    }

    setCurrentStep("AVAILABILITY");
  };

  // Availability step
  useEffect(() => {
    if (currentStep !== "AVAILABILITY") return;
    addStepMessage("availability", {
      id: "availability",
      role: "ai",
      content:
        "Set your weekly availability so others know when to book you. Tap the + button next to each day to add time slots. You can skip this and set it later.",
      type: "text",
    });
  }, [currentStep, addStepMessage]);

  const handleAvailabilityContinue = (schedule?: WeeklySchedule) => {
    const sched = schedule ?? onboardSchedule;
    const hasSlotsSet = Object.keys(sched).length > 0;
    if (hasSlotsSet) {
      setMessages((prev) => [
        ...prev,
        { id: "user-avail", role: "user", content: "Availability set" },
      ]);
      saveOnboarding({ weeklySchedule: sched }).catch(() => {});
    } else {
      setMessages((prev) => [
        ...prev,
        { id: "user-avail-skip", role: "user", content: "Skipped availability" },
      ]);
    }
    setCurrentStep("STRIPE_KYC");
  };

  // Stripe KYC step
  useEffect(() => {
    if (currentStep !== "STRIPE_KYC") return;
    addStepMessage("stripe-kyc", {
      id: "stripe-kyc",
      role: "ai",
      content:
        "To receive payments from session bookings, you need to set up a Stripe account. This is a quick identity verification required by our payment provider. You can also skip this and complete it later from your profile.",
      type: "text",
    });
  }, [currentStep, addStepMessage]);

  const handleStripeKycStart = async () => {
    setStripeKycLoading(true);
    try {
      const res = await fetch("/api/stripe/connect", {
        method: "POST",
        headers: { ...tgHeaders },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create Stripe account");
      }
      const data = await res.json();
      if (data.url) {
        setMessages((prev) => [
          ...prev,
          { id: "user-stripe-kyc", role: "user", content: "Opening Stripe verification..." },
        ]);
        window.location.href = data.url;
        return;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Stripe setup failed";
      setMessages((prev) => [
        ...prev,
        {
          id: `stripe-error-${Date.now()}`,
          role: "ai",
          content: `${msg}. You can try again or skip for now.`,
          type: "text",
        },
      ]);
    } finally {
      setStripeKycLoading(false);
    }
  };

  const handleStripeKycContinue = () => {
    if (!stripeKycDone) {
      setMessages((prev) => [
        ...prev,
        { id: "user-stripe-skip", role: "user", content: "Skipped Stripe setup" },
      ]);
    } else {
      setMessages((prev) => [
        ...prev,
        { id: "user-stripe-done", role: "user", content: "Stripe verification started" },
      ]);
    }
    startAIGeneration();
  };

  // Voice sample question
  useEffect(() => {
    if (currentStep !== "VOICE_SAMPLE") return;
    addStepMessage("voice-sample", {
      id: "voice-sample",
      role: "ai",
      content:
        "Your profile is ready! To make your avatar speak in your own voice, record a short voice sample (10–30 seconds). Just speak naturally — read any text or introduce yourself. You can also skip this step.",
      type: "text",
    });
  }, [currentStep, addStepMessage]);

  const saveOnboarding = async (data: Record<string, unknown>) => {
    const res = await fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...tgHeaders },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error("Failed to save");
    return res.json();
  };

  const handleGenderSelect = async (gender: string) => {
    const labels: Record<string, string> = { male: "Male", female: "Female", other: "Prefer not to say" };
    setSelectedGender(gender);

    setMessages((prev) => [
      ...prev,
      { id: "user-gender", role: "user", content: labels[gender] ?? gender },
    ]);

    try {
      await saveOnboarding({ gender });
    } catch {
      // Silently fail
    }

    if (isTelegram) {
      setCurrentStep("WALLET");
    } else {
      setCurrentStep("SOCIAL_LINKS");
      setCurrentSocialIndex(0);
    }
  };

  const handleNicknameSubmit = async (value: string) => {
    if (!value.trim()) return;
    const name = value.trim();
    setUserNickName(name);

    setMessages((prev) => [
      ...prev,
      { id: "user-nickname", role: "user", content: name },
    ]);
    setInputValue("");

    try {
      await fetch("/api/user", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...tgHeaders },
        body: JSON.stringify({ nickName: name }),
      });
    } catch {
      // Silently fail
    }

    if (isTelegram) {
      setCurrentStep("GENDER");
    } else {
      setCurrentStep("TELEGRAM_ID");
    }
  };

  // Telegram username step (skipped when inside Telegram Mini App)
  useEffect(() => {
    if (currentStep !== "TELEGRAM_ID") return;
    addStepMessage("telegram-id", {
      id: "telegram-id",
      role: "ai",
      content: `Great, ${userNickName || "there"}! Do you have a Telegram account? If so, share your username (e.g. @yourname) and I'll send you updates and reminders there. You can also skip this.`,
      type: "input",
    });
  }, [currentStep, addStepMessage, userNickName]);

  const handleTelegramSubmit = async (value: string, skip = false) => {
    const username = skip ? "" : value.trim().replace(/^@/, "");

    setMessages((prev) => [
      ...prev,
      {
        id: "user-telegram",
        role: "user",
        content: skip ? "(Skipped)" : `@${username}`,
      },
    ]);
    setInputValue("");

    if (username) {
      try {
        await fetch("/api/user", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...tgHeaders },
          body: JSON.stringify({ telegramUsername: username }),
        });
        // Send greeting via bot
        fetch("/api/telegram/notify", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...tgHeaders },
          body: JSON.stringify({
            type: "greeting",
            telegramUsername: username,
          }),
        }).catch(() => {});
      } catch {
        // Silently fail
      }
    }

    setCurrentStep("GENDER");
  };

  const handleSocialSubmit = async (value: string, skip = false) => {
    if (!skip && !value.trim()) return;

    const platform = SOCIAL_PLATFORMS[currentSocialIndex];
    const displayValue = skip ? "(Skipped)" : value.trim();

    setMessages((prev) => [
      ...prev,
      {
        id: `user-social-${platform.key}`,
        role: "user",
        content: displayValue,
      },
    ]);
    setInputValue("");

    const newLinks = { ...socialLinks };
    if (!skip) newLinks[platform.key as keyof SocialLinks] = value.trim();
    setSocialLinks(newLinks);

    try {
      await saveOnboarding({ [platform.key]: skip ? "" : value.trim() });
    } catch {
      // Silently fail
    }

    if (currentSocialIndex < SOCIAL_PLATFORMS.length - 1) {
      setCurrentSocialIndex((i) => i + 1);
    } else {
      setCurrentStep("DOMAINS");
    }
  };

  const handleDomainsContinue = async () => {
    if (selectedDomains.length === 0) return;

    setMessages((prev) => [
      ...prev,
      {
        id: "user-domains",
        role: "user",
        content: selectedDomains.join(", "),
      },
    ]);

    try {
      await saveOnboarding({ domains: selectedDomains });
    } catch {
      // Silently fail
    }

    setCurrentStep("DOCUMENT_UPLOAD");
  };

  const handleFileUpload = async (file: File) => {
    setIsUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/onboarding/upload", {
        method: "POST",
        headers: { ...tgHeaders },
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Upload failed");
      }
      setUploadedFileName(file.name);
      setMessages((prev) => [
        ...prev,
        { id: `user-upload-${Date.now()}`, role: "user", content: `Uploaded: ${file.name}` },
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      setMessages((prev) => [
        ...prev,
        { id: `upload-error-${Date.now()}`, role: "ai", content: `Upload error: ${msg}. You can try again or skip.`, type: "text" },
      ]);
    } finally {
      setIsUploading(false);
    }
  };

  const handleDocumentContinue = async () => {
    if (uploadedFileName) {
      setMessages((prev) => [
        ...prev,
        {
          id: "upload-ack",
          role: "ai",
          content: `Great, I'll use "${uploadedFileName}" to enrich your profile.`,
          type: "text",
        },
      ]);
      await new Promise((r) => setTimeout(r, 600));
    }

    setCurrentStep("SESSION_PREFS");
  };

  const handleSessionSelect = async (value: string) => {
    setSessionType(value);

    setMessages((prev) => [
      ...prev,
      {
        id: "user-session",
        role: "user",
        content:
          SESSION_OPTIONS.find((o) => o.value === value)?.label ?? value,
      },
    ]);

    try {
      await saveOnboarding({ sessionType: value });
    } catch {
      // Silently fail
    }

    setCurrentStep("PRICING");
  };

  const startAIGeneration = async () => {
    setCurrentStep("AI_GENERATION");
    setMessages((prev) => [
      ...prev,
      {
        id: "ai-processing",
        role: "ai",
        content: "Generating your profile — searching social profiles, writing bio, and creating your avatar image...",
        type: "text",
      },
    ]);

    try {
      const res = await fetch("/api/onboarding/generate", {
        method: "POST",
        headers: { ...tgHeaders },
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        console.error("Generate API error:", errBody);
        throw new Error(errBody.detail || "Generate failed");
      }
      const data = await res.json();
      setGeneratedProfile({
        bio: data.bio,
        services: data.services ?? [],
        videoScript: data.videoScript ?? "",
        profileImage: data.profileImage ?? null,
      });
      setCurrentStep("VOICE_SAMPLE");
    } catch (err) {
      console.error("AI generation error:", err);
      setMessages((prev) => [
        ...prev,
        {
          id: `ai-error-${Date.now()}`,
          role: "ai",
          content: "Something went wrong generating your profile. Please try again.",
          type: "text",
        },
      ]);
      setCurrentStep("SESSION_PREFS");
    }
  };

  const handleVoiceRecording = async (blob: Blob) => {
    setCloningVoice(true);
    setMessages((prev) => [
      ...prev,
      { id: "user-voice", role: "user", content: "Voice sample recorded" },
    ]);

    try {
      const formData = new FormData();
      formData.append("audio", blob, "voice.webm");

      const cloneRes = await fetch("/api/expert/voice-clone", {
        method: "POST",
        headers: { ...tgHeaders },
        body: formData,
      });

      if (!cloneRes.ok) {
        const err = await cloneRes.json().catch(() => ({}));
        throw new Error(err.error || "Voice cloning failed");
      }

      setVoiceCloned(true);

      setMessages((prev) => [
        ...prev,
        {
          id: "voice-cloned",
          role: "ai",
          content: "Voice cloned! Now generating your audio introduction...",
          type: "text",
        },
      ]);

      const audioRes = await fetch("/api/expert/generate-audio", {
        method: "POST",
        headers: { ...tgHeaders },
      });

      if (audioRes.ok) {
        const audioData = await audioRes.json();
        setAudioIntroUrl(audioData.audioIntroUrl ?? null);
        setMessages((prev) => [
          ...prev,
          {
            id: "audio-ready",
            role: "ai",
            content: "Your voice introduction is ready! Preview it below.",
            type: "text",
          },
        ]);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Voice cloning failed";
      setMessages((prev) => [
        ...prev,
        {
          id: `voice-error-${Date.now()}`,
          role: "ai",
          content: `${msg}. You can try again or skip this step.`,
          type: "text",
        },
      ]);
    } finally {
      setCloningVoice(false);
    }
  };

  const handleContinueToPreview = async () => {
    if (audioIntroUrl) {
      setCurrentStep("PREVIEW");
      return;
    }
    setGeneratingDefaultAudio(true);
    try {
      const audioRes = await fetch("/api/expert/generate-audio", {
        method: "POST",
        headers: { ...tgHeaders },
      });
      if (audioRes.ok) {
        const audioData = await audioRes.json();
        setAudioIntroUrl(audioData.audioIntroUrl ?? null);
      }
    } catch {
      // Continue to preview even if audio generation fails
    } finally {
      setGeneratingDefaultAudio(false);
      setCurrentStep("PREVIEW");
    }
  };

  const handleBioSave = async () => {
    if (!generatedProfile) return;
    setGeneratedProfile((p) =>
      p ? { ...p, videoScript: editedBio } : null
    );
    try {
      await saveOnboarding({ bio: editedBio });
    } catch {
      // Silently fail
    }
  };

  const handleServiceSave = async (index: number) => {
    if (!generatedProfile) return;
    const updated = [...generatedProfile.services];
    updated[index] = { title: editedServiceTitle.trim(), description: editedServiceDesc.trim() };
    setGeneratedProfile((p) => (p ? { ...p, services: updated } : null));
    setEditingServiceIndex(null);
    try {
      await saveOnboarding({ servicesOffered: updated });
    } catch {
      // Silently fail
    }
  };

  const handleServiceDelete = async (index: number) => {
    if (!generatedProfile) return;
    const updated = generatedProfile.services.filter((_, i) => i !== index);
    setGeneratedProfile((p) => (p ? { ...p, services: updated } : null));
    setEditingServiceIndex(null);
    try {
      await saveOnboarding({ servicesOffered: updated });
    } catch {
      // Silently fail
    }
  };

  const handlePublish = async () => {
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/onboarding/publish", {
        method: "POST",
        headers: { ...tgHeaders },
      });
      if (!res.ok) throw new Error("Publish failed");
      router.push("/booking");
    } catch {
      setIsSubmitting(false);
    }
  };

  if (isTelegram && !authDone) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-50">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  if (!isTelegram && status === "loading") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-50">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  if (!isTelegram && status === "unauthenticated") {
    return null;
  }

  if (!inviteChecked || !hasInvite) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-50">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  const platform = SOCIAL_PLATFORMS[currentSocialIndex];
  const progressValue = getProgressValue(currentStep);

  // PREVIEW: Full-screen profile card
  if (currentStep === "PREVIEW" && generatedProfile) {
    return (
      <div className="flex min-h-dvh flex-col bg-slate-50">
        <div className="sticky top-0 z-10 border-b bg-white/95 px-4 py-3 backdrop-blur">
          <h1 className="text-center text-lg font-semibold">Profile Preview</h1>
        </div>
        <div className="flex-1 overflow-y-auto p-4 pb-8">
          <Card className="mx-auto max-w-lg overflow-hidden shadow-lg">
            <CardHeader className="space-y-3">
              <CardTitle className="text-xl">{nickName}</CardTitle>
              <div className="flex flex-wrap gap-1.5">
                {selectedDomains.map((d) => (
                  <Badge key={d} variant="secondary" className="text-xs">
                    {d}
                  </Badge>
                ))}
              </div>

              {generatedProfile.profileImage ? (
                <div className="relative w-full aspect-square rounded-xl overflow-hidden bg-slate-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={generatedProfile.profileImage}
                    alt={`${nickName}'s digital avatar`}
                    className="w-full h-full object-cover"
                  />
                </div>
              ) : (
                <div className="w-full aspect-square rounded-xl bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center">
                  <Sparkles className="h-16 w-16 text-indigo-300" />
                </div>
              )}
              {audioIntroUrl && (
                <AudioPlayer
                  src={audioIntroUrl}
                  label="Your voice introduction"
                  className="mt-3"
                />
              )}
            </CardHeader>

            <CardContent className="space-y-4">
              {generatedProfile.videoScript && (
                <div>
                  <h3 className="mb-2 font-semibold">Introduction Script</h3>
                  {editedBio ? (
                    <div className="space-y-2">
                      <Textarea
                        value={editedBio}
                        onChange={(e) => setEditedBio(e.target.value)}
                        rows={6}
                        className="min-h-[120px]"
                      />
                      <Button
                        onClick={() => {
                          handleBioSave();
                          setEditedBio("");
                        }}
                        size="lg"
                        className="min-h-[44px] w-full"
                      >
                        <Check className="mr-2 h-4 w-4" />
                        Save
                      </Button>
                    </div>
                  ) : (
                    <div
                      onClick={() => setEditedBio(generatedProfile.videoScript)}
                      className="rounded-lg border bg-muted/30 p-4 text-sm leading-relaxed whitespace-pre-wrap cursor-pointer hover:border-indigo-300 transition-colors"
                    >
                      {generatedProfile.videoScript}
                      <span className="mt-2 block text-xs text-muted-foreground">
                        Tap to edit
                      </span>
                    </div>
                  )}
                </div>
              )}

              <div>
                <h3 className="mb-2 font-semibold">Services Offered</h3>
                <ul className="space-y-2">
                  {generatedProfile.services.map((s, i) =>
                    editingServiceIndex === i ? (
                      <li key={i} className="rounded-lg border border-indigo-300 p-3 space-y-2">
                        <Input
                          value={editedServiceTitle}
                          onChange={(e) => setEditedServiceTitle(e.target.value)}
                          placeholder="Service title"
                          className="font-medium"
                        />
                        <Input
                          value={editedServiceDesc}
                          onChange={(e) => setEditedServiceDesc(e.target.value)}
                          placeholder="One-sentence description"
                        />
                        <div className="flex gap-2">
                          <Button
                            onClick={() => handleServiceSave(i)}
                            disabled={!editedServiceTitle.trim()}
                            size="sm"
                            className="flex-1"
                          >
                            <Check className="mr-1 h-3 w-3" /> Save
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => setEditingServiceIndex(null)}
                            size="sm"
                          >
                            Cancel
                          </Button>
                          <Button
                            variant="destructive"
                            onClick={() => handleServiceDelete(i)}
                            size="sm"
                          >
                            Delete
                          </Button>
                        </div>
                      </li>
                    ) : (
                      <li
                        key={i}
                        onClick={() => {
                          setEditingServiceIndex(i);
                          setEditedServiceTitle(s.title);
                          setEditedServiceDesc(s.description);
                        }}
                        className="rounded-lg border p-3 cursor-pointer hover:border-indigo-300 transition-colors"
                      >
                        <p className="font-medium">{s.title}</p>
                        <p className="text-sm text-muted-foreground">
                          {s.description}
                        </p>
                      </li>
                    )
                  )}
                </ul>
                <p className="mt-1 text-xs text-muted-foreground text-center">
                  Tap any service to edit
                </p>
              </div>

              <Button
                onClick={handlePublish}
                disabled={isSubmitting}
                size="lg"
                className="min-h-[48px] w-full bg-indigo-600 hover:bg-indigo-700"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Publishing...
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-4 w-4" />
                    Publish to Network
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Chat interface
  return (
    <div className="flex flex-col h-dvh max-w-lg mx-auto bg-slate-50">
      {/* Progress bar */}
      <div className="shrink-0 border-b bg-white px-4 py-3">
        <div className="mb-2 flex items-center justify-between gap-1 text-xs font-medium">
          {ONBOARDING_STEPS.map((step, i) => (
            <span
              key={step.key}
              className={cn(
                "transition-colors",
                progressValue >= (i + 1) * 25
                  ? "text-indigo-600"
                  : "text-muted-foreground"
              )}
            >
              {step.label}
            </span>
          ))}
        </div>
        <Progress value={progressValue} className="h-2" />
      </div>

      {/* Chat messages */}
      <div
        ref={chatAreaRef}
        className="flex-1 overflow-y-auto px-4 py-6 no-scrollbar"
      >
        <div className="space-y-4">
          <AnimatePresence mode="popLayout">
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className={cn(
                  "flex",
                  msg.role === "user" ? "justify-end" : "justify-start"
                )}
              >
                <div
                  className={cn(
                    "max-w-[85%] rounded-2xl px-4 py-3 text-[15px] leading-relaxed",
                    msg.role === "ai"
                      ? "rounded-bl-md bg-slate-200 text-slate-900 chat-bubble-animate"
                      : "rounded-br-md bg-indigo-600 text-white chat-bubble-animate"
                  )}
                >
                  {msg.content}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {isTyping && (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-bl-md bg-slate-200 px-4 py-3">
                <span className="typing-dots text-slate-600">typing</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input area */}
      <div className="shrink-0 border-t bg-white px-4 py-4 mobile-safe-bottom">
        {currentStep === "NICKNAME" && (
          <div className="flex gap-2">
            <Input
              ref={textInputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Your name or nickname"
              className="min-h-[44px] flex-1"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleNicknameSubmit(inputValue);
              }}
            />
            <VoiceInputButton
              onTranscript={(text) => setInputValue(text)}
              className="min-h-[44px] min-w-[44px]"
            />
            <Button
              onClick={() => handleNicknameSubmit(inputValue)}
              disabled={!inputValue.trim()}
              size="icon"
              className="min-h-[44px] min-w-[44px] shrink-0"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        )}

        {currentStep === "TELEGRAM_ID" && (
          <div className="flex gap-2">
            <Input
              ref={textInputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="@username"
              className="min-h-[44px] flex-1"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleTelegramSubmit(inputValue);
              }}
            />
            <Button
              onClick={() => handleTelegramSubmit(inputValue)}
              disabled={!inputValue.trim()}
              size="icon"
              className="min-h-[44px] min-w-[44px] shrink-0"
            >
              <Send className="h-4 w-4" />
            </Button>
            <Button
              onClick={() => handleTelegramSubmit("", true)}
              variant="ghost"
              className="min-h-[44px] shrink-0 gap-1"
            >
              <SkipForward className="h-4 w-4" />
              Skip
            </Button>
          </div>
        )}

        {currentStep === "GENDER" && (
          <div className="grid grid-cols-3 gap-2">
            {[
              { value: "male", label: "Male", emoji: "👨" },
              { value: "female", label: "Female", emoji: "👩" },
              { value: "other", label: "Skip", emoji: "⏭️" },
            ].map((opt) => (
              <Button
                key={opt.value}
                variant={selectedGender === opt.value ? "default" : "outline"}
                className={cn(
                  "min-h-[56px] flex-col gap-1",
                  selectedGender === opt.value && "bg-indigo-600 hover:bg-indigo-700"
                )}
                onClick={() => handleGenderSelect(opt.value)}
              >
                <span className="text-lg">{opt.emoji}</span>
                <span className="text-xs">{opt.label}</span>
              </Button>
            ))}
          </div>
        )}

        {currentStep === "WALLET" && (
          <div className="space-y-3">
            {walletAddress || tonWallet ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 rounded-xl border-2 border-emerald-200 bg-emerald-50 p-4">
                  <CheckCircle className="h-5 w-5 text-emerald-600 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-muted-foreground">Wallet Connected</p>
                    <p className="font-mono text-sm truncate">
                      {(tonWallet?.account.address ?? walletAddress ?? "").slice(0, 10)}...{(tonWallet?.account.address ?? walletAddress ?? "").slice(-6)}
                    </p>
                  </div>
                </div>
                <Button
                  onClick={handleWalletContinue}
                  className="min-h-[48px] w-full bg-indigo-600 hover:bg-indigo-700"
                >
                  Continue
                </Button>
              </div>
            ) : (
              <>
                <Button
                  onClick={handleWalletTonConnect}
                  disabled={walletLoading}
                  className="min-h-[48px] w-full bg-indigo-600 hover:bg-indigo-700"
                >
                  {walletLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Connecting...
                    </>
                  ) : (
                    <>
                      <Wallet className="mr-2 h-4 w-4" />
                      Connect TON Wallet
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleWalletContinue}
                  disabled={walletLoading}
                  className="min-h-[44px] w-full text-muted-foreground"
                >
                  <SkipForward className="mr-2 h-4 w-4" />
                  Skip for Now
                </Button>
              </>
            )}
          </div>
        )}

        {currentStep === "SOCIAL_LINKS" && platform && (
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input
                ref={textInputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder={platform.placeholder}
                className="min-h-[44px] flex-1"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSocialSubmit(inputValue);
                }}
              />
              <VoiceInputButton
                onTranscript={(text) => setInputValue(text)}
                className="min-h-[44px] min-w-[44px]"
              />
              <Button
                onClick={() => handleSocialSubmit(inputValue)}
                disabled={!inputValue.trim() && platform.required}
                size="icon"
                className="min-h-[44px] min-w-[44px] shrink-0"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
            {!platform.required && (
              <Button
                variant="outline"
                onClick={() => handleSocialSubmit("", true)}
                className="min-h-[44px] w-full text-muted-foreground"
              >
                <SkipForward className="mr-2 h-4 w-4" />
                Skip {platform.label}
              </Button>
            )}
          </div>
        )}

        {currentStep === "DOMAINS" && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {DOMAINS.map((domain) => (
                <Badge
                  key={domain}
                  variant={selectedDomains.includes(domain) ? "default" : "outline"}
                  className={cn(
                    "cursor-pointer px-4 py-2 text-sm transition min-h-[44px] flex items-center",
                    selectedDomains.includes(domain)
                      ? "bg-indigo-600 text-white hover:bg-indigo-700"
                      : "hover:bg-slate-100"
                  )}
                  onClick={() => {
                    setSelectedDomains((prev) =>
                      prev.includes(domain)
                        ? prev.filter((d) => d !== domain)
                        : [...prev, domain]
                    );
                  }}
                >
                  {domain}
                </Badge>
              ))}
            </div>
            <Button
              onClick={handleDomainsContinue}
              disabled={selectedDomains.length === 0}
              className="min-h-[48px] w-full"
            >
              Continue
            </Button>
          </div>
        )}

        {currentStep === "DOCUMENT_UPLOAD" && (
          <div className="space-y-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileUpload(file);
              }}
            />
            <Button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              variant="outline"
              className="min-h-[48px] w-full"
            >
              {isUploading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Uploading...
                </>
              ) : uploadedFileName ? (
                <>
                  <FileText className="mr-2 h-4 w-4" />
                  {uploadedFileName}
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Upload PDF
                </>
              )}
            </Button>
            <Button
              onClick={handleDocumentContinue}
              disabled={isUploading}
              className="min-h-[48px] w-full bg-indigo-600 hover:bg-indigo-700"
            >
              {uploadedFileName ? "Continue with Document" : "Skip & Continue"}
            </Button>
          </div>
        )}

        {currentStep === "SESSION_PREFS" && (
          <div className="space-y-3">
            {SESSION_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleSessionSelect(opt.value)}
                className={cn(
                  "w-full rounded-xl border-2 p-4 text-left transition min-h-[56px] flex flex-col items-start",
                  sessionType === opt.value
                    ? "border-indigo-600 bg-indigo-50"
                    : "border-slate-200 bg-white hover:border-slate-300"
                )}
              >
                <span className="font-semibold">{opt.label}</span>
                <span className="text-sm text-muted-foreground">
                  {opt.desc}
                </span>
              </button>
            ))}
          </div>
        )}

        {currentStep === "PRICING" && (
          <div className="space-y-3">
            {sessionType !== "OFFLINE" && (
              <div className="space-y-1">
                <label className="text-sm font-medium text-muted-foreground">
                  Online rate (SGD/hour)
                </label>
                <div className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-muted-foreground shrink-0" />
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={priceOnline}
                    onChange={(e) => setPriceOnline(e.target.value)}
                    placeholder="e.g. 50"
                    className="min-h-[44px]"
                  />
                </div>
              </div>
            )}
            {sessionType !== "ONLINE" && (
              <div className="space-y-1">
                <label className="text-sm font-medium text-muted-foreground">
                  Offline rate (SGD/hour)
                </label>
                <div className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-muted-foreground shrink-0" />
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={priceOffline}
                    onChange={(e) => setPriceOffline(e.target.value)}
                    placeholder="e.g. 80"
                    className="min-h-[44px]"
                  />
                </div>
              </div>
            )}
            <Button
              onClick={handlePricingSubmit}
              disabled={
                (sessionType !== "OFFLINE" && !priceOnline) ||
                (sessionType !== "ONLINE" && !priceOffline)
              }
              className="min-h-[48px] w-full bg-indigo-600 hover:bg-indigo-700"
            >
              Continue
            </Button>
          </div>
        )}

        {currentStep === "AVAILABILITY" && (
          <div className="space-y-3">
            <WeeklyScheduleEditor
              schedule={onboardSchedule}
              onSave={async (s) => {
                setOnboardSchedule(s);
                handleAvailabilityContinue(s);
              }}
              compact
              showHeader={false}
              showHint={false}
            />
            <Button
              variant="outline"
              onClick={() => handleAvailabilityContinue()}
              className="min-h-[44px] w-full text-muted-foreground"
            >
              <SkipForward className="mr-2 h-4 w-4" />
              Skip & Continue
            </Button>
          </div>
        )}

        {currentStep === "STRIPE_KYC" && (
          <div className="space-y-3">
            {stripeKycDone ? (
              <div className="flex items-center gap-2 rounded-xl border-2 border-emerald-200 bg-emerald-50 p-4">
                <CheckCircle className="h-5 w-5 text-emerald-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-emerald-800">
                    Stripe verification started
                  </p>
                  <p className="text-xs text-emerald-600">
                    Complete the verification in the new tab, then continue.
                  </p>
                </div>
              </div>
            ) : (
              <Button
                onClick={handleStripeKycStart}
                disabled={stripeKycLoading}
                className="min-h-[48px] w-full bg-indigo-600 hover:bg-indigo-700"
              >
                {stripeKycLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Setting up Stripe...
                  </>
                ) : (
                  <>
                    <CreditCard className="mr-2 h-4 w-4" />
                    Set Up Stripe Account
                  </>
                )}
              </Button>
            )}
            <Button
              onClick={handleStripeKycContinue}
              variant={stripeKycDone ? "default" : "outline"}
              className={cn(
                "min-h-[44px] w-full",
                stripeKycDone
                  ? "bg-indigo-600 hover:bg-indigo-700"
                  : "text-muted-foreground"
              )}
            >
              {stripeKycDone ? (
                "Continue"
              ) : (
                <>
                  <SkipForward className="mr-2 h-4 w-4" />
                  Skip for Now
                </>
              )}
            </Button>
          </div>
        )}

        {currentStep === "AI_GENERATION" && (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
          </div>
        )}

        {currentStep === "VOICE_SAMPLE" && (
          <div className="space-y-3">
            {!voiceCloned && (
              <VoiceRecorder
                onRecordingComplete={handleVoiceRecording}
                disabled={cloningVoice}
                minSeconds={10}
                maxSeconds={60}
              />
            )}

            {audioIntroUrl && (
              <AudioPlayer
                src={audioIntroUrl}
                label="Your voice introduction preview"
              />
            )}

            <Button
              variant={voiceCloned ? "default" : "outline"}
              className={cn(
                "w-full min-h-[44px]",
                voiceCloned && "bg-indigo-600 hover:bg-indigo-700"
              )}
              onClick={handleContinueToPreview}
              disabled={cloningVoice || generatingDefaultAudio}
            >
              {cloningVoice || generatingDefaultAudio ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {generatingDefaultAudio ? "Generating voice intro..." : "Processing voice..."}
                </>
              ) : voiceCloned ? (
                <>
                  <Volume2 className="mr-2 h-4 w-4" />
                  Continue to Preview
                </>
              ) : (
                <>
                  <Volume2 className="mr-2 h-4 w-4" />
                  Generate Voice & Continue
                </>
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
