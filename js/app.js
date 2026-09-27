/**
 * MeshMind — APP / RENDER LOGIC
 * ---------------------------------------------------------------------------
 * This file only reads from MESH_DATA (js/data.js) and renders the DOM.
 * When real data sources are wired up, keep the render*() function
 * signatures the same and swap out where the data comes from —
 * e.g. `getSelectedMachine()` could fetch from an API instead of an array.
 * ---------------------------------------------------------------------------
 */

// ---- App state --------------------------------------------------------
let selectedMachineId = MESH_DATA.machines[0].id;

// Per-machine UI state that isn't "real" data yet, just interaction state
// for this shell (technician verification decision, sync in-progress flag).
const uiState = {};
MESH_DATA.machines.forEach((m) => {
  uiState[m.id] = {
    verificationStatus: m.verification.status, // not_required | pending | confirmed | rejected
    syncStatus: m.sync.status, // synced | pending | local_only | syncing
  };
});

function getSelectedMachine() {
  return MESH_DATA.machines.find((m) => m.id === selectedMachineId);
}

function evaluateMachineAnomalies() {
  MESH_DATA.machines.forEach((machine) => {
    AnomalyDetector.evaluate(machine.id, SensorSimulator.getReadings(machine.id));
  });
}

// ---- Render: header status ---------------------------------------------
function renderHeaderStatus() {
  const el = document.getElementById("header-status");
  const { cloud, localNetwork } = MESH_DATA;

  el.innerHTML = `
    <div class="status-pill">
      <span class="dot ${cloud.connected ? "green" : "red"}"></span>
      <span class="label">${cloud.label}</span>
      <span class="value">${cloud.connected ? "Connected" : "Offline"}</span>
    </div>
    <div class="status-pill">
      <span class="dot ${localNetwork.connected ? "cyan" : "red"}"></span>
      <span class="label">${localNetwork.label}</span>
      <span class="value">${localNetwork.connected ? "Connected" : "Offline"}</span>
    </div>
  `;
}

// ---- Render: machine list + detail --------------------------------------
function statusDotClass(status) {
  if (status === "operational" || status === "normal") return "green";
  if (status === "warning") return "amber";
  if (status === "critical") return "red";
  return "grey";
}

function renderMachineList() {
  const el = document.getElementById("machine-list");
  el.innerHTML = MESH_DATA.machines
    .map((m) => `
      <button class="machine-item ${m.id === selectedMachineId ? "active" : ""}" data-machine-id="${m.id}">
        <span>
          <div class="m-name">${m.name}</div>
          <div class="m-loc">${m.location} · ${m.type}</div>
        </span>
        <span class="m-status-dot" style="background: var(--${
          statusDotClass(AnomalyDetector.getState(m.id).state.toLowerCase()) === "grey" ? "text-faint" : statusDotClass(AnomalyDetector.getState(m.id).state.toLowerCase())
        })"></span>
      </button>
    `)
    .join("");

  el.querySelectorAll(".machine-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedMachineId = btn.dataset.machineId;
      renderAll();
    });
  });
}

function renderMachineDetail() {
  const el = document.getElementById("machine-detail");
  const m = getSelectedMachine();
  const anomaly = AnomalyDetector.getState(m.id);
  const anomalyDetails = anomaly.detected ? `
    <div class="anomaly-notice ${anomaly.state.toLowerCase()}" role="status">
      <div class="anomaly-title">ANOMALY DETECTED · ${anomaly.state}</div>
      <div class="anomaly-time">Detected ${new Date(anomaly.timestamp).toLocaleTimeString()}</div>
      <ul class="anomaly-sensors">
        ${anomaly.triggeredSensors.map((item) => `<li>${item.sensor}: ${item.value.toFixed(1)} ${item.unit} (threshold ${item.threshold} ${item.unit}) — ${item.state}</li>`).join("")}
      </ul>
    </div>
  ` : "";

  el.innerHTML = `
    <div class="detail-row"><span class="k">Machine ID</span><span class="v">${m.id}</span></div>
    <div class="detail-row"><span class="k">Location</span><span class="v">${m.location}</span></div>
    <div class="detail-row"><span class="k">Machine Type</span><span class="v">${m.type}</span></div>
    <div class="detail-row"><span class="k">Operating Status</span><span class="v">${m.operatingStatus}</span></div>
    <div class="detail-row"><span class="k">Sensor State</span><span class="v">${m.sensorState}</span></div>
    <div class="detail-row"><span class="k">Machine Status</span><span class="v machine-state ${anomaly.state.toLowerCase()}">${anomaly.state}</span></div>
    ${anomalyDetails}
    <button class="btn btn-demo" id="btn-demo-anomaly">Trigger Demo Anomaly on Machine B</button>
  `;

  document.getElementById("btn-demo-anomaly").addEventListener("click", () => {
    if (SensorSimulator.triggerDemoAnomaly("M-B-002")) {
      selectedMachineId = "M-B-002";
      evaluateMachineAnomalies();
      renderAll();
    }
  });
}

// ---- Render: sensors -----------------------------------------------------
function renderSensors() {
  const el = document.getElementById("sensor-grid");
  const sensors = SensorSimulator.getReadings(getSelectedMachine().id);
  const anomaly = AnomalyDetector.getState(getSelectedMachine().id);
  const triggeredKeys = new Set(anomaly.triggeredSensors.map((sensor) => sensor.sensorKey));

  const labels = {
    temperature: "Temperature",
    vibration: "Vibration",
    current: "Current",
    pressure: "Pressure",
  };

  el.innerHTML = Object.entries(sensors)
    .map(([key, s]) => `
      <div class="sensor-card ${triggeredKeys.has(key) ? `anomaly-sensor ${anomaly.state.toLowerCase()}` : ""}">
        <div class="s-label">${labels[key]}</div>
        <div class="s-value">${s.value.toFixed(1)}<span class="s-unit">${s.unit}</span></div>
        <div class="s-range">${s.range}</div>
      </div>
    `)
    .join("");
}

// ---- Render: local memory --------------------------------------------
function renderMemory() {
  const el = document.getElementById("memory-panel");
  const machineId = getSelectedMachine().id;
  el.innerHTML = '<div class="badge grey">Loading local memory…</div>';
  fetch("http://127.0.0.1:8000/api/memory/status").then((response) => {
    if (!response.ok) throw new Error("Memory status unavailable");
    return response.json();
  }).then((status) => {
    const machineMemory = status.machines.find((entry) => entry.machine_id === machineId);
    if (!machineMemory) throw new Error("Machine memory status unavailable");
    const payloadRequest = machineId === "M-A-001"
      ? fetch(`http://127.0.0.1:8000/api/memory/machine/${machineId}`).then((response) => {
        if (!response.ok) throw new Error("Machine memory unavailable");
        return response.json();
      })
      : Promise.resolve(null);
    return payloadRequest.then((payload) => ({ status, machineMemory, payload }));
  }).then(({ status, machineMemory, payload }) => {
    if (getSelectedMachine().id !== machineId) return;
    el.innerHTML = `
      <div class="memory-backend-status"><span class="dot ${status.status === "online" ? "green" : "red"}"></span><strong>Local Memory: ${status.status.toUpperCase()}</strong></div>
      <div class="detail-row"><span class="k">Memory Owner</span><span class="v">${machineMemory.machine_id}</span></div>
      <div class="detail-row"><span class="k">Memory Backend</span><span class="v">${machineMemory.memory_backend}</span></div>
      <div class="detail-row"><span class="k">Stored Memories</span><span class="v">${machineMemory.memory_count}</span></div>
      ${payload ? `
        <div class="info-box memory-incident">
          <div class="i-title">Historical Incident</div>
          <div class="i-body">${payload.incident_type}</div>
          <div class="i-title memory-subtitle">Symptoms</div>
          <ul>${payload.symptoms.map((symptom) => `<li>${symptom}</li>`).join("")}</ul>
          <div class="i-title memory-subtitle">Technician</div>
          <ul>${payload.technician_action.split(";").map((action) => {
            const trimmed = action.trim();
            return `<li>${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}</li>`;
          }).join("")}<li>Diagnosis ${payload.confirmed ? "confirmed" : "not confirmed"}</li></ul>
        </div>
      ` : `<div class="info-box memory-incident"><div class="i-title">Historical Incident</div><div class="memory-empty">No useful historical memory</div></div>`}
    `;
  }).catch(() => {
    if (getSelectedMachine().id !== machineId) return;
    el.innerHTML = '<div class="memory-unavailable">Local memory backend unavailable</div>';
  });
}

// ---- Render: peer knowledge --------------------------------------------
function renderPeers() {
  const el = document.getElementById("peer-panel");
  const { peers } = getSelectedMachine();

  el.innerHTML = `
    <div class="i-title" style="margin-bottom:8px;">Nearby machines</div>
    <div class="tag-list">
      ${peers.nearby.map((p) => `<span class="tag">${p}</span>`).join("")}
    </div>
    <div style="margin: 12px 0;">
      <span class="badge ${peers.contacted ? "cyan" : "grey"}">
        ${peers.contacted ? `Contacted — ${peers.contactedPeer}` : "No peer contacted"}
      </span>
    </div>
    <div class="info-box">
      <div class="i-title">Retrieved knowledge</div>
      <div class="i-body">${peers.retrieval}</div>
    </div>
  `;
}

// ---- Render: AI recommendation ------------------------------------------
function renderAI() {
  const el = document.getElementById("ai-panel");
  const { ai } = getSelectedMachine();

  el.innerHTML = `
    <div class="ai-head">
      <div>
        <div class="ai-diagnosis">${ai.diagnosis}</div>
        <div class="ai-sub">Based on local memory + peer knowledge</div>
      </div>
      <div class="confidence-block">
        <div class="confidence-value">${ai.confidence}%</div>
        <div class="confidence-label">Confidence</div>
        <div class="confidence-bar"><div class="confidence-bar-fill" style="width:${ai.confidence}%"></div></div>
      </div>
    </div>
    <ul class="evidence-list">
      ${ai.evidence.map((e) => `<li>${e}</li>`).join("")}
    </ul>
    <div class="action-box">
      <div class="a-label">Recommended action</div>
      <div>${ai.action}</div>
    </div>
  `;
}

// ---- Render: technician verification ------------------------------------
function renderVerification() {
  const el = document.getElementById("verification-panel");
  const m = getSelectedMachine();
  const state = uiState[m.id];

  if (state.verificationStatus === "not_required") {
    el.innerHTML = `
      <div class="verify-row">
        <div class="verify-summary">No anomaly flagged — nothing for a technician to verify right now.</div>
      </div>
    `;
    return;
  }

  const resultText = {
    pending: "Awaiting technician review.",
    confirmed: "Confirmed by technician — ready to sync as validated knowledge.",
    rejected: "Rejected by technician — will not be synced to Qdrant Cloud.",
  }[state.verificationStatus];

  el.innerHTML = `
    <div class="verify-row">
      <div class="verify-summary">
        AI recommends: <strong>${m.ai.action}</strong>
      </div>
      <div class="btn-group">
        <button class="btn btn-confirm" id="btn-confirm" ${state.verificationStatus !== "pending" ? "disabled" : ""}>Confirm</button>
        <button class="btn btn-reject" id="btn-reject" ${state.verificationStatus !== "pending" ? "disabled" : ""}>Reject</button>
      </div>
    </div>
    <div class="verify-result">${resultText}</div>
  `;

  const confirmBtn = document.getElementById("btn-confirm");
  const rejectBtn = document.getElementById("btn-reject");

  if (confirmBtn) {
    confirmBtn.addEventListener("click", () => {
      uiState[m.id].verificationStatus = "confirmed";
      uiState[m.id].syncStatus = "pending";
      renderVerification();
      renderSync();
    });
  }
  if (rejectBtn) {
    rejectBtn.addEventListener("click", () => {
      uiState[m.id].verificationStatus = "rejected";
      uiState[m.id].syncStatus = "local_only";
      renderVerification();
      renderSync();
    });
  }
}

// ---- Render: synchronization ---------------------------------------------
function syncStatusMeta(status) {
  switch (status) {
    case "synced": return { label: "Synced", badge: "green", dot: "green" };
    case "pending": return { label: "Pending Sync", badge: "amber", dot: "amber" };
    case "syncing": return { label: "Syncing…", badge: "cyan", dot: "cyan" };
    case "local_only": return { label: "Local Only", badge: "grey", dot: "grey" };
    default: return { label: status, badge: "grey", dot: "grey" };
  }
}

function renderSync() {
  const el = document.getElementById("sync-panel");
  const m = getSelectedMachine();
  const state = uiState[m.id];
  const meta = syncStatusMeta(state.syncStatus);
  const canSyncNow = state.syncStatus === "pending";

  el.innerHTML = `
    <div class="sync-row">
      <div class="sync-status-block">
        <span class="dot ${meta.dot}"></span>
        <div class="sync-status-text">
          <div class="s-title">${meta.label}</div>
          <div class="s-meta">Last synced: ${m.sync.lastSynced}</div>
        </div>
      </div>
      <button class="btn btn-primary" id="btn-sync-now" ${canSyncNow ? "" : "disabled"}>Sync Now</button>
    </div>
  `;

  const syncBtn = document.getElementById("btn-sync-now");
  if (syncBtn) {
    syncBtn.addEventListener("click", () => {
      uiState[m.id].syncStatus = "syncing";
      renderSync();
      // Simulated sync delay — replace with a real Qdrant Cloud sync call.
      setTimeout(() => {
        uiState[m.id].syncStatus = "synced";
        m.sync.lastSynced = "Just now";
        renderSync();
      }, 900);
    });
  }
}

// ---- Render everything ----------------------------------------------------
function renderAll() {
  renderHeaderStatus();
  renderMachineList();
  renderMachineDetail();
  renderSensors();
  renderMemory();
  renderPeers();
  renderAI();
  renderVerification();
  renderSync();
}

document.addEventListener("DOMContentLoaded", () => {
  evaluateMachineAnomalies();
  renderAll();
  SensorSimulator.start(() => {
    evaluateMachineAnomalies();
    renderMachineList();
    renderMachineDetail();
    renderSensors();
  });
});
