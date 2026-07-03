// Tiny inline SVG icons for dev-tool toolbar buttons.

export function SunIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="4.4" />
      <line x1="12" y1="1.5" x2="12" y2="4.5" />
      <line x1="12" y1="19.5" x2="12" y2="22.5" />
      <line x1="1.5" y1="12" x2="4.5" y2="12" />
      <line x1="19.5" y1="12" x2="22.5" y2="12" />
      <line x1="4.7" y1="4.7" x2="6.8" y2="6.8" />
      <line x1="17.2" y1="17.2" x2="19.3" y2="19.3" />
      <line x1="4.7" y1="19.3" x2="6.8" y2="17.2" />
      <line x1="17.2" y1="6.8" x2="19.3" y2="4.7" />
    </svg>
  );
}

export function WireframeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
      <path d="M12 2.5 L21.5 8 L21.5 16 L12 21.5 L2.5 16 L2.5 8 Z" />
      <path d="M12 2.5 L12 21.5 M2.5 8 L21.5 16 M21.5 8 L2.5 16" />
    </svg>
  );
}
