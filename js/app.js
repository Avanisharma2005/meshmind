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
let cloudStatusSetting = "OFFLINE";
let cloudStatusMessage = "Cloud status has not been checked.";
let cloudLocallyDisabled = false;

// Per-machine UI state that isn't "real" data yet, just interaction state
// for this shell (technician verification decision, sync in-progress flag).
const uiState = {};
const localSearchState = {};
let peerCommunicationState = null;
let aiExplanationState = null;
const verificationStates = {};
let syncQueueState = null;
let gatewayState = null;
let gatewayRequestSequence = 0;
let gatewaySyncInProgress = false;
let globalMemoryState = null;
let machineCRetrievalState = { status: "idle", result: null, error: null };
let gatewaySyncMessage = "";
let lastGatewaySyncItems = [];
MESH_DATA.machines.forEach((m) => {
  uiState[m.id] = {
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

function describeSensorBehavior(key, reading, isTriggered) {
  const labels = { vibration: "vibration", temperature: "temperature", current: "current", pressure: "pressure" };
  if (!reading) return null;
  if (isTriggered) {
    const terms = {
      vibration: "increased vibration",
      temperature: "elevated temperature",
      current: "abnormal current",
      pressure: "abnormal pressure",
    };
    return terms[key] || `abnormal ${labels[key] || key}`;
  }
  return `normal ${labels[key] || key}`;
}

function buildLocalSearchQuery(machine, readings, anomaly) {
  const triggered = new Set(anomaly.triggeredSensors.map((sensor) => sensor.sensorKey));
  const behavior = [];
  ["vibration", "temperature", "current", "pressure"].forEach((key) => {
    const reading = readings[key];
    if (!reading) return;
    if (triggered.has(key)) behavior.push(`${describeSensorBehavior(key, reading, true)} (${reading.value.toFixed(1)} ${reading.unit})`);
    else if (key === "current") behavior.push(`current draw ${reading.value.toFixed(1)} ${reading.unit} (within normal range)`);
  });
  const sensorText = behavior.length ? behavior.join(" and ") : "abnormal sensor behavior";
  const anomalyType = anomaly.triggeredSensors.map((sensor) => `${sensor.sensor.toLowerCase()} anomaly`).join(" and ");
  const operatingCondition = machine.operatingState || machine.operatingStatus || "current operating condition unknown";
  return `${machine.type} experiencing ${sensorText} under ${operatingCondition} operating condition; ${anomalyType || "sensor anomaly"}.`;
}

function updateLocalSearch() {
  const machine = MESH_DATA.machines.find((item) => item.id === "M-B-002");
  const anomaly = AnomalyDetector.getState(machine.id);
  if (!anomaly.detected) {
    localSearchState[machine.id] = { query: "", status: "Waiting for a Machine B anomaly", result: null };
    peerCommunicationState = null;
    aiExplanationState = null;
    return;
  }
  const query = buildLocalSearchQuery(machine, SensorSimulator.getReadings(machine.id), anomaly);
  const current = localSearchState[machine.id];
  if (current?.query === query && (current.status.startsWith("Searching") || current.result)) return;
  peerCommunicationState = null;
  localSearchState[machine.id] = { query, status: "Searching Machine B local memory", result: null };
  if (getSelectedMachine().id === machine.id) renderLocalSearch();
  fetch("http://127.0.0.1:8000/api/memory/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ machine_id: "M-B-002", query }),
  }).then((response) => {
    if (!response.ok) throw new Error("Local memory search unavailable");
    return response.json();
  }).then((result) => {
    if (localSearchState[machine.id]?.query !== query) return;
    localSearchState[machine.id] = {
      query,
      status: "Search complete",
      result,
    };
    if (result.matching_incident) {
      explainCurrentEvidence(query, result, null);
    } else {
      askMachineA(query);
    }
    if (getSelectedMachine().id === machine.id) renderLocalSearch();
  }).catch(() => {
    if (localSearchState[machine.id]?.query !== query) return;
    localSearchState[machine.id] = { query, status: "Local memory backend unavailable", result: null, error: true };
    if (getSelectedMachine().id === machine.id) renderLocalSearch();
  });
}

// ---- Render: header status ---------------------------------------------
function renderHeaderStatus() {
  const el = document.getElementById("header-status");
  const cloudOffline = cloudStatusSetting === "OFFLINE";
  el.innerHTML = `
    <div class="status-pill cloud-status-card" aria-live="polite">
      <span class="dot ${cloudStatusSetting === "CHECKING" ? "amber" : cloudOffline ? "red" : "green"}"></span>
      <div class="status-copy">
        <div><span class="label">CLOUD</span> <span class="value">${cloudStatusSetting}</span></div>
        <div class="status-note">${escapeHTML(cloudStatusMessage)}</div>
      </div>
      <button id="cloud-status-action" class="status-toggle" type="button">${cloudStatusSetting === "ONLINE" ? "SET OFFLINE" : "CHECK / CONNECT"}</button>
    </div>
    <div class="status-pill">
      <span class="dot cyan"></span>
      <span class="status-copy"><span class="label">LOCAL MESH</span> <span class="value">ONLINE</span></span>
    </div>
    <div class="status-pill">
      <span class="dot green"></span>
      <span class="status-copy"><span class="label">LOCAL INTELLIGENCE</span> <span class="value">ACTIVE</span></span>
    </div>
  `;
  document.getElementById("cloud-status-action").addEventListener("click", () => {
    if (cloudStatusSetting === "ONLINE") {
      cloudLocallyDisabled = true;
      cloudStatusSetting = "OFFLINE";
      cloudStatusMessage = "Cloud sync is disabled locally; Local Mesh and Local Intelligence remain active.";
      renderHeaderStatus();
      renderSync();
      renderGateway();
      fetch("http://127.0.0.1:8000/api/gateway/control", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state: "OFFLINE" }),
      }).catch((error) => {
        cloudStatusMessage = `Could not apply local Cloud OFFLINE state: ${error.message}`;
        renderHeaderStatus();
      });
      return;
    }
    cloudLocallyDisabled = false;
    loadCloudStatus(true);
  });
}

function loadCloudStatus(enableCloudSync = false) {
  cloudStatusSetting = "CHECKING";
  cloudStatusMessage = "Checking Qdrant Cloud from the backend…";
  renderHeaderStatus();
  fetch(enableCloudSync ? "http://127.0.0.1:8000/api/gateway/control" : "http://127.0.0.1:8000/api/gateway/status", enableCloudSync ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state: "ONLINE" }),
  } : undefined).then((response) => {
    if (!response.ok) throw new Error("Cloud status check unavailable");
    return response.json();
  }).then((status) => {
    cloudStatusSetting = status.cloud_status === "online" ? "ONLINE" : "OFFLINE";
    cloudLocallyDisabled = false;
    cloudStatusMessage = status.message || (cloudStatusSetting === "ONLINE" ? "Qdrant Cloud reachable." : "Cloud synchronization unavailable.");
    renderHeaderStatus();
    renderSync();
    renderGateway();
  }).catch((error) => {
    cloudStatusSetting = "OFFLINE";
    cloudStatusMessage = error.message;
    renderHeaderStatus();
  });
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
    ${m.id === "M-B-002" ? '<button class="btn btn-demo" id="btn-demo-anomaly">Trigger Demo Anomaly on Machine B</button>' : ""}
  `;

  const demoButton = document.getElementById("btn-demo-anomaly");
  if (demoButton) demoButton.addEventListener("click", () => {
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

function renderLocalSearch() {
  const el = document.getElementById("local-search-panel");
  const machine = getSelectedMachine();
  const state = localSearchState["M-B-002"];
  if (machine.id !== "M-B-002") {
    el.innerHTML = '<div class="memory-empty">Local anomaly search is enabled for Machine B.</div>';
    return;
  }
  if (!state || !state.query) {
    el.innerHTML = `<div class="detail-row"><span class="k">Search status</span><span class="v">${state?.status || "Waiting for a Machine B anomaly"}</span></div>`;
    return;
  }
  const result = state.result;
  const payload = result?.payload;
  el.innerHTML = `
    <div class="detail-row"><span class="k">Search status</span><span class="v">${state.status}</span></div>
    <div class="info-box local-search-query"><div class="i-title">Generated query</div><div class="i-body">${state.query}</div></div>
    ${state.error ? '<div class="memory-unavailable">Local memory backend unavailable</div>' : ""}
    ${result && !result.matching_incident ? '<div class="memory-empty local-search-empty">No useful local match found</div>' : ""}
    ${result?.matching_incident ? `
      <div class="info-box local-search-match">
        <div class="i-title">Matching incident</div><div class="i-body">${result.matching_incident}</div>
        <div class="detail-row local-search-score"><span class="k">Similarity score</span><span class="v">${Number(result.similarity_score).toFixed(4)}</span></div>
        <div class="i-title memory-subtitle">Incident details</div>
        <div class="i-body">${payload?.incident_text || payload?.diagnosis || "Incident details unavailable"}</div>
      </div>
    ` : ""}
  `;
}

// ---- Render: peer knowledge --------------------------------------------
function renderPeers() {
  const el = document.getElementById("peer-panel");
  const state = getSelectedMachine().id === "M-B-002" ? peerCommunicationState : null;
  if (!state) {
    el.textContent = "No peer search performed yet.";
    return;
  }
  const history = state.steps.map((step) => `<div class="detail-row"><span class="k">${step.machine}</span><span class="v">${step.state}</span></div>`).join("");
  const knowledge = state.knowledge ? `
    <div class="info-box local-search-match">
      <div class="i-title">Knowledge received from Machine A (${state.knowledge.source_machine_id})</div>
      <div class="detail-row"><span class="k">Incident type</span><span class="v">${state.knowledge.incident_type}</span></div>
      <div class="detail-row"><span class="k">Symptoms</span><span class="v">${state.knowledge.symptoms.join(", ")}</span></div>
      <div class="detail-row"><span class="k">Machine type</span><span class="v">${state.knowledge.machine_type}</span></div>
      <div class="detail-row"><span class="k">Resolution</span><span class="v">${state.knowledge.resolution}</span></div>
      <div class="detail-row"><span class="k">Technician confirmation</span><span class="v">${state.knowledge.technician_confirmed ? "Confirmed" : "Not confirmed"}</span></div>
      <div class="detail-row"><span class="k">Similarity score</span><span class="v">${Number(state.knowledge.similarity_score).toFixed(4)}</span></div>
    </div>
  ` : "";
  el.innerHTML = `${history}${state.error ? `<div class="memory-unavailable">${state.error}</div>` : ""}${knowledge}`;
}

function askMachineA(query) {
  if (peerCommunicationState?.query === query) return;
  peerCommunicationState = {
    query,
    steps: [
      { machine: "Machine B", state: "ASKING NEARBY MACHINE" },
      { machine: "Machine A", state: "SEARCHING LOCAL MEMORY" },
    ],
    knowledge: null,
    error: null,
  };
  if (getSelectedMachine().id === "M-B-002") renderPeers();
  fetch("http://127.0.0.1:8000/api/machine-a/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requesting_machine_id: "M-B-002", query }),
  }).then((response) => {
    if (!response.ok) throw new Error("Machine A knowledge service unavailable");
    return response.json();
  }).then((knowledge) => {
    if (peerCommunicationState?.query !== query) return;
    peerCommunicationState.steps = [
      { machine: "Machine B", state: "ASKING NEARBY MACHINE" },
      { machine: "Machine A", state: "SEARCHING LOCAL MEMORY" },
      { machine: "Machine A", state: knowledge.found ? "KNOWLEDGE FOUND" : "NO USEFUL MATCH FOUND" },
      { machine: "Machine A", state: "RESPONSE SENT" },
      { machine: "Machine B", state: "KNOWLEDGE RECEIVED" },
    ];
    peerCommunicationState.knowledge = knowledge.found ? knowledge : null;
    peerCommunicationState.error = knowledge.found ? null : "Machine A found no useful local match.";
    explainCurrentEvidence(query, localSearchState["M-B-002"]?.result, knowledge.found ? knowledge : null);
    if (getSelectedMachine().id === "M-B-002") renderPeers();
  }).catch((error) => {
    if (peerCommunicationState?.query !== query) return;
    peerCommunicationState.steps = [
      { machine: "Machine B", state: "ASKING NEARBY MACHINE" },
      { machine: "Machine A", state: "SEARCHING LOCAL MEMORY" },
    ];
    peerCommunicationState.error = error.message;
    explainCurrentEvidence(query, localSearchState["M-B-002"]?.result, null);
    if (getSelectedMachine().id === "M-B-002") renderPeers();
  });
}

// ---- Render: AI recommendation ------------------------------------------
function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function renderAI() {
  const el = document.getElementById("ai-panel");
  const machine = getSelectedMachine();
  const anomaly = AnomalyDetector.getState("M-B-002");
  const state = machine.id === "M-B-002" ? aiExplanationState : null;
  if (!anomaly.detected || !state) {
    el.textContent = "No AI diagnosis performed yet.";
    return;
  }
  if (state.status !== "complete") {
    el.innerHTML = `<div class="memory-unavailable">${escapeHTML(state.error || state.status)}</div>`;
    return;
  }

  const { result, evidence } = state;
  const sensors = evidence.machine_b;
  const local = evidence.machine_b_local_search;
  const peer = evidence.machine_a_peer_knowledge;
  const explanationLabel = result.explanation_source === "gemini"
    ? "AI-generated (Gemini)"
    : `Rule-based fallback (AI unavailable: ${state.aiStatusMessage})`;
  const confidenceMarkup = result.explanation_source === "gemini"
    ? `<div class="confidence-block"><div class="confidence-value">${result.confidence}%</div><div class="confidence-label">Evidence confidence</div><div class="confidence-bar"><div class="confidence-bar-fill" style="width:${result.confidence}%"></div></div></div>`
    : `<div class="confidence-block"><div class="confidence-value">${result.evidence_matched.matched} / ${result.evidence_matched.total}</div><div class="confidence-label">Evidence matched</div></div>`;
  el.innerHTML = `
    <div class="ai-head">
      <div>
        <div class="badge ${result.explanation_source === "gemini" ? "cyan" : "amber"}">${escapeHTML(explanationLabel)}</div>
        <div class="ai-sub">Possible diagnosis</div>
        <div class="ai-diagnosis">${escapeHTML(result.possible_diagnosis)}</div>
        <div class="ai-sub">Generated from the supplied machine and memory evidence; historical similarity is not proof.</div>
      </div>
      ${confidenceMarkup}
    </div>
    <div class="info-box ai-source-box">
      <div class="i-title">Evidence sources used</div>
      <ul class="ai-source-list">
        <li><strong>Machine B current anomaly:</strong> ${escapeHTML(sensors.machine_id)} ${escapeHTML(sensors.machine_type)}, ${escapeHTML(sensors.anomaly_state)}; temperature ${sensors.current_temperature} °C, vibration ${sensors.current_vibration} mm/s, current ${sensors.current_current} A, pressure ${sensors.current_pressure} bar. Triggered: ${escapeHTML(sensors.triggered_sensors.join(", ") || "none")}.</li>
        <li><strong>Machine B local memory:</strong> ${local.useful_match_found ? `${escapeHTML(local.matching_incident)} (similarity ${Number(local.similarity_score).toFixed(4)})` : "No useful local match found."}</li>
        <li><strong>Machine A retrieved knowledge:</strong> ${peer ? `${escapeHTML(peer.incident_type)} from ${escapeHTML(peer.machine_type)} on ${escapeHTML(peer.source_machine_id)} (similarity ${Number(peer.similarity_score).toFixed(4)})` : "No Machine A incident was supplied."}</li>
      </ul>
      <div class="i-meta">Anomaly query: ${escapeHTML(sensors.anomaly_query_description)}</div>
    </div>
    <div class="i-title ai-section-title">Evidence</div>
    <ul class="evidence-list">${result.evidence.map((fact) => `<li>${escapeHTML(fact)}</li>`).join("")}</ul>
    <div class="action-box">
      <div class="a-label">Recommendation</div>
      <div>${escapeHTML(result.recommendation)}</div>
    </div>
  `;
}

function explanationEvidenceFingerprint(evidence) {
  const sensor = evidence.machine_b;
  const local = evidence.machine_b_local_search;
  const peer = evidence.machine_a_peer_knowledge;
  const roundedScore = (score) => score == null ? null : Math.round(Number(score) * 10) / 10;
  return JSON.stringify({
    machine_id: sensor.machine_id,
    machine_type: sensor.machine_type,
    anomaly_state: sensor.anomaly_state,
    triggered_sensors: [...sensor.triggered_sensors].sort(),
    triggered_values: Object.fromEntries(sensor.triggered_sensors.map((key) => [key, sensor[`current_${key}`]])),
    local_match: [local.useful_match_found, local.matching_incident, roundedScore(local.similarity_score)],
    peer: peer && [peer.source_machine_id, peer.incident_type, peer.symptoms, peer.machine_type, peer.resolution, peer.technician_confirmed, roundedScore(peer.similarity_score)],
  });
}

function explainCurrentEvidence(query, localResult, peerKnowledge) {
  const machine = MESH_DATA.machines.find((item) => item.id === "M-B-002");
  const anomaly = AnomalyDetector.getState(machine.id);
  if (!anomaly.detected || !localResult) return;
  const currentDecision = aiExplanationState && verificationStates[aiExplanationState.fingerprint];
  if (currentDecision && (currentDecision.status || currentDecision.pending)) return;
  const readings = SensorSimulator.getReadings(machine.id);
  const evidence = {
    machine_b: {
      machine_id: machine.id,
      machine_type: machine.type,
      current_temperature: readings.temperature.value,
      current_vibration: readings.vibration.value,
      current_current: readings.current.value,
      current_pressure: readings.pressure.value,
      anomaly_state: anomaly.state,
      triggered_sensors: anomaly.triggeredSensors.map((item) => item.sensorKey),
      anomaly_query_description: query,
    },
    machine_b_local_search: {
      useful_match_found: Boolean(localResult.matching_incident),
      matching_incident: localResult.matching_incident || null,
      similarity_score: localResult.similarity_score ?? null,
    },
    machine_a_peer_knowledge: peerKnowledge ? {
      source_machine_id: peerKnowledge.source_machine_id,
      incident_type: peerKnowledge.incident_type,
      symptoms: peerKnowledge.symptoms,
      machine_type: peerKnowledge.machine_type,
      resolution: peerKnowledge.resolution,
      technician_confirmed: peerKnowledge.technician_confirmed,
      similarity_score: peerKnowledge.similarity_score,
    } : null,
  };
  const fingerprint = explanationEvidenceFingerprint(evidence);
  if (aiExplanationState?.fingerprint === fingerprint) return;
  aiExplanationState = { fingerprint, status: "Generating evidence-based explanation…", evidence, result: null, error: null };
  if (getSelectedMachine().id === machine.id) { renderAI(); renderVerification(); }
  fetch("http://127.0.0.1:8000/api/ai/explain", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(evidence),
  }).then(async (response) => {
    const body = await response.json();
    if (!response.ok) throw new Error(body.detail || "AI explanation unavailable");
    return body;
  }).then((result) => {
    if (aiExplanationState?.fingerprint !== fingerprint) return;
    aiExplanationState = { fingerprint, status: "complete", evidence, result, aiStatusMessage: result.ai_status_message, error: null };
    if (getSelectedMachine().id === machine.id) { renderAI(); renderVerification(); }
  }).catch((error) => {
    if (aiExplanationState?.fingerprint !== fingerprint) return;
    aiExplanationState = { fingerprint, status: "error", evidence, result: null, error: error.message };
    if (getSelectedMachine().id === machine.id) { renderAI(); renderVerification(); }
  });
}

// ---- Render: technician verification ------------------------------------
function renderVerification() {
  const el = document.getElementById("verification-panel");
  const machine = getSelectedMachine();
  const state = machine.id === "M-B-002" ? aiExplanationState : null;
  if (!state || state.status !== "complete" || !state.result) {
    el.textContent = "No AI recommendation available for technician verification yet.";
    return;
  }
  const saved = verificationStates[state.fingerprint];
  const recommendation = state.result.possible_diagnosis;
  if (saved?.status === "validated") {
    el.innerHTML = `<div class="verify-result verify-success">Validated Memory Created</div><div class="verify-summary">Technician-validated incident: <strong>${escapeHTML(saved.diagnosis)}</strong>. Stored in Machine B's local Qdrant Edge shard.</div>`;
    return;
  }
  if (saved?.status === "rejected") {
    el.innerHTML = `
      <div class="verify-result verify-rejected">AI recommendation rejected and recorded.</div>
      <label class="verify-field" for="corrected-diagnosis">Enter corrected diagnosis</label>
      <input id="corrected-diagnosis" class="verify-input" maxlength="200" value="${escapeHTML(saved.correctedDiagnosis || "")}" placeholder="Technician's corrected diagnosis">
      <button id="submit-correction" class="btn btn-primary" ${saved.pending ? "disabled" : ""}>SAVE CORRECTED DIAGNOSIS</button>
      ${saved.error ? `<div class="verify-result verify-rejected">${escapeHTML(saved.error)}</div>` : ""}
    `;
    document.getElementById("corrected-diagnosis").addEventListener("input", (event) => {
      saved.correctedDiagnosis = event.target.value;
    });
    document.getElementById("submit-correction").addEventListener("click", () => submitTechnicianDecision(state, "corrected", saved.correctedDiagnosis));
    return;
  }
  el.innerHTML = `
    <div class="verify-summary"><strong>AI Recommendation</strong><br>${escapeHTML(recommendation)}<br>Confidence: ${state.result.confidence == null ? "Not provided" : `${escapeHTML(state.result.confidence)}%`}</div>
    <div class="btn-group verify-actions">
      <button id="confirm-diagnosis" class="btn btn-confirm" ${saved?.pending ? "disabled" : ""}>CONFIRM DIAGNOSIS</button>
      <button id="reject-diagnosis" class="btn btn-reject" ${saved?.pending ? "disabled" : ""}>REJECT DIAGNOSIS</button>
    </div>
    ${saved?.pending ? `<div class="verify-result">${escapeHTML(saved.pending)}</div>` : ""}
    ${saved?.error ? `<div class="verify-result verify-rejected">${escapeHTML(saved.error)}</div>` : ""}
  `;
  document.getElementById("confirm-diagnosis").addEventListener("click", () => submitTechnicianDecision(state, "confirmed", recommendation));
  document.getElementById("reject-diagnosis").addEventListener("click", () => submitTechnicianDecision(state, "rejected", recommendation));
}

function renderMachineCLearning() {
  const section = document.getElementById("machine-c-learning-section");
  const el = document.getElementById("machine-c-learning-panel");
  if (!section || !el) return;
  const selected = getSelectedMachine().id === "M-C-003";
  section.hidden = !selected;
  if (!selected) return;

  const result = machineCRetrievalState.result;
  const buttonLabel = machineCRetrievalState.status === "loading" ? "RETRIEVING…" : "Retrieve Global Knowledge";
  const cloudRecords = result?.cloud_knowledge_retrieved || [];
  const imports = result?.imports || [];
  const cloudKnowledge = cloudRecords.length ? cloudRecords.map((knowledge) => `
    <article class="machine-c-record">
      <div class="i-title">Cloud knowledge retrieved from Qdrant Cloud</div>
      <div><strong>Incident:</strong> ${escapeHTML(knowledge.incident_type || "Unknown")}</div>
      <div><strong>Symptoms:</strong> ${escapeHTML((knowledge.symptoms || []).join(", ") || "Not provided")}</div>
      <div><strong>Machine type:</strong> ${escapeHTML(knowledge.machine_type || "Unknown")}</div>
      <div><strong>Resolution:</strong> ${escapeHTML(knowledge.resolution || "Not provided")}</div>
      <div><strong>Technician confirmed:</strong> ${knowledge.technician_confirmed ? "Yes" : "No"}</div>
      <div><strong>Gateway decision:</strong> ${escapeHTML(knowledge.gateway_decision || "Unknown")}</div>
      <div><strong>Source machine:</strong> ${escapeHTML(knowledge.source_machine || "Unknown")} (via Cloud)</div>
    </article>`).join("") : "";
  const localResult = result?.machine_c_local_search;
  const localSearch = localResult?.matching_incident ? `
    <div class="machine-c-record">
      <div class="i-title">Machine C local Edge search result</div>
      <div><strong>Matching incident:</strong> ${escapeHTML(localResult.matching_incident)}</div>
      <div><strong>Similarity score:</strong> ${Number(localResult.similarity_score).toFixed(4)}</div>
      <div><strong>Incident details:</strong> ${escapeHTML(localResult.payload?.incident_text || localResult.payload?.resolution || "Details unavailable")}</div>
    </div>` : (result ? '<div class="memory-empty">No useful local match found in Machine C Edge memory.</div>' : '<div class="memory-empty">Run retrieval to search Machine C local memory.</div>');

  el.innerHTML = `
    <div class="gateway-boundary">
      <div><strong>Machine C</strong> · M-C-003 · Level 5 · Conveyor Motor</div>
      <div>Machine C reads approved knowledge from Qdrant Cloud; it does not query Machine A or Machine B.</div>
    </div>
    <button id="machine-c-retrieve" class="btn btn-primary" type="button" ${machineCRetrievalState.status === "loading" ? "disabled" : ""}>${buttonLabel}</button>
    ${machineCRetrievalState.error ? `<div class="memory-unavailable">${escapeHTML(machineCRetrievalState.error)}</div>` : ""}
    ${result ? `
      <div class="machine-c-stage"><div class="i-title">Cloud knowledge retrieved</div>${cloudKnowledge || `<div class="memory-empty">${escapeHTML(result.message || "No relevant approved Cloud knowledge found.")}</div>`}</div>
      <div class="machine-c-stage"><div class="i-title">Knowledge imported into Machine C</div>
        <div>Before: ${Number(result.machine_c_memory_before?.memory_count || 0) === 0 ? "No useful bearing-failure memory" : `${Number(result.machine_c_memory_before.memory_count)} existing local memory item(s)`}</div>
        <div>After: ${Number(result.machine_c_memory_after?.memory_count || 0)} local memory item(s)</div>
        ${imports.length ? `<div>${imports.filter((item) => item.memory_created).length ? "Validated Memory Imported" : "Knowledge already present; no duplicate created"}</div>` : "<div>No knowledge imported.</div>"}
      </div>
      <div class="machine-c-stage"><div class="i-title">Machine C local search</div>
        ${result.local_search_query ? `<div class="machine-c-query"><strong>Query:</strong> ${escapeHTML(result.local_search_query)}</div>` : ""}
        ${localSearch}
      </div>
    ` : '<div class="machine-c-stage">Machine C local Edge memory starts without a seeded bearing-failure incident.</div>'}
  `;
  const button = document.getElementById("machine-c-retrieve");
  button.addEventListener("click", retrieveGlobalKnowledgeForMachineC);
}

function retrieveGlobalKnowledgeForMachineC() {
  if (machineCRetrievalState.status === "loading") return;
  machineCRetrievalState = { status: "loading", result: null, error: null };
  renderMachineCLearning();
  fetch("http://127.0.0.1:8000/api/machine-c/retrieve-global", { method: "POST" }).then((response) => {
    if (!response.ok) return response.json().then((body) => { throw new Error(body.detail || "Machine C Cloud retrieval failed"); });
    return response.json();
  }).then((result) => {
    machineCRetrievalState = { status: "complete", result, error: null };
  }).catch((error) => {
    machineCRetrievalState = { status: "error", result: null, error: error.message };
  }).finally(renderMachineCLearning);
}

function submitTechnicianDecision(state, decision, diagnosis) {
  if (!diagnosis?.trim()) {
    const current = verificationStates[state.fingerprint] || {};
    current.error = "Enter a corrected diagnosis before saving.";
    verificationStates[state.fingerprint] = current;
    renderVerification();
    return;
  }
  const prior = verificationStates[state.fingerprint] || {};
  verificationStates[state.fingerprint] = { ...prior, pending: decision === "rejected" ? "Recording technician rejection…" : "Saving technician decision…", error: null };
  renderVerification();
  fetch("http://127.0.0.1:8000/api/machine-b/technician-verification", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      machine_id: "M-B-002",
      decision,
      original_recommendation: state.result.possible_diagnosis,
      diagnosis: diagnosis.trim(),
      evidence: state.evidence,
    }),
  }).then(async (response) => {
    const body = await response.json();
    if (!response.ok) throw new Error(body.detail || "Could not record technician decision");
    return body;
  }).then((result) => {
    if (decision === "rejected") {
      verificationStates[state.fingerprint] = { status: "rejected", correctedDiagnosis: "" };
    } else {
      verificationStates[state.fingerprint] = { status: "validated", diagnosis: result.incident_type || diagnosis.trim() };
      if (result.sync_queue_entry) {
        const previousEntries = syncQueueState?.entries || [];
        const entries = [
          result.sync_queue_entry,
          ...previousEntries.filter((entry) => entry.queue_entry_id !== result.sync_queue_entry.queue_entry_id),
        ];
        syncQueueState = {
          ...(syncQueueState || {}),
          entries,
          pending_sync_count: entries.filter((entry) => entry.sync_status === "Pending Sync").length,
          loading: false,
          error: null,
        };
        renderSync();
        loadGateway(true);
      }
    }
    renderVerification();
  }).catch((error) => {
    verificationStates[state.fingerprint] = { ...verificationStates[state.fingerprint], pending: null, error: error.message };
    renderVerification();
  });
}

// ---- Render: local synchronization queue ----------------------------------
function loadSyncQueue() {
  if (syncQueueState) return;
  syncQueueState = { loading: true, entries: [], pending_sync_count: 0 };
  fetch("http://127.0.0.1:8000/api/sync-queue").then((response) => {
    if (!response.ok) throw new Error("Local sync queue unavailable");
    return response.json();
  }).then((queue) => {
    syncQueueState = { ...queue, loading: false, error: null };
    renderSync();
  }).catch((error) => {
    syncQueueState = { loading: false, entries: [], pending_sync_count: 0, error: error.message };
    renderSync();
  });
}

function renderSync() {
  const el = document.getElementById("sync-panel");
  if (!syncQueueState) loadSyncQueue();
  const queue = syncQueueState || { loading: true, entries: [], pending_sync_count: 0 };
  const pendingCount = Number(queue.pending_sync_count || 0);
  const queueStatus = queue.error
    ? "Queue unavailable"
    : queue.loading
      ? "Loading local queue"
      : pendingCount > 0
        ? (cloudStatusSetting === "OFFLINE"
          ? "Waiting for connectivity"
          : "Ready for Gateway synchronization")
        : "No validated incidents waiting for sync";
  const actualRows = (queue.entries || []).map((entry) => `
    <tr>
      <td>${escapeHTML(entry.queue_category)}</td>
      <td>${escapeHTML(entry.machine_id)}</td>
      <td>${escapeHTML(entry.incident_type)}</td>
      <td>${escapeHTML(entry.sync_status)}</td>
      <td>${escapeHTML(entry.last_sync_error || entry.cloud_record_id || "Local queue")}</td>
    </tr>
  `).join("");
  const exampleRows = [
    ["Sync Now", "Eligible validated incident example"],
    ["Aggregate", "Related vibration and temperature notes"],
    ["Duplicate", "Repeated incident fingerprint example"],
    ["Local Only", "Technician note retained on this device"],
  ].map(([category, incident]) => `
    <tr class="queue-demo-row">
      <td>${category}</td><td>M-B-002</td><td>${incident}</td><td>Example only</td><td>Demo — not persisted</td>
    </tr>
  `).join("");

  el.innerHTML = `
    <div class="queue-summary">
      <div class="queue-count"><span>Pending Sync:</span> <strong>${queue.error ? "—" : pendingCount}</strong></div>
      <div class="queue-status"><span>Status:</span> <strong>${escapeHTML(queueStatus)}</strong></div>
    </div>
    ${queue.error ? `<div class="memory-unavailable">${escapeHTML(queue.error)}. <button id="retry-sync-queue" class="btn btn-primary">Retry</button></div>` : ""}
    <div class="queue-notice">The queue remains local and retryable. Only approved Gateway decisions are sent to Qdrant Cloud after you choose SYNC NOW. Static examples are excluded from the pending count.</div>
    <div class="i-title">Local queue entries</div>
    <div class="queue-table-wrap"><table class="queue-table">
      <thead><tr><th>Category</th><th>Machine</th><th>Incident</th><th>Status</th><th>Record</th></tr></thead>
      <tbody>${actualRows || '<tr><td colspan="5" class="queue-empty">No actual validated incidents are queued.</td></tr>'}</tbody>
    </table></div>
    <div class="i-title queue-demo-title">Category examples — demo only</div>
    <div class="queue-table-wrap"><table class="queue-table">
      <thead><tr><th>Category</th><th>Machine</th><th>Incident</th><th>Status</th><th>Record</th></tr></thead>
      <tbody>${exampleRows}</tbody>
    </table></div>
  `;
  const retryButton = document.getElementById("retry-sync-queue");
  if (retryButton) {
    retryButton.addEventListener("click", () => {
      syncQueueState = null;
      renderSync();
    });
  }
}

// ---- Render: local Gateway decisions -------------------------------------
function loadGateway(force = false) {
  if (gatewayState && !force) return;
  const requestSequence = ++gatewayRequestSequence;
  gatewayState = { loading: true, pending_items: 0, items: [], decision_summary: {} };
  renderGateway();
  fetch("http://127.0.0.1:8000/api/gateway/pending").then((response) => {
    if (!response.ok) throw new Error("Local Gateway unavailable");
    return response.json();
  }).then((result) => {
    if (requestSequence !== gatewayRequestSequence) return;
    gatewayState = { ...result, loading: false, error: null };
    renderGateway();
  }).catch((error) => {
    if (requestSequence !== gatewayRequestSequence) return;
    gatewayState = { loading: false, pending_items: 0, items: [], decision_summary: {}, error: error.message };
    renderGateway();
  });
}

function renderGateway() {
  const el = document.getElementById("gateway-panel");
  if (!gatewayState) {
    loadGateway();
    return;
  }
  const summary = gatewayState.decision_summary || {};
  const decisions = ["SYNC NOW", "SYNC", "AGGREGATE", "SKIP", "LOCAL ONLY"];
  const decisionSummary = decisions.map((decision) => `
    <div class="gateway-count"><span>${decision}:</span> <strong>${Number(summary[decision] || 0)}</strong></div>
  `).join("");
  const visibleItems = [...(gatewayState.items || [])];
  lastGatewaySyncItems.forEach((item) => {
    const index = visibleItems.findIndex((candidate) => candidate.item_id === item.item_id);
    if (index >= 0) visibleItems[index] = { ...visibleItems[index], ...item };
    else visibleItems.unshift(item);
  });
  const rows = visibleItems.map((item) => `
    <tr>
      <td>${escapeHTML(item.incident_type || item.item_id || "Unknown incident")}</td>
      <td>${escapeHTML(item.machine_id || "Unknown machine")}</td>
      <td><span class="gateway-decision">${escapeHTML(item.gateway_decision)}</span></td>
      <td>${escapeHTML(item.reason)}</td>
      <td>${escapeHTML(item.processing_status)}${item.error ? `<div class="gateway-error">${escapeHTML(item.error)}</div>` : ""}</td>
    </tr>
  `).join("");
  const entries = syncQueueState?.entries || [];
  const processingCount = entries.filter((item) => item.sync_status === "Processing").length;
  const syncedCount = entries.filter((item) => item.sync_status === "Synced").length;
  const failedCount = entries.filter((item) => item.sync_status === "Failed").length;

  el.innerHTML = `
    <div class="gateway-boundary">
      <div><strong>Gateway: LOCAL CLASSIFICATION ACTIVE</strong></div>
      <div>Qdrant Cloud: ${cloudStatusSetting === "ONLINE" ? "ONLINE" : cloudStatusSetting === "CHECKING" ? "CHECKING" : "OFFLINE"}</div>
      <div>Only SYNC NOW and SYNC items are eligible. SKIP, AGGREGATE and LOCAL ONLY remain on the device.</div>
    </div>
    <div class="gateway-pending">Pending Items: <strong>${gatewayState.error ? "—" : Number(gatewayState.pending_items || 0)}</strong></div>
    <div class="gateway-summary gateway-sync-summary">
      <div class="gateway-count"><span>Processing:</span><strong>${processingCount}</strong></div>
      <div class="gateway-count"><span>Synced:</span><strong>${syncedCount}</strong></div>
      <div class="gateway-count"><span>Failed:</span><strong>${failedCount}</strong></div>
    </div>
    <div class="gateway-actions">
      <button id="gateway-sync-now" class="btn btn-primary" type="button" ${gatewaySyncInProgress ? "disabled" : ""}>${gatewaySyncInProgress ? "PROCESSING…" : "SYNC NOW"}</button>
      <span>${escapeHTML(gatewaySyncMessage || (cloudStatusSetting === "OFFLINE" ? "Synchronization waits for a successful cloud connection." : "Synchronization runs only after this action."))}</span>
    </div>
    <div class="i-title">Decision Summary</div>
    <div class="gateway-summary">${decisionSummary}</div>
    ${gatewayState.loading ? '<div class="queue-empty">Loading Gateway decisions…</div>' : ""}
    ${gatewayState.error ? `<div class="memory-unavailable">${escapeHTML(gatewayState.error)}. <button id="retry-gateway" class="btn btn-primary">Retry</button></div>` : ""}
    <div class="queue-table-wrap"><table class="queue-table gateway-table">
      <thead><tr><th>Incident</th><th>Machine</th><th>Decision</th><th>Reason</th><th>Status</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" class="queue-empty">No pending local items to classify.</td></tr>'}</tbody>
    </table></div>
  `;
  const retryButton = document.getElementById("retry-gateway");
  if (retryButton) retryButton.addEventListener("click", () => loadGateway(true));
  const syncButton = document.getElementById("gateway-sync-now");
  if (syncButton) syncButton.addEventListener("click", syncGatewayNow);
}

function syncGatewayNow() {
  if (gatewaySyncInProgress) return;
  if (cloudLocallyDisabled) {
    gatewaySyncMessage = "Cloud synchronization is disabled locally. Pending items remain available.";
    renderGateway();
    return;
  }
  gatewaySyncInProgress = true;
  gatewayState = { ...(gatewayState || {}), syncMessage: "Checking Cloud and processing approved Gateway items…" };
  renderGateway();
  fetch("http://127.0.0.1:8000/api/gateway/sync", { method: "POST" }).then((response) => {
    if (!response.ok) return response.json().then((body) => { throw new Error(body.detail || "Gateway synchronization failed"); });
    return response.json();
  }).then((result) => {
    cloudStatusSetting = result.cloud_status === "online" || result.cloud_status === "online_with_failures" ? "ONLINE" : "OFFLINE";
    cloudStatusMessage = result.cloud_message || (result.cloud_status === "not_configured" ? "Cloud not configured." : "Gateway synchronization finished.");
    gatewaySyncMessage = result.cloud_message || `Processed ${result.processed}: ${result.synced} synced, ${result.duplicates} duplicate(s), ${result.failed} failed.`;
    lastGatewaySyncItems = result.items || [];
  }).catch((error) => {
    gatewaySyncMessage = error.message;
  }).finally(() => {
    gatewaySyncInProgress = false;
    renderHeaderStatus();
    syncQueueState = null;
    gatewayState = null;
    globalMemoryState = null;
    loadSyncQueue();
    loadGateway(true);
    loadGlobalMemory();
  });
}

function loadGlobalMemory() {
  const el = document.getElementById("global-memory-panel");
  if (!el) return;
  if (globalMemoryState) return;
  el.innerHTML = '<div class="queue-empty">Checking Qdrant Cloud for synchronized knowledge…</div>';
  fetch("http://127.0.0.1:8000/api/gateway/global-memory").then((response) => {
    if (!response.ok) throw new Error("Global Memory could not be loaded");
    return response.json();
  }).then((result) => {
    globalMemoryState = result;
    const items = result.items || [];
    el.innerHTML = result.cloud_status === "not_configured" || result.cloud_status === "offline"
      ? `<div class="queue-empty">${escapeHTML(result.message || "Global Memory is unavailable while Cloud is offline.")}</div>`
      : (items.length ? items.map((item) => `
        <article class="global-memory-item">
          <div><strong>Machine:</strong> ${escapeHTML(item.machine_id || "Unknown")}</div>
          <div><strong>Incident:</strong> ${escapeHTML(item.incident_type || "Unknown")}</div>
          <div><strong>Type:</strong> ${escapeHTML(item.knowledge_type || "Validated knowledge")}</div>
          <div><strong>Source:</strong> ${escapeHTML(item.source_machine || item.machine_id || "Unknown")}</div>
          <div><strong>Gateway Decision:</strong> ${escapeHTML(item.gateway_decision || "Unknown")}</div>
          <div><strong>Cloud Status:</strong> Synced</div>
          <div><strong>Details:</strong> ${escapeHTML(item.resolution || (item.symptoms || []).join(", ") || "No additional details")}</div>
        </article>`).join("")
      : '<div class="queue-empty">No synchronized global knowledge is present in Qdrant Cloud.</div>');
  }).catch((error) => {
    el.innerHTML = `<div class="queue-empty">${escapeHTML(error.message)}</div>`;
  });
}

// ---- Render everything ----------------------------------------------------
function renderAll() {
  renderHeaderStatus();
  renderMachineList();
  renderMachineDetail();
  renderSensors();
  renderMemory();
  updateLocalSearch();
  renderLocalSearch();
  renderMachineCLearning();
  renderPeers();
  renderAI();
  renderVerification();
  renderSync();
  renderGateway();
  loadGlobalMemory();
}

document.addEventListener("DOMContentLoaded", () => {
  evaluateMachineAnomalies();
  renderAll();
  loadCloudStatus();
  SensorSimulator.start(() => {
    evaluateMachineAnomalies();
    updateLocalSearch();
    renderLocalSearch();
    renderMachineList();
    renderMachineDetail();
    renderSensors();
    renderPeers();
    renderAI();
  });
});
