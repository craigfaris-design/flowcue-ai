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
        <img src="/logo.png" alt="" className="sidebar__logo" />
        FlowCue AI
      </div>
      <nav className="sidebar__nav">
        <button
          className={"sidebar__navItem" + (view === "library" ? " sidebar__navItem--active" : "")}
          onClick={() => onNavigate("library")}
        >
          Scripts
        </button>
        <button
          className={"sidebar__navItem" + (view === "settings" ? " sidebar__navItem--active" : "")}
          onClick={() => onNavigate("settings")}
        >
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
