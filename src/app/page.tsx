"use client";

import Link from "next/link";
import { MessageCircle } from "lucide-react";

export default function HomePage() {
  return (
    <main className="min-h-dvh grid place-items-center p-8">
      <div className="max-w-xl w-full text-center space-y-6">
        <h1 className="text-4xl font-bold bg-gradient-to-r from-[#6BA5C8] to-[#9DC8A5] bg-clip-text text-transparent">
          MemoSphere
        </h1>

        <p className="text-gray-600 dark:text-gray-300 text-lg">
          Raconte ta vie. On s’occupe du reste.
        </p>

       <Link
  href="/interview"
  className="relative inline-flex items-center justify-center gap-2
             rounded-lg px-6 py-3 text-lg font-semibold
             text-white overflow-hidden
             bg-gradient-to-br from-[#6BA5C8] to-[#9DC8A5]
             shadow-md transition-all duration-300 ease-out
             hover:scale-[1.00] hover:shadow-lg hover:shadow-[#6BA5C8]/30
             active:scale-[0.98]
             focus:outline-none focus:ring-2 focus:ring-[#6BA5C8]/40
             before:absolute before:inset-0 before:bg-gradient-to-r before:from-transparent before:via-white/30 before:to-transparent
             before:translate-x-[-100%] hover:before:translate-x-[100%]
             before:transition-transform before:duration-[2s]"
>
  <MessageCircle className="relative w-5 h-5 text-white/90 z-10" />
  <span className="relative z-10 text-white">Démarrer l’interview</span>
</Link>

      </div>
    </main>
  );
}
