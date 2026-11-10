'use client';
import { useState } from 'react';
import { buttonStyles } from '@/components/ui';

export function CopyButton({ text, label = 'Copy code' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <>
      <button type="button" className={buttonStyles.secondary}
        onClick={async () => {
          try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }
          catch { /* clipboard blocked: the code is on screen to copy by hand */ }
        }}>
        {copied ? 'Copied' : label}
      </button>
      <span aria-live="polite" className="sr-only">{copied ? 'Invite code copied' : ''}</span>
    </>
  );
}
