'use client';

import type { PropsWithChildren } from 'react';

type FormCardProps = PropsWithChildren<{
  isActive: boolean;
  className?: string;
}>;

const baseStyle =
  'bg-white rounded-2xl px-6 py-7 compact:py-5 tight:py-4 w-full shadow-2xl transition-all duration-500 ease-in-out';
const activeStyle = 'opacity-100 translate-y-0 relative';
const inactiveStyle = 'opacity-0 translate-y-6 pointer-events-none absolute';

export default function FormCard({ isActive, className = '', children }: FormCardProps) {
  return <div className={`${baseStyle} ${isActive ? activeStyle : inactiveStyle} ${className}`.trim()}>{children}</div>;
}

