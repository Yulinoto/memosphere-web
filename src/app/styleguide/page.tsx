"use client";

import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MessageCircle, BookOpen, Sparkles } from "lucide-react";

export default function StyleguidePage() {
  const colors = [
    { name: "Bleu brume (primary)", class: "bg-[#6BA5C8]" },
    { name: "Vert mousse (secondary)", class: "bg-[#9DC8A5]" },
    { name: "Rose poudré (accent)", class: "bg-[#E5B5C5]" },
    { name: "Gris perle (light)", class: "bg-[#F8F9FA]" },
    { name: "Bleu nuit (dark)", class: "bg-[#22313F]" },
  ];

  return (
    <div className="min-h-screen bg-memosphere-light text-memosphere-text font-sans p-10">
      <motion.h1
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="text-4xl font-serif text-memosphere-dark mb-8"
      >
        🌿 Charte graphique MemoSphere
      </motion.h1>

      {/* Section Couleurs */}
      <section className="mb-10">
        <h2 className="text-2xl font-semibold mb-4">🎨 Palette de couleurs</h2>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          {colors.map((c) => (
            <div key={c.name} className="flex flex-col items-center">
              <div className={`w-16 h-16 rounded-md shadow-inner ${c.class}`} />
              <p className="text-sm text-center mt-2">{c.name}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Section Typographie */}
      <section className="mb-10">
        <h2 className="text-2xl font-semibold mb-4">✏️ Typographie</h2>
        <p className="font-serif text-2xl mb-2">Playfair Display — pour les titres</p>
        <p className="font-sans text-base mb-2">Inter — pour le texte courant</p>
        <p className="font-quote text-xl italic text-memosphere-accent">
          “La mémoire est un livre qui s’écrit au fil du temps.”
        </p>
      </section>

      {/* Section UI Components */}
      <section className="mb-10">
        <h2 className="text-2xl font-semibold mb-4">🧩 Composants UI</h2>
        <div className="flex flex-wrap gap-4">
          <Button className="bg-memosphere-primary text-white hover:bg-sky-500">
            Bouton principal
          </Button>
          <Button className="border border-gray-300 text-gray-700 hover:bg-gray-100">
            Bouton secondaire
          </Button>
          <Button className="bg-memosphere-accent text-white hover:bg-pink-400">
            Accent ✨
          </Button>
        </div>
      </section>

      {/* Section Cartes */}
      <section className="mb-10">
        <h2 className="text-2xl font-semibold mb-4">📘 Cartes & champs</h2>
        <div className="grid sm:grid-cols-2 gap-6">
          <Card className="p-4 border border-gray-200 rounded-lg shadow-sm">
            <h3 className="font-semibold text-lg mb-2 flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-memosphere-primary" />
              Exemple de bloc
            </h3>
            <p className="text-sm text-memosphere-subtext">
              Un bloc MemoSphere est une section de souvenirs ou d’interview. Son design reste sobre et aéré.
            </p>
          </Card>
          <Card className="p-4 border border-gray-200 rounded-lg shadow-sm flex flex-col gap-3">
            <Input placeholder="Titre du bloc..." />
            <Textarea placeholder="Résumé ou contenu du souvenir..." />
            <Button className="self-start bg-memosphere-secondary text-white hover:bg-green-500">
              Enregistrer
            </Button>
          </Card>
        </div>
      </section>
<div className="bg-primary text-primary-foreground p-4 rounded-md">
  Bleu brume MemoSphere
</div>
      {/* Section Icônes */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">✨ Icônes & ambiance</h2>
        <div className="flex gap-6 items-center text-memosphere-primary">
          <MessageCircle className="w-8 h-8" />
          <BookOpen className="w-8 h-8 text-memosphere-secondary" />
          <Sparkles className="w-8 h-8 text-memosphere-accent" />
        </div>
      </section>
    </div>
  );
}
