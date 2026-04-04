import { useState, useRef, useEffect } from 'react';

export default function LabelStyleToggle({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="label-toggle" ref={ref}>
      <button
        className="label-toggle-btn"
        onClick={() => setOpen(!open)}
        title="Map label style"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
        </svg>
      </button>
      {open && (
        <div className="label-toggle-menu">
          <div className="label-toggle-title">Label style</div>
          <button
            className={`label-toggle-option${value === 'classic' ? ' active' : ''}`}
            onClick={() => { onChange('classic'); setOpen(false); }}
          >
            <span className="label-toggle-preview label-toggle-preview-classic">
              <span className="ltp-pill">1.85</span>
              <span className="ltp-arrow" />
            </span>
            Classic
          </button>
          <button
            className={`label-toggle-option${value === 'pin' ? ' active' : ''}`}
            onClick={() => { onChange('pin'); setOpen(false); }}
          >
            <span className="label-toggle-preview label-toggle-preview-pin">
              <span className="ltp-circle" />
              <span className="ltp-ribbon">1.85</span>
              <span className="ltp-arrow" />
            </span>
            Pin
          </button>
        </div>
      )}
    </div>
  );
}
