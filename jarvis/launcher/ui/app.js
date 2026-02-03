const baseUrl = "https://moltook.com";
const statusText = document.getElementById("statusText");
const claimBtn = document.getElementById("claimBtn");
const claimCodeInput = document.getElementById("claimCode");
const claimHint = document.getElementById("claimHint");
const providerInput = document.getElementById("provider");
const modelInput = document.getElementById("model");
const apiKeyInput = document.getElementById("apiKey");
const saveConfigBtn = document.getElementById("saveConfigBtn");
const configHint = document.getElementById("configHint");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const runHint = document.getElementById("runHint");

const invoke =
  (window.__TAURI__ && (window.__TAURI__.core?.invoke || window.__TAURI__.invoke)) ||
  null;

function setStatus(text) {
  statusText.textContent = text;
}

if (!invoke) {
  setStatus("연결 상태: 런처 환경이 아닙니다");
}

claimBtn.addEventListener("click", async () => {
  claimHint.textContent = "";
  const claimCode = claimCodeInput.value.trim();
  if (!claimCode) {
    claimHint.textContent = "연결 코드를 입력해줘.";
    return;
  }
  if (!invoke) {
    claimHint.textContent = "런처에서만 동작해.";
    return;
  }
  claimBtn.disabled = true;
  claimHint.textContent = "연결 중...";
  try {
    const result = await invoke("claim_agent", {
      baseUrl,
      claimCode,
    });
    claimHint.textContent = "연결 완료";
    setStatus(`연결 상태: 연결됨 (${result.agentId || "agent"})`);
  } catch (err) {
    claimHint.textContent = String(err || "연결 실패");
  } finally {
    claimBtn.disabled = false;
  }
});

saveConfigBtn.addEventListener("click", async () => {
  configHint.textContent = "";
  if (!invoke) {
    configHint.textContent = "런처에서만 동작해.";
    return;
  }
  const provider = providerInput.value;
  const model = modelInput.value.trim();
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    configHint.textContent = "API 키를 입력해줘.";
    return;
  }
  saveConfigBtn.disabled = true;
  configHint.textContent = "저장 중...";
  try {
    await invoke("save_llm_config", { provider, model, apiKey });
    apiKeyInput.value = "";
    configHint.textContent = "저장 완료";
  } catch (err) {
    configHint.textContent = String(err || "저장 실패");
  } finally {
    saveConfigBtn.disabled = false;
  }
});

startBtn.addEventListener("click", async () => {
  runHint.textContent = "";
  if (!invoke) {
    runHint.textContent = "런처에서만 동작해.";
    return;
  }
  startBtn.disabled = true;
  runHint.textContent = "실행 중...";
  try {
    await invoke("start_agent");
    runHint.textContent = "실행 중";
    setStatus("연결 상태: 실행 중");
  } catch (err) {
    runHint.textContent = String(err || "실행 실패");
  } finally {
    startBtn.disabled = false;
  }
});

stopBtn.addEventListener("click", async () => {
  runHint.textContent = "";
  if (!invoke) {
    runHint.textContent = "런처에서만 동작해.";
    return;
  }
  stopBtn.disabled = true;
  runHint.textContent = "중지 중...";
  try {
    await invoke("stop_agent");
    runHint.textContent = "중지됨";
    setStatus("연결 상태: 중지됨");
  } catch (err) {
    runHint.textContent = String(err || "중지 실패");
  } finally {
    stopBtn.disabled = false;
  }
});
