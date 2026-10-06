export function WaIcon({ size = 17 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 0C5.4 0 0 5.4 0 12c0 2.1.6 4.1 1.6 5.9L0 24l6.3-1.6c1.7.9 3.6 1.4 5.7 1.4 6.6 0 12-5.4 12-12S18.6 0 12 0zm6.9 17c-.3.8-1.6 1.5-2.5 1.6-.7.1-1.5.2-4.9-1s-5.4-4.2-5.6-4.4-1.5-2-1.5-3.8 1-2.7 1.3-3.1c.3-.3.7-.4 1-.4h.7c.2 0 .5 0 .7.6.3.7.9 2.4 1 2.6.1.2.1.4 0 .6-.1.2-.2.4-.4.6l-.6.7c-.2.2-.4.4-.2.8.2.4 1 1.6 2.1 2.6 1.4 1.3 2.6 1.7 3 1.9.4.2.6.1.8-.1l1.2-1.4c.3-.3.5-.3.8-.2l2.3 1.1c.3.1.5.2.6.3.1.2.1 1-.2 1.8z" />
    </svg>
  );
}

export function HeartIcon({ filled = false, size = 17 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

export function ShareIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}

export function ChairIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 19v2M18 19v2M5 11h14a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1Z" />
      <path d="M7 11V6a3 3 0 0 1 3-3h4a3 3 0 0 1 3 3v5" />
    </svg>
  );
}

export function CloseIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function Line({ size = 18, children, strokeWidth = 1.8 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export function SunIcon(props) {
  return <Line {...props}><circle cx="12" cy="12" r="4.5" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></Line>;
}

export function MoonIcon(props) {
  return <Line {...props}><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" /></Line>;
}

export function MenuIcon(props) {
  return <Line {...props}><path d="M4 7h16M4 12h16M4 17h10" /></Line>;
}

export function SearchIcon(props) {
  return <Line {...props}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Line>;
}

export function ArrowIcon(props) {
  return <Line {...props}><path d="M5 12h14M13 6l6 6-6 6" /></Line>;
}

export function ArrowUpIcon(props) {
  return <Line {...props}><path d="M12 19V5M6 11l6-6 6 6" /></Line>;
}

export function ChevronIcon(props) {
  return <Line {...props}><path d="m6 9 6 6 6-6" /></Line>;
}

export function PhoneIcon(props) {
  return <Line {...props}><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" /></Line>;
}

export function PinIcon(props) {
  return <Line {...props}><path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z" /><circle cx="12" cy="10" r="2.5" /></Line>;
}

export function ClockIcon(props) {
  return <Line {...props}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Line>;
}

export function StarIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="m12 2.5 2.9 6 6.6.8-4.9 4.6 1.3 6.5L12 17.2l-5.9 3.2 1.3-6.5-4.9-4.6 6.6-.8z" />
    </svg>
  );
}

export function TimberIcon(props) {
  return <Line {...props}><ellipse cx="7" cy="12" rx="4" ry="7" /><ellipse cx="7" cy="12" rx="1.6" ry="3" /><path d="M7 5h11c2.2 0 4 3.1 4 7s-1.8 7-4 7H7" /></Line>;
}

export function LayersIcon(props) {
  return <Line {...props}><path d="m12 3 9 5-9 5-9-5z" /><path d="m3 13 9 5 9-5" /></Line>;
}

export function SofaIcon(props) {
  return <Line {...props}><path d="M4 11V8a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v3" /><path d="M2 13a2 2 0 0 1 4 0v2h12v-2a2 2 0 0 1 4 0v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z" /><path d="M5 19v2M19 19v2" /></Line>;
}

export function TruckIcon(props) {
  return <Line {...props}><path d="M1 5h13v11H1zM14 9h4l4 4v3h-8" /><circle cx="5.5" cy="18" r="2" /><circle cx="17.5" cy="18" r="2" /></Line>;
}

export function RulerIcon(props) {
  return <Line {...props}><path d="m3 17 14-14 4 4L7 21z" /><path d="m7 13 2 2M10 10l2 2M13 7l2 2" /></Line>;
}

export function ShieldIcon(props) {
  return <Line {...props}><path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z" /><path d="m9 12 2 2 4-4" /></Line>;
}
