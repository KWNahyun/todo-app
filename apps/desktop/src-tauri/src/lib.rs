//! Daily Todo v2 데스크톱 셸.
//!
//! 동기화 로직은 전부 TypeScript(packages/core)에 있고, 여기는 파일 읽기 · 쓰기만 해 줌.
//! - 보관함(클라우드 폴더): vault_* — 화면이 넘긴 보관함 경로 아래만, ".." 금지
//! - 기기 안 저장: local_* — 앱 데이터 폴더의 정해진 이름만
//! - v1 기록: v1_read — 읽기만
//! 창은 둘: 위젯(widget, 늘 떠 있음)과 메인 창(main, 필요할 때). 메인 창을 닫으면 숨기기만 함.

use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use base64::{engine::general_purpose::STANDARD as B64, Engine};

use tauri::{AppHandle, Manager, WindowEvent};

type Res<T> = Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// 보관함 안의 상대 경로("log/pc-1/2026-10.ndjson")만 허용
fn vault_path(root: &str, rel: &str) -> Res<PathBuf> {
    let root = PathBuf::from(root);
    if !root.is_absolute() {
        return Err(format!("보관함 경로는 절대 경로여야 함: {}", root.display()));
    }
    let rel_path = Path::new(rel);
    if rel.is_empty() || !rel_path.components().all(|c| matches!(c, Component::Normal(_))) {
        return Err(format!("잘못된 경로: {rel}"));
    }
    Ok(root.join(rel_path))
}

#[tauri::command]
fn vault_read(root: String, path: String) -> Res<Option<String>> {
    match fs::read_to_string(vault_path(&root, &path)?) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(err(e)),
    }
}

/// 임시 파일에 쓰고 바꿔치기 (드라이브가 반쯤 쓴 파일을 올리지 않게)
fn write_atomic(p: &Path, text: &str) -> Res<()> {
    if let Some(dir) = p.parent() {
        fs::create_dir_all(dir).map_err(err)?;
    }
    let tmp = p.with_extension(format!("{}.tmp", std::process::id()));
    fs::write(&tmp, text).map_err(err)?;
    fs::rename(&tmp, p).map_err(err)
}

#[tauri::command]
fn vault_write(root: String, path: String, text: String) -> Res<()> {
    write_atomic(&vault_path(&root, &path)?, &text)
}

#[tauri::command]
fn vault_append(root: String, path: String, text: String) -> Res<()> {
    let p = vault_path(&root, &path)?;
    if let Some(dir) = p.parent() {
        fs::create_dir_all(dir).map_err(err)?;
    }
    let mut f = OpenOptions::new().create(true).append(true).open(p).map_err(err)?;
    f.write_all(text.as_bytes()).map_err(err)
}

// 사진 같은 이진 파일은 base64 로 주고받음 (2048px WebP 하나가 수백 KB 라 충분)
#[tauri::command]
fn vault_read_bytes(root: String, path: String) -> Res<Option<String>> {
    match fs::read(vault_path(&root, &path)?) {
        Ok(b) => Ok(Some(B64.encode(b))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(err(e)),
    }
}

#[tauri::command]
fn vault_write_bytes(root: String, path: String, b64: String) -> Res<()> {
    let bytes = B64.decode(b64).map_err(err)?;
    let p = vault_path(&root, &path)?;
    if let Some(dir) = p.parent() {
        fs::create_dir_all(dir).map_err(err)?;
    }
    let tmp = p.with_extension(format!("{}.tmp", std::process::id()));
    fs::write(&tmp, bytes).map_err(err)?;
    fs::rename(&tmp, p).map_err(err)
}

/// v1 기록장에 붙여 둔 사진 파일 읽기 (가져오기용) — 그림 파일만, 50MB 까지, 읽기만
#[tauri::command]
fn read_image_file(path: String) -> Res<String> {
    let p = PathBuf::from(&path);
    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    if !p.is_absolute() || !["jpg", "jpeg", "png", "webp", "gif", "bmp"].contains(&ext.as_str()) {
        return Err(format!("그림 파일이 아님: {path}"));
    }
    let meta = fs::metadata(&p).map_err(err)?;
    if meta.len() > 50 * 1024 * 1024 {
        return Err("50MB 넘는 파일".into());
    }
    Ok(B64.encode(fs::read(p).map_err(err)?))
}

fn walk(dir: &Path, base: &Path, out: &mut Vec<String>) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            walk(&p, base, out);
        } else if let Ok(rel) = p.strip_prefix(base) {
            let s = rel.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/");
            if !s.ends_with(".tmp") {
                out.push(s);
            }
        }
    }
}

#[tauri::command]
fn vault_list(root: String, prefix: String) -> Res<Vec<String>> {
    let base = PathBuf::from(&root);
    // prefix 의 폴더 부분만 훑음 ("log/" → log 폴더)
    let top = prefix.split('/').next().unwrap_or("");
    let start = if top.is_empty() { base.clone() } else { vault_path(&root, top)? };
    let mut out = Vec::new();
    walk(&start, &base, &mut out);
    out.retain(|p| p.starts_with(&prefix));
    out.sort();
    Ok(out)
}

const LOCAL_NAMES: &[&str] = &["config.json", "local-main.json", "local-widget.json"];

fn local_path(app: &AppHandle, name: &str) -> Res<PathBuf> {
    if !LOCAL_NAMES.contains(&name) {
        return Err(format!("허용되지 않은 이름: {name}"));
    }
    Ok(app.path().app_data_dir().map_err(err)?.join(name))
}

#[tauri::command]
fn local_read(app: AppHandle, name: String) -> Res<Option<String>> {
    match fs::read_to_string(local_path(&app, &name)?) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(err(e)),
    }
}

#[tauri::command]
fn local_write(app: AppHandle, name: String, text: String) -> Res<()> {
    write_atomic(&local_path(&app, &name)?, &text)
}

/// 기본 보관함: OneDrive 앱 전용 폴더(설계 13장). 한국어 Windows 는 "앱", 영어는 "Apps".
/// OneDrive 가 없으면 이 PC 안 (동기화 없음).
#[tauri::command]
fn default_vault_root(app: AppHandle) -> Res<String> {
    for var in ["OneDrive", "OneDriveConsumer"] {
        if let Ok(od) = std::env::var(var) {
            let od = PathBuf::from(od);
            if od.is_dir() {
                let apps = ["앱", "Apps"].iter().map(|n| od.join(n)).find(|p| p.is_dir()).unwrap_or(od.join("앱"));
                return Ok(apps.join("DailyTodo").to_string_lossy().into_owned());
            }
        }
    }
    Ok(app.path().app_data_dir().map_err(err)?.join("vault").to_string_lossy().into_owned())
}

/// v1 데이터 폴더(%APPDATA%\DailyTodo\location.json 이 가리키는 곳)의 JSON 들 — 읽기만
#[tauri::command]
fn v1_read() -> Res<Option<(String, HashMap<String, String>)>> {
    let Ok(appdata) = std::env::var("APPDATA") else { return Ok(None) };
    let local = PathBuf::from(appdata).join("DailyTodo");
    let dir = fs::read_to_string(local.join("location.json"))
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v.get("data_dir").and_then(|d| d.as_str()).map(PathBuf::from))
        .unwrap_or(local);
    let names = [
        "tasks.json", "events.json", "deadlines.json", "goals.json", "habits.json",
        "moods.json", "journal.json", "mandalart.json", "collections.json",
    ];
    let mut out = HashMap::new();
    for n in names {
        if let Ok(s) = fs::read_to_string(dir.join(n)) {
            out.insert(n.to_string(), s);
        }
    }
    if out.is_empty() {
        return Ok(None);
    }
    Ok(Some((dir.to_string_lossy().into_owned(), out)))
}

static CONFIG_LOCK: Mutex<()> = Mutex::new(());

/// 설정 읽기. 처음이면 이 PC 의 ID 를 만들어 둠 — 두 창이 동시에 불러도 잠금으로 한 번만 만듦
/// (설정에 적힌 창들은 setup 보다 먼저 뜰 수 있어서 setup 에 맡기지 않음)
#[tauri::command]
fn config_read(app: AppHandle) -> Res<String> {
    let _g = CONFIG_LOCK.lock().map_err(err)?;
    ensure_config(&app)?;
    fs::read_to_string(local_path(&app, "config.json")?).map_err(err)
}

fn ensure_config(app: &AppHandle) -> Res<()> {
    let p = local_path(app, "config.json")?;
    let mut cfg: serde_json::Map<String, serde_json::Value> = match fs::read_to_string(&p) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Default::default(),
        Err(e) => return Err(err(e)),
        // 메모장 등이 붙이는 BOM 은 떼고 읽음. 읽을 수 없는 설정은 덮어쓰지 않고 멈춤 (보관함 경로를 잃지 않게)
        Ok(s) => serde_json::from_str(s.trim_start_matches('\u{feff}'))
            .map_err(|e| format!("설정 파일을 읽을 수 없음 ({}): {e}", p.display()))?,
    };
    if cfg.get("deviceBase").and_then(|v| v.as_str()).is_some() {
        return Ok(());
    }
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(err)?
        .as_nanos()
        ^ ((std::process::id() as u128) << 64);
    let abc = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut x = nanos.wrapping_mul(0x9E37_79B9_7F4A_7C15_F39C_C060_5CED_C835);
    let id: String = (0..8)
        .map(|_| {
            let c = abc[(x % 36) as usize] as char;
            x /= 36;
            c
        })
        .collect();
    cfg.insert("deviceBase".into(), format!("pc-{id}").into());
    let name = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "PC".into());
    cfg.entry("deviceName").or_insert(name.into());
    write_atomic(&p, &serde_json::to_string_pretty(&cfg).map_err(err)?)
}

/// 마지막 키보드 · 마우스 입력 뒤 지난 초 (자리 비움 감지 — v1 winapi.idle_seconds)
#[tauri::command]
fn idle_seconds() -> u64 {
    #[cfg(windows)]
    {
        #[repr(C)]
        struct LastInputInfo {
            cb_size: u32,
            dw_time: u32,
        }
        #[link(name = "user32")]
        extern "system" {
            fn GetLastInputInfo(plii: *mut LastInputInfo) -> i32;
        }
        #[link(name = "kernel32")]
        extern "system" {
            fn GetTickCount() -> u32;
        }
        let mut li = LastInputInfo { cb_size: std::mem::size_of::<LastInputInfo>() as u32, dw_time: 0 };
        // SAFETY: 크기를 채운 구조체 포인터를 넘기는 Win32 호출
        unsafe {
            if GetLastInputInfo(&mut li) == 0 {
                return 0;
            }
            (GetTickCount().wrapping_sub(li.dw_time) / 1000) as u64
        }
    }
    #[cfg(not(windows))]
    {
        0
    }
}

/// 위젯을 앞으로 (자리 비움 확인처럼 꼭 봐야 할 때)
#[tauri::command]
fn show_widget(app: AppHandle) {
    if let Some(w) = app.get_webview_window("widget") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// 메인 창 보이기 (위젯의 "메인 창" 버튼, 두 번째 실행)
#[tauri::command]
fn show_main(app: AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // 이미 켜져 있으면 새로 띄우지 않고 위젯 · 메인 창을 앞으로
            if let Some(w) = app.get_webview_window("widget") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            vault_read, vault_write, vault_append, vault_list, vault_read_bytes, vault_write_bytes, read_image_file,
            local_read, local_write, config_read, default_vault_root, v1_read, show_main, show_widget, idle_seconds
        ])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    // 메인 창은 숨기기만 (위젯이 앱 본체)
                    api.prevent_close();
                    let _ = window.hide();
                } else {
                    window.app_handle().exit(0);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("Daily Todo 를 시작하지 못함");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> String {
        let d = std::env::temp_dir().join(format!("dailytodo-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        d.to_string_lossy().into_owned()
    }

    #[test]
    fn 보관함_밖은_막음() {
        let root = tmp("guard");
        assert!(vault_path(&root, "log/pc/2026-10.ndjson").is_ok());
        for bad in ["", "../x", "log/../../x", "/etc/passwd", "C:\\x"] {
            assert!(vault_path(&root, bad).is_err(), "{bad}");
        }
        // 겹친 / 는 하나로 정리돼 보관함 안 → 허용
        assert_eq!(vault_path(&root, "log//x").unwrap(), PathBuf::from(&root).join("log").join("x"));
        assert!(vault_path("relative", "a").is_err());
    }

    #[test]
    fn 덧붙이기_읽기_목록() {
        let root = tmp("io");
        assert_eq!(vault_read(root.clone(), "vault.json".into()).unwrap(), None);
        vault_write(root.clone(), "vault.json".into(), "{}".into()).unwrap();
        vault_append(root.clone(), "log/pc-1/2026-10.ndjson".into(), "a\n".into()).unwrap();
        vault_append(root.clone(), "log/pc-1/2026-10.ndjson".into(), "한글\n".into()).unwrap();
        vault_append(root.clone(), "log/pc-2/2026-11.ndjson".into(), "b\n".into()).unwrap();
        assert_eq!(vault_read(root.clone(), "log/pc-1/2026-10.ndjson".into()).unwrap().unwrap(), "a\n한글\n");
        assert_eq!(
            vault_list(root.clone(), "log/".into()).unwrap(),
            vec!["log/pc-1/2026-10.ndjson", "log/pc-2/2026-11.ndjson"]
        );
        assert_eq!(vault_list(root.clone(), "snapshots/".into()).unwrap(), Vec::<String>::new());
        assert_eq!(vault_list(root.clone(), "".into()).unwrap().len(), 3);
        // 이진 파일: base64 로 왕복
        let bytes: Vec<u8> = (0..=255).collect();
        vault_write_bytes(root.clone(), "blobs/a.webp".into(), B64.encode(&bytes)).unwrap();
        assert_eq!(B64.decode(vault_read_bytes(root.clone(), "blobs/a.webp".into()).unwrap().unwrap()).unwrap(), bytes);
        assert_eq!(vault_read_bytes(root.clone(), "blobs/none.webp".into()).unwrap(), None);
        assert!(read_image_file(format!("{root}/vault.json")).is_err()); // 그림이 아니면 거부
        let _ = fs::remove_dir_all(&root);
    }
}
