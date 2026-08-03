import "./Sidebar.css";

export type View = "library" | "settings";

interface SidebarProps {
  view: View;
  onNavigate: (view: View) => void;
}

export function Sidebar({ view, onNavigate }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        {/* Icon and wordmark as two separate images (not the combined
            lockup) so only the ribbon pulses -- animating the combined
            image would make the "FlowCue AI" text pulse too. */}
        <img src="/logo-icon.png" alt="" className="sidebar__logoIcon" />
        <img src="/logo-wordmark.png" alt="FlowCue AI" className="sidebar__logoWordmark" />
      </div>
      <nav className="sidebar__nav">
        <button
          className={"sidebar__navItem" + (view === "library" ? " sidebar__navItem--active" : "")}
          onClick={() => onNavigate("library")}
        >
          <svg className="sidebar__navIcon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path
              d="M5 3.5h7.5L16 7v9.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1Z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
            <path d="M12.2 3.5V7h3.6" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            <path d="M6.7 10.5h6.6M6.7 13h6.6M6.7 8h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          Scripts
        </button>
        <button
          className={"sidebar__navItem" + (view === "settings" ? " sidebar__navItem--active" : "")}
          onClick={() => onNavigate("settings")}
        >
          <svg className="sidebar__navIcon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <circle cx="10" cy="10" r="2.6" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="M10 3.2v1.6M10 15.2v1.6M16.8 10h-1.6M4.8 10H3.2M14.9 5.1l-1.1 1.1M6.2 13.7l-1.1 1.1M14.9 14.9l-1.1-1.1M6.2 6.2 5.1 5.1"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          Settings
        </button>
      </nav>
      <div className="sidebar__footer">
        <div className="sidebar__account">craig.faris@gmail.com</div>
        <div className="sidebar__version">FlowCue AI — v0.2 (web MVP)</div>
      </div>
    </aside>
  );
}
