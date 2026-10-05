import React from 'react';
import './ElectricBorder.css';

/**
 * ElectricBorder — wraps children in an animated, crackling
 * electric border effect using SVG feTurbulence displacement.
 *
 * Usage:
 *   <ElectricBorder>
 *     <YourContent />
 *   </ElectricBorder>
 */
function ElectricBorder({ children }) {
  return (
    <>
      {/* SVG filter definition — lives in the DOM but is invisible */}
      <svg className="electric-svg-container">
        <defs>
          <filter
            id="turbulent-displace"
            colorInterpolationFilters="sRGB"
            x="-20%"
            y="-20%"
            width="140%"
            height="140%"
          >
            {/* Noise layer 1 — scrolls downward */}
            <feTurbulence type="turbulence" baseFrequency="0.02" numOctaves="10" result="noise1a" seed="1" />
            <feOffset in="noise1a" dx="0" dy="0" result="offsetNoise1">
              <animate attributeName="dy" values="700; 0" dur="6s" repeatCount="indefinite" calcMode="linear" />
            </feOffset>

            {/* Noise layer 2 — scrolls upward */}
            <feTurbulence type="turbulence" baseFrequency="0.02" numOctaves="10" result="noise2a" seed="1" />
            <feOffset in="noise2a" dx="0" dy="0" result="offsetNoise2">
              <animate attributeName="dy" values="0; -700" dur="6s" repeatCount="indefinite" calcMode="linear" />
            </feOffset>

            {/* Noise layer 3 — scrolls rightward */}
            <feTurbulence type="turbulence" baseFrequency="0.02" numOctaves="10" result="noise3a" seed="2" />
            <feOffset in="noise3a" dx="0" dy="0" result="offsetNoise3">
              <animate attributeName="dx" values="490; 0" dur="6s" repeatCount="indefinite" calcMode="linear" />
            </feOffset>

            {/* Noise layer 4 — scrolls leftward */}
            <feTurbulence type="turbulence" baseFrequency="0.02" numOctaves="10" result="noise4a" seed="2" />
            <feOffset in="noise4a" dx="0" dy="0" result="offsetNoise4">
              <animate attributeName="dx" values="0; -490" dur="6s" repeatCount="indefinite" calcMode="linear" />
            </feOffset>

            {/* Composite noise pairs then blend */}
            <feComposite in="offsetNoise1" in2="offsetNoise2" result="part1" />
            <feComposite in="offsetNoise3" in2="offsetNoise4" result="part2" />
            <feBlend in="part1" in2="part2" mode="color-dodge" result="combinedNoise" />

            {/* Displace the border using the combined noise map */}
            <feDisplacementMap
              in="SourceGraphic"
              in2="combinedNoise"
              scale="30"
              xChannelSelector="R"
              yChannelSelector="B"
            />
          </filter>
        </defs>
      </svg>

      {/* Card structure */}
      <div className="electric-card-container">
        {/* Effect layers — all absolutely positioned, don't affect layout */}
        <div className="electric-inner-container">
          <div className="electric-border-outer">
            <div className="electric-main-card"></div>
          </div>
          <div className="electric-glow-layer-1"></div>
          <div className="electric-glow-layer-2"></div>
        </div>

        <div className="electric-overlay-1"></div>
        <div className="electric-overlay-2"></div>
        <div className="electric-background-glow"></div>

        {/* Actual content — in normal flow, defines the card's height */}
        <div className="electric-content-container">
          {children}
        </div>
      </div>
    </>
  );
}

export default ElectricBorder;
