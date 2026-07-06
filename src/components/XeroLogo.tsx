// Xero brand mark — blue circle with white X
export default function XeroLogo({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <circle cx="16" cy="16" r="16" fill="#13B5EA" />
      <path
        fill="#fff"
        d="M11.53 16l-3.2-3.2a.9.9 0 111.27-1.27L12.8 14.73l3.2-3.2a.9.9 0 111.27 1.27L14.07 16l3.2 3.2a.9.9 0 11-1.27 1.27l-3.2-3.2-3.2 3.2a.9.9 0 11-1.27-1.27l3.2-3.2z"
      />
      <circle cx="21.2" cy="16" r="1.5" fill="#fff" />
    </svg>
  );
}
