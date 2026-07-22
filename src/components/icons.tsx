// Minimal inline SVG icons (no icon lib — keeps the bundle lean & offline).
export function Icon({ name }: { name: string }) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    viewBox: '0 0 24 24',
  }
  switch (name) {
    case 'today':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 12l4-2M12 12v-5" />
        </svg>
      )
    case 'log':
      return (
        <svg {...common}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      )
    case 'progress':
      return (
        <svg {...common}>
          <path d="M4 19V5M4 19h16M8 15l3-4 3 2 4-6" />
        </svg>
      )
    case 'villain':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M7 14l3-3M17 14l-3-3M9 9h.01M15 9h.01" />
        </svg>
      )
    case 'reckoning':
      return (
        <svg {...common}>
          <path d="M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
        </svg>
      )
    case 'settings':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19 12a7 7 0 00-.1-1l2-1.5-2-3.4-2.3 1a7 7 0 00-1.7-1L14.5 2h-4l-.4 2.6a7 7 0 00-1.7 1l-2.3-1-2 3.4 2 1.5a7 7 0 000 2l-2 1.5 2 3.4 2.3-1a7 7 0 001.7 1l.4 2.6h4l.4-2.6a7 7 0 001.7-1l2.3 1 2-3.4-2-1.5c.06-.3.1-.66.1-1z" />
        </svg>
      )
    case 'check':
      return (
        <svg {...common} width="18" height="18">
          <path d="M5 12l5 5L20 6" />
        </svg>
      )
    case 'flame':
      return (
        <svg {...common}>
          <path d="M12 2s5 5 5 10a5 5 0 01-10 0c0-2 1-3 1-3s3 2 4-7z" />
        </svg>
      )
    case 'snow':
      return (
        <svg {...common}>
          <path d="M12 2v20M4 6l16 12M20 6L4 18" />
        </svg>
      )
    default:
      return null
  }
}
