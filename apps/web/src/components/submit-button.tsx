'use client';
import { useFormStatus } from 'react-dom';
import { buttonStyles } from '@/components/ui';

/** A form submit button that shows progress and blocks double submits (idempotent writes, RC-16). */
export function SubmitButton({ children, pendingText, variant = 'primary', className = '', disabled, ...rest }: {
  children: React.ReactNode; pendingText?: string; variant?: keyof typeof buttonStyles; className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { pending } = useFormStatus();
  const off = pending || Boolean(disabled);
  return (
    <button type="submit" {...rest} disabled={off} aria-disabled={off} className={`${buttonStyles[variant]} ${className}`}>
      {pending ? pendingText ?? 'Saving…' : children}
    </button>
  );
}
