// src/app/interview/page.tsx
import { Suspense } from 'react';
import InterviewClient from './InterviewClient';

export default function InterviewPage() {
  return (
    <Suspense fallback={<div>Chargement de l’interview…</div>}>
      <InterviewClient />
    </Suspense>
  );
}
