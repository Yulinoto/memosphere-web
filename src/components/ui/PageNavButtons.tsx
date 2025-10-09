"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { MessageCircle, Blocks, BookOpen, Palette, Home } from "lucide-react";

interface PageNavButtonsProps {
  show?: ("home" | "interview" | "blocks" | "draft" | "styleguide")[];
}

export function PageNavButtons({
  show = ["interview", "blocks", "draft"],
}: PageNavButtonsProps) {
  const router = useRouter();

  const buttons = {
    home: {
      label: "Accueil",
      icon: <Home className="w-4 h-4 text-white/90" />,
      route: "/",
    },
    interview: {
      label: "Interview",
      icon: <MessageCircle className="w-4 h-4 text-white/90" />,
      route: "/interview",
    },
    blocks: {
      label: "Blocs",
      icon: <Blocks className="w-4 h-4 text-white/90" />,
      route: "/blocks",
    },
    draft: {
      label: "Draft",
      icon: <BookOpen className="w-4 h-4 text-white/90" />,
      route: "/draft/builder",
    },
    styleguide: {
      label: "Styleguide",
      icon: <Palette className="w-4 h-4 text-white/90" />,
      route: "/styleguide",
    },
  };

  const baseBtn =
  "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium shadow-sm cursor-pointer " +
  "bg-gradient-to-br from-[#6BA5C8] to-[#9DC8A5] text-white " +
  "transition-all duration-300 transform hover:scale-105 hover:shadow-[0_0_12px_rgba(107,165,200,0.5)] active:scale-95";


  return (
    <div className="flex flex-wrap gap-3">
      {show.map((key) => {
        const btn = buttons[key];
        if (!btn) return null;
        return (
          <Button
            key={key}
            onClick={() => router.push(btn.route)}
            className={baseBtn}
            title={`Aller vers ${btn.label}`}
          >
            {btn.icon}
            <span className="font-medium">{btn.label}</span>
          </Button>
        );
      })}
    </div>
  );
}
