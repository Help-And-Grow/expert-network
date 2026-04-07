"use client";

import { useState } from "react";

import { Phone } from "lucide-react";

import { Button } from "@/components/ui/button";
import { VoiceChatModal } from "@/components/voice-chat-modal";

interface VoiceChatButtonProps {
  expertId: string;
  expertName: string;
  hasClonedVoice: boolean;
  className?: string;
}

export function VoiceChatButton({
  expertId,
  expertName,
  hasClonedVoice,
  className,
}: VoiceChatButtonProps) {
  const [showModal, setShowModal] = useState(false);

  if (!hasClonedVoice) return null;

  return (
    <>
      <Button
        variant="outline"
        className={className}
        onClick={() => setShowModal(true)}
      >
        <Phone className="h-4 w-4 mr-2" />
        Talk to AI {expertName.split(" ")[0]}
      </Button>

      {showModal && (
        <VoiceChatModal
          expertId={expertId}
          expertName={expertName}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  );
}
