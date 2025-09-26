'use client';

import React from 'react';
import localforage from 'localforage';
import { useRouter } from 'next/navigation';

export default function ResetButton() {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const router = useRouter();

  async function onConfirm() {
    setBusy(true);
    try {
      // Stoppe toute synthèse vocale en cours (si TTS utilisé)
      try { if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel(); } catch {}

      // 1) Nettoyage ciblé : clés "ms:" (à adapter si tu as un autre préfixe)
      const keys = await localforage.keys();
      const projectKeys = keys.filter(k => k.startsWith('ms:'));
      if (projectKeys.length) {
        await Promise.all(projectKeys.map(k => localforage.removeItem(k)));
      } else {
        // 2) Fallback (si pas de préfixe connu) : on nettoie tout le localforage de l’app
        await localforage.clear();
      }
    } finally {
      setBusy(false);
      setOpen(false);
      // Rafraîchit l’état du client (Next.js App Router)
      router.refresh();
      // Hard reload si besoin d’un reset total de hooks :
      // window.location.reload();
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        title="Réinitialiser les blocs"
        style={{ padding:'8px 12px', border:'1px solid #ddd', borderRadius:8, cursor:'pointer', background:'#fff' }}
      >
        Réinitialiser
      </button>

      {open && (
        <div
          role="dialog" aria-modal="true" aria-labelledby="reset-title"
          onKeyDown={(e)=>{ if(e.key==='Escape') setOpen(false); }}
          style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', display:'grid', placeItems:'center', zIndex:50 }}
        >
          <div style={{ background:'#fff', borderRadius:12, padding:20, width:'min(480px, 90vw)', boxShadow:'0 10px 30px rgba(0,0,0,0.2)' }}>
            <h2 id="reset-title" style={{ marginTop:0 }}>Réinitialiser tous les blocs ?</h2>
            <p>Cette action efface les contenus saisis et les brouillons locaux. Elle est <strong>irréversible</strong>.</p>
            <div style={{ display:'flex', gap:12, justifyContent:'flex-end', marginTop:16 }}>
              <button onClick={()=>setOpen(false)} disabled={busy} style={{ padding:'8px 12px', borderRadius:8, border:'1px solid #ddd', background:'#fff' }}>
                Annuler
              </button>
              <button onClick={onConfirm} disabled={busy} style={{ padding:'8px 12px', borderRadius:8, border:'none', background:'#d32f2f', color:'#fff' }}>
                {busy ? 'Réinitialisation…' : 'Oui, tout effacer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
