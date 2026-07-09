export function Logo() {
  return (
    <div className="w-7 h-7 rounded-lg bg-blue-500/10 flex items-center justify-center flex-shrink-0 p-1">
      <svg viewBox="0 0 512 512" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="logo-cyan-blue" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#00f2fe" />
            <stop offset="100%" stopColor="#3b82f6" />
          </linearGradient>
          <linearGradient id="logo-blue-purple" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#3b82f6" />
            <stop offset="100%" stopColor="#7c3aed" />
          </linearGradient>
          <linearGradient id="logo-face-top" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#00f2fe" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.15" />
          </linearGradient>
          <linearGradient id="logo-face-left" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#1d4ed8" stopOpacity="0.25" />
          </linearGradient>
          <linearGradient id="logo-face-right" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.20" />
            <stop offset="100%" stopColor="#4f46e5" stopOpacity="0.20" />
          </linearGradient>
          <filter id="logo-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="12" stdDeviation="16" floodColor="#3b82f6" floodOpacity="0.45" />
          </filter>
        </defs>

        {/* 3D Extrusion Side Faces */}
        <polygon points="320,60 140,240 170,260 350,80" fill="url(#logo-face-left)" />
        <polygon points="140,240 230,240 260,260 170,260" fill="url(#logo-face-top)" />
        <polygon points="230,240 180,450 210,470 260,260" fill="url(#logo-face-left)" />
        <polygon points="180,450 340,270 370,290 210,470" fill="url(#logo-face-right)" />
        <polygon points="340,270 250,270 280,290 370,290" fill="url(#logo-face-top)" />
        <polygon points="250,270 320,60 350,80 280,290" fill="url(#logo-face-right)" />

        {/* Front Face Fill */}
        <polygon points="320,60 140,240 230,240 180,450 340,270 250,270" fill="url(#logo-face-top)" />

        {/* Thin Mesh Subdivision Lines (internal wireframe details) */}
        <g stroke="url(#logo-cyan-blue)" strokeWidth="10" strokeOpacity="0.75" strokeLinecap="round" strokeLinejoin="round">
          {/* Front face triangulation lines */}
          <line x1="320" y1="60" x2="230" y2="240" />
          <line x1="140" y1="240" x2="250" y2="270" />
          <line x1="230" y1="240" x2="250" y2="270" />
          <line x1="230" y1="240" x2="340" y2="270" />
          <line x1="180" y1="450" x2="250" y2="270" />
          
          {/* Back face triangulation lines */}
          <line x1="350" y1="80" x2="260" y2="260" />
          <line x1="170" y1="260" x2="280" y2="290" />
          <line x1="260" y1="260" x2="280" y2="290" />
          <line x1="260" y1="260" x2="370" y2="290" />
          <line x1="210" y1="470" x2="280" y2="290" />
        </g>

        {/* Thick Outer Boundary and Inner Main Edges */}
        <g stroke="url(#logo-blue-purple)" strokeWidth="22" strokeLinecap="round" strokeLinejoin="round" filter="url(#logo-glow)">
          {/* Front outline */}
          <polygon points="320,60 140,240 230,240 180,450 340,270 250,270" fill="none" />
          
          {/* Extrusion edges */}
          <line x1="320" y1="60" x2="350" y2="80" />
          <line x1="140" y1="240" x2="170" y2="260" />
          <line x1="230" y1="240" x2="260" y2="260" />
          <line x1="180" y1="450" x2="210" y2="470" />
          <line x1="340" y1="270" x2="370" y2="290" />
          <line x1="250" y1="270" x2="280" y2="290" />
        </g>

        {/* Glowing Mesh Nodes */}
        <g fill="#ffffff">
          {/* Front nodes */}
          <circle cx="320" cy="60" r="18" stroke="#7c3aed" strokeWidth="8" />
          <circle cx="140" cy="240" r="18" stroke="#3b82f6" strokeWidth="8" />
          <circle cx="230" cy="240" r="18" stroke="#3b82f6" strokeWidth="8" />
          <circle cx="180" cy="450" r="18" stroke="#7c3aed" strokeWidth="8" />
          <circle cx="340" cy="270" r="18" stroke="#3b82f6" strokeWidth="8" />
          <circle cx="250" cy="270" r="18" stroke="#3b82f6" strokeWidth="8" />
          
          {/* Back nodes */}
          <circle cx="350" cy="80" r="11" stroke="#00f2fe" strokeWidth="5" />
          <circle cx="170" cy="260" r="11" stroke="#00f2fe" strokeWidth="5" />
          <circle cx="260" cy="260" r="11" stroke="#00f2fe" strokeWidth="5" />
          <circle cx="210" cy="470" r="11" stroke="#00f2fe" strokeWidth="5" />
          <circle cx="370" cy="290" r="11" stroke="#00f2fe" strokeWidth="5" />
          <circle cx="280" cy="290" r="11" stroke="#00f2fe" strokeWidth="5" />
        </g>
      </svg>
    </div>
  );
}
