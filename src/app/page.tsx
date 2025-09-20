// src/app/page.tsx
import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-dvh grid place-items-center p-8">
      <div className="max-w-xl w-full text-center space-y-4">
        <h1 className="text-3xl font-bold">Memosphere</h1>
        <p className="text-muted-foreground">
          Raconte ta vie. On s’occupe du reste.
        </p>
        <Link
          href="/interview"
          className="inline-block rounded-xl px-6 py-3 border hover:bg-gray-50 transition"
        >
          Démarrer l’interview
        </Link>
      </div>
    </main>
  );
}
