/* ============================================
   AGENT NEURAL NETWORK — graph.js
   Physics-based force-directed swarm view
   ============================================ */

const GRAPH_NODES = [
  { id: 'orch',  label: 'Orchestrator', icon: 'orch', color: '#a855f7', type: 'core' },
  { id: 'code',  label: 'Code',         icon: 'code', color: '#3b82f6', type: 'sub' },
  { id: 'ui',    label: 'UI Design',    icon: 'ui',   color: '#ec4899', type: 'sub' },
  { id: 'sec',   label: 'Security',     icon: 'sec',  color: '#10b981', type: 'sub' },
  { id: 'db',    label: 'Knowledge',    icon: 'db',   color: '#f59e0b', type: 'sub' },
  { id: 'qa',    label: 'QA Tester',    icon: 'qa',   color: '#ef4444', type: 'sub' },
  { id: 'web',   label: 'Web Search',   icon: 'web',  color: '#06b6d4', type: 'sub' },
  { id: 'sys',   label: 'System',       icon: 'sys',  color: '#6366f1', type: 'sub' },
];

const GRAPH_LINKS = ['code', 'ui', 'sec', 'db', 'qa', 'web', 'sys']
  .map(id => ({ source: 'orch', target: id }));

// Inline SVG icons (lucide-style paths)
const NODE_SVGS = {
  orch: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 2a4 4 0 0 1 4 4c0 1.5-.8 2.8-2 3.5V12h-4V9.5A4 4 0 0 1 12 2z"/>
    <rect x="8" y="12" width="8" height="4" rx="1"/>
    <path d="M8 16v2a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-2"/>
    <line x1="9" y1="8" x2="9" y2="8.01"/><line x1="15" y1="8" x2="15" y2="8.01"/>
  </svg>`,
  code: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
  </svg>`,
  ui: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/>
  </svg>`,
  sec: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
  </svg>`,
  db: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
  </svg>`,
  qa: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M8 6l4-4 4 4"/><path d="M12 2v10.3"/><path d="M4.93 10.93A10 10 0 1 0 19.07 10.93"/>
  </svg>`,
  web: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <line x1="2" y1="12" x2="22" y2="12"/>
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
  </svg>`,
  sys: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/>
    <line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>
  </svg>`,
};

let graphNodes = GRAPH_NODES.map(n => ({
  ...n,
  x: (Math.random() - 0.5) * 200,
  y: (Math.random() - 0.5) * 200,
  vx: 0, vy: 0,
}));

let graphAnimFrame = null;
let graphVisible = false;

// ── Active node pulse state ──────────────────────────────────────────────────
let activeNodeId = null;
const pulseTimers = {};

function pulseNode(nodeId) {
  const el = document.querySelector(`#graph-node-${nodeId} .graph-node-circle`);
  if (!el) return;
  el.classList.add('graph-pulse');
  clearTimeout(pulseTimers[nodeId]);
  pulseTimers[nodeId] = setTimeout(() => el.classList.remove('graph-pulse'), 800);
}

// ── Build DOM ────────────────────────────────────────────────────────────────
function initGraph() {
  const container = document.getElementById('agent-graph-view');
  const svg = document.getElementById('graph-svg');

  // Remove old nodes
  container.querySelectorAll('.graph-node').forEach(el => el.remove());

  // Randomise positions fresh each open
  graphNodes = graphNodes.map(n => ({
    ...n,
    x: (Math.random() - 0.5) * 220,
    y: (Math.random() - 0.5) * 220,
    vx: 0, vy: 0,
  }));

  // Create node divs
  graphNodes.forEach(n => {
    const size = n.type === 'core' ? 58 : 44;
    const iconSize = n.type === 'core' ? 22 : 17;

    const div = document.createElement('div');
    div.className = 'graph-node';
    div.id = `graph-node-${n.id}`;

    div.innerHTML = `
      <div class="graph-node-circle" style="
        width:${size}px; height:${size}px;
        border:2px solid ${n.color};
        box-shadow: 0 0 14px ${n.color}55;
        color:${n.color};
      ">
        <span style="width:${iconSize}px;height:${iconSize}px;display:flex;align-items:center;justify-content:center">
          ${NODE_SVGS[n.icon] || ''}
        </span>
      </div>
      <div class="graph-node-label" style="color:${n.color}">${n.label}</div>
    `;

    const circle = div.querySelector('.graph-node-circle');
    circle.addEventListener('mouseenter', () => {
      circle.style.boxShadow = `0 0 28px ${n.color}99, 0 0 8px ${n.color}`;
      circle.style.transform = 'scale(1.12)';
    });
    circle.addEventListener('mouseleave', () => {
      circle.style.boxShadow = `0 0 14px ${n.color}55`;
      circle.style.transform = 'scale(1)';
    });

    container.appendChild(div);
  });

  // Build SVG connection lines
  svg.innerHTML = `<defs>
    <filter id="glow">
      <feGaussianBlur stdDeviation="2" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>`;

  GRAPH_LINKS.forEach((l, i) => {
    const target = GRAPH_NODES.find(n => n.id === l.target);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.id = `graph-line-${i}`;
    line.setAttribute('stroke', target ? target.color + '44' : 'rgba(255,255,255,0.12)');
    line.setAttribute('stroke-width', '1.5');
    line.setAttribute('filter', 'url(#glow)');
    svg.appendChild(line);
  });

  // Animated particle on each link
  GRAPH_LINKS.forEach((l, i) => {
    const target = GRAPH_NODES.find(n => n.id === l.target);
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.id = `graph-particle-${i}`;
    circle.setAttribute('r', '3');
    circle.setAttribute('fill', target ? target.color : '#fff');
    circle.setAttribute('opacity', '0.8');
    svg.appendChild(circle);
  });
}

// ── Physics tick ─────────────────────────────────────────────────────────────
let particleProgress = GRAPH_LINKS.map(() => Math.random());

function tickGraph() {
  const container = document.getElementById('agent-graph-view');
  if (!container || !graphVisible) return;

  const cx = container.clientWidth / 2;
  const cy = container.clientHeight / 2;

  // Physics
  graphNodes = graphNodes.map((n, i) => {
    let fx = -n.x * 0.012, fy = -n.y * 0.012;

    graphNodes.forEach((o, j) => {
      if (i === j) return;
      const dx = n.x - o.x, dy = n.y - o.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = 2200 / (d * d);
      fx += (dx / d) * f;
      fy += (dy / d) * f;
    });

    GRAPH_LINKS.filter(l => l.source === n.id || l.target === n.id).forEach(l => {
      const otherId = l.source === n.id ? l.target : l.source;
      const o = graphNodes.find(p => p.id === otherId);
      if (!o) return;
      const dx = n.x - o.x, dy = n.y - o.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - 130) * 0.022;
      fx -= (dx / d) * f;
      fy -= (dy / d) * f;
    });

    const vx = (n.vx + fx) * 0.9;
    const vy = (n.vy + fy) * 0.9;
    return { ...n, x: n.x + vx, y: n.y + vy, vx, vy };
  });

  // Update node positions
  graphNodes.forEach(n => {
    const el = document.getElementById(`graph-node-${n.id}`);
    if (el) {
      el.style.left = `${cx + n.x}px`;
      el.style.top = `${cy + n.y}px`;
    }
  });

  // Update lines + particles
  GRAPH_LINKS.forEach((l, i) => {
    const line = document.getElementById(`graph-line-${i}`);
    const particle = document.getElementById(`graph-particle-${i}`);
    const s = graphNodes.find(n => n.id === l.source);
    const t = graphNodes.find(n => n.id === l.target);
    if (!s || !t || !line) return;

    const sx = cx + s.x, sy = cy + s.y;
    const tx = cx + t.x, ty = cy + t.y;

    line.setAttribute('x1', sx); line.setAttribute('y1', sy);
    line.setAttribute('x2', tx); line.setAttribute('y2', ty);

    // Animate particle along link
    if (particle) {
      particleProgress[i] = (particleProgress[i] + 0.006) % 1;
      const p = particleProgress[i];
      particle.setAttribute('cx', sx + (tx - sx) * p);
      particle.setAttribute('cy', sy + (ty - sy) * p);
    }
  });

  graphAnimFrame = requestAnimationFrame(tickGraph);
}

// ── Show / hide ───────────────────────────────────────────────────────────────
function showAgentGraph() {
  graphVisible = true;
  const view = document.getElementById('agent-graph-view');
  view.style.display = 'block';
  initGraph();
  if (graphAnimFrame) cancelAnimationFrame(graphAnimFrame);
  graphAnimFrame = requestAnimationFrame(tickGraph);

  // Staggered pulse at start
  graphNodes.forEach((n, i) => setTimeout(() => pulseNode(n.id), i * 120));
}

function hideAgentGraph() {
  graphVisible = false;
  document.getElementById('agent-graph-view').style.display = 'none';
  if (graphAnimFrame) { cancelAnimationFrame(graphAnimFrame); graphAnimFrame = null; }
}

function toggleAgentGraph() {
  const view = document.getElementById('agent-graph-view');
  const btn = document.getElementById('graph-toggle-btn');
  if (!graphVisible) {
    showAgentGraph();
    btn.classList.add('active');
  } else {
    hideAgentGraph();
    btn.classList.remove('active');
  }
}
