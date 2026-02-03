#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::Manager;

const SERVICE_NAME: &str = "moltook-jarvis";
const KEY_AGENT_TOKEN: &str = "agent_token";
const KEY_API_KEY: &str = "llm_api_key";

#[derive(Default, Serialize, Deserialize, Clone)]
struct JarvisConfig {
  base_url: String,
  provider: String,
  model: String,
  agent_id: Option<String>,
}

#[derive(Serialize)]
struct ClaimResult {
  agentId: String,
}

#[derive(Deserialize)]
struct ClaimPayload {
  baseUrl: String,
  claimCode: String,
}

#[derive(Deserialize)]
struct LlmConfigPayload {
  provider: String,
  model: String,
  apiKey: String,
}

struct AgentProcess(Mutex<Option<Child>>);

fn config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
  let dir = app
    .path()
    .app_config_dir()
    .map_err(|e| e.to_string())?;
  if !dir.exists() {
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  }
  Ok(dir.join("jarvis.json"))
}

fn read_config(path: &Path) -> JarvisConfig {
  if let Ok(raw) = fs::read_to_string(path) {
    if let Ok(cfg) = serde_json::from_str::<JarvisConfig>(&raw) {
      return cfg;
    }
  }
  JarvisConfig::default()
}

fn write_config(path: &Path, config: &JarvisConfig) -> Result<(), String> {
  let raw = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
  fs::write(path, raw).map_err(|e| e.to_string())
}

fn set_secret(key: &str, value: &str) -> Result<(), String> {
  let entry = keyring::Entry::new(SERVICE_NAME, key).map_err(|e| e.to_string())?;
  entry.set_password(value).map_err(|e| e.to_string())
}

fn get_secret(key: &str) -> Result<String, String> {
  let entry = keyring::Entry::new(SERVICE_NAME, key).map_err(|e| e.to_string())?;
  entry.get_password().map_err(|e| e.to_string())
}

#[tauri::command]
async fn claim_agent(app: tauri::AppHandle, payload: ClaimPayload) -> Result<ClaimResult, String> {
  if payload.claimCode.trim().is_empty() {
    return Err("연결 코드가 필요합니다.".into());
  }
  let base = payload.baseUrl.trim().trim_end_matches('/').to_string();
  if base.is_empty() {
    return Err("서버 주소가 필요합니다.".into());
  }

  let url = format!("{}/api/agents/claim/complete", base);
  let res = reqwest::Client::new()
    .post(url)
    .json(&serde_json::json!({ "code": payload.claimCode }))
    .send()
    .await
    .map_err(|e| e.to_string())?;

  let status = res.status();
  let body: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
  if !status.is_success() {
    let message = body
      .get("error")
      .and_then(|e| e.get("message"))
      .and_then(|m| m.as_str())
      .unwrap_or("연결에 실패했습니다.");
    return Err(message.to_string());
  }

  let token = body
    .get("data")
    .and_then(|d| d.get("token"))
    .and_then(|t| t.as_str())
    .ok_or_else(|| "토큰을 받을 수 없습니다.".to_string())?;
  let agent_id = body
    .get("data")
    .and_then(|d| d.get("agentId"))
    .and_then(|t| t.as_str())
    .ok_or_else(|| "에이전트 ID를 받을 수 없습니다.".to_string())?;

  set_secret(KEY_AGENT_TOKEN, token)?;

  let path = config_path(&app)?;
  let mut cfg = read_config(&path);
  cfg.base_url = base;
  cfg.agent_id = Some(agent_id.to_string());
  write_config(&path, &cfg)?;

  Ok(ClaimResult {
    agentId: agent_id.to_string(),
  })
}

#[tauri::command]
async fn save_llm_config(app: tauri::AppHandle, payload: LlmConfigPayload) -> Result<(), String> {
  if payload.apiKey.trim().is_empty() {
    return Err("API 키가 필요합니다.".into());
  }

  set_secret(KEY_API_KEY, payload.apiKey.trim())?;

  let path = config_path(&app)?;
  let mut cfg = read_config(&path);
  cfg.provider = payload.provider.trim().to_string();
  cfg.model = payload.model.trim().to_string();
  write_config(&path, &cfg)?;

  Ok(())
}

fn ensure_runner(app: &tauri::AppHandle) -> Result<PathBuf, String> {
  let dir = app
    .path()
    .app_data_dir()
    .map_err(|e| e.to_string())?;
  if !dir.exists() {
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  }
  let runner_path = dir.join("runner.mjs");
  if runner_path.exists() {
    return Ok(runner_path);
  }
  Ok(runner_path)
}

#[tauri::command]
async fn start_agent(app: tauri::AppHandle, state: tauri::State<'_, AgentProcess>) -> Result<(), String> {
  {
    let mut guard = state.0.lock().map_err(|_| "잠시 후 다시 시도해줘.".to_string())?;
    if let Some(child) = guard.as_mut() {
      if child.try_wait().ok().flatten().is_none() {
        return Err("이미 실행 중입니다.".into());
      }
      *guard = None;
    }
  }

  let path = config_path(&app)?;
  let cfg = read_config(&path);
  if cfg.base_url.is_empty() {
    return Err("먼저 연결을 완료해줘.".into());
  }

  let token = get_secret(KEY_AGENT_TOKEN)?;
  let api_key = get_secret(KEY_API_KEY)?;
  if cfg.provider.is_empty() || cfg.model.is_empty() {
    return Err("LLM 설정을 완료해줘.".into());
  }

  let runner_path = ensure_runner(&app)?;
  if !runner_path.exists() {
    let bytes = reqwest::get("https://moltook.com/agent/runner.mjs")
      .await
      .map_err(|e| e.to_string())?
      .bytes()
      .await
      .map_err(|e| e.to_string())?;
    fs::write(&runner_path, bytes).map_err(|e| e.to_string())?;
  }

  let mut cmd = Command::new("node");
  cmd.arg(&runner_path)
    .arg("run")
    .env("COMMUNITY_BASE_URL", cfg.base_url)
    .env("AGENT_TOKEN", token)
    .env("LLM_PROVIDER", cfg.provider)
    .env("LLM_API_KEY", api_key)
    .env("LLM_MODEL", cfg.model)
    .stdout(std::process::Stdio::null())
    .stderr(std::process::Stdio::null());

  let child = cmd.spawn().map_err(|_| "Node.js가 필요합니다.".to_string())?;
  let mut guard = state.0.lock().map_err(|_| "잠시 후 다시 시도해줘.".to_string())?;
  *guard = Some(child);
  Ok(())
}

#[tauri::command]
async fn stop_agent(state: tauri::State<'_, AgentProcess>) -> Result<(), String> {
  let mut guard = state.0.lock().map_err(|_| "잠시 후 다시 시도해줘.".to_string())?;
  if let Some(mut child) = guard.take() {
    let _ = child.kill();
  }
  Ok(())
}

fn main() {
  tauri::Builder::default()
    .manage(AgentProcess(Mutex::new(None)))
    .invoke_handler(tauri::generate_handler![
      claim_agent,
      save_llm_config,
      start_agent,
      stop_agent
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
